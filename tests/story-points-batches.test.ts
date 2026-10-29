import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
function take(from: string, to: string) {
  const begin = source.indexOf(from),
    end = source.indexOf(to, begin);
  assert.ok(begin >= 0 && end > begin, `実装抽出境界: ${from}`);
  return source.slice(begin, end);
}
const application = [
  take("let pointsSnapshot = null,", "function paintStoryPoints()"),
  take("const pointsReadPools =", "function detailStoryPoints("),
].join("\n");
const lanes = (count: number, start = 1) =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${start + index}`,
    number: start + index,
    type: "PBI",
  }));
const values = (count: number, value = 1) =>
  Object.fromEntries(lanes(count).map((p) => [p.number, value]));
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// 実際のpool/chunk/merge関数を実行する。DOM・GitHub接続・canonical ACKの入力だけstub。
function harness(count = 18, bundled?: Record<string, number | null>) {
  const reads: any[] = [],
    paints: any[] = [],
    privateStops: string[] = [];
  let active = 0,
    maximum = 0;
  const adapter = {
    loadStoryPoints(pbis: any[]) {
      active++;
      maximum = Math.max(maximum, active);
      let resolve!: (value: any) => void, reject!: (error: Error) => void;
      const promise = new Promise((ok, fail) => {
        resolve = ok;
        reject = fail;
      });
      reads.push({ pbis: JSON.parse(JSON.stringify(pbis)), resolve, reject });
      return promise.finally(() => active--);
    },
  };
  const context = vm.createContext({
    adapter,
    state: {
      lanes: lanes(count),
      scope: { storyPointsField: true },
      ...(bundled ? { storyPoints: { values: bundled } } : {}),
    },
    displayScope: () => "synthetic-scope",
    paintStoryPoints() {
      paints.push(run("JSON.parse(JSON.stringify(pointsValues))"));
    },
    stopPrivateScope(message: string) {
      privateStops.push(message);
      run(
        "adapter = null; pointsEpoch++; pointsValues = {}; pointsVerifiedAt.clear();",
      );
    },
  });
  const run = (code: string) => vm.runInContext(code, context);
  vm.runInContext(application, context);
  return {
    reads,
    paints,
    privateStops,
    maximum: () => maximum,
    values: () => JSON.parse(run("JSON.stringify(pointsValues)")),
    epoch: () => run("pointsEpoch") as number,
    async load(pbis = lanes(count)) {
      context.inputLanes = pbis;
      run("loadStoryPoints(inputLanes)");
      await tick();
    },
    seed(data: Record<string, number | null>) {
      context.seed = data;
      run("pointsValues = { ...seed }; paintStoryPoints();");
    },
    async refresh(pbis = lanes(count)) {
      run("state = { ...state }");
      context.inputLanes = pbis;
      run("loadStoryPoints(inputLanes)");
      await tick();
    },
    async ok(index: number, data?: any) {
      const read = reads[index];
      assert.ok(read, `request ${index} exists`);
      read.resolve(
        data ?? {
          values: Object.fromEntries(
            read.pbis.map((p: any) => [p.number, p.number]),
          ),
        },
      );
      await tick();
    },
    async fail(index: number, code: string) {
      reads[index].reject(Object.assign(new Error(code), { code }));
      await tick();
    },
    ack(number: number, value: number) {
      context.ackNumber = number;
      context.ackValue = value;
      run(
        "pointsGenerations.set(ackNumber, (pointsGenerations.get(ackNumber) || 0) + 1); pointsValues[ackNumber] = ackValue; paintStoryPoints();",
      );
    },
    async replaceSource(data: Record<string, number | null>) {
      context.newProjection = data;
      run(
        "adapter = { loadStoryPoints() { throw Error('bundled source must not read'); } }; state = { ...state, storyPoints: { values: newProjection } }; loadStoryPoints(state.lanes);",
      );
      await tick();
    },
  };
}

test("実関数: 9/12件は最大6件のchunk、古いpage要求込みで同source並列2以内", async () => {
  for (const count of [9, 12]) {
    const h = harness();
    await h.load(lanes(count));
    assert.deepEqual(
      h.reads.map((read) => read.pbis.length),
      [6, count - 6],
    );
    await h.load(lanes(6, 13));
    assert.equal(h.reads.length, 2, "古い2要求がpool枠を保持");
    await h.ok(0);
    assert.equal(h.reads.length, 3);
    assert.equal(h.maximum(), 2);
    await h.ok(1);
    await h.ok(2);
    assert.deepEqual(
      h.values(),
      Object.fromEntries(lanes(6, 13).map((p) => [p.number, p.number])),
    );
    assert.ok(h.reads.every((read) => read.pbis.length <= 6));
  }
});

test("実関数: 一部503は他chunk終端まで旧値を保ち、部分値を公開せず後続batchも発行しない", async () => {
  const h = harness(18);
  await h.load();
  h.seed(values(18, 5));
  await h.fail(0, "github_unavailable");
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.values(), values(18, 5));
  await h.ok(1, { values: values(18, 99) });
  assert.equal(h.reads.length, 2, "失敗後に3番目のchunkを起こさない");
  assert.deepEqual(h.values(), {});
  assert.equal(
    h.paints.some((p) => Object.values(p).includes(99)),
    false,
  );
});

test("実関数: pageを変えた後の同source遅着403は即失効、別sourceの旧403は無効", async () => {
  for (const replace of [false, true]) {
    const h = harness(12);
    await h.load();
    if (replace) await h.replaceSource(values(12, 8));
    else await h.load(lanes(1));
    await h.fail(0, "scope_not_public");
    assert.equal(h.privateStops.length, replace ? 0 : 1);
    assert.deepEqual(h.values(), replace ? values(12, 8) : {});
    await h.ok(1);
    assert.deepEqual(h.values(), replace ? values(12, 8) : {});
  }
});

test("実関数: empty/invalid projectionは即epochを進め全消去し別chunkで復活しない", async () => {
  for (const invalid of [{ values: {} }, { values: [] }, { values: null }]) {
    const h = harness(12);
    await h.load();
    h.seed(values(12, 5));
    const before = h.epoch();
    await h.ok(0, invalid);
    assert.deepEqual(h.values(), {});
    assert.ok(h.epoch() > before, "他chunk未完了でも公開値を消す");
    await h.ok(1);
    assert.deepEqual(h.values(), {});
  }
});

test("実関数: canonical ACK後の古いGETは同PBIを上書きせず別PBIのfresh値を反映", async () => {
  const h = harness(12);
  await h.load();
  h.seed(values(12, 5));
  h.ack(1, 13);
  await h.ok(0, { values: { ...values(6, 8), 1: 1 } });
  assert.equal(h.values()[1], 13);
  await h.ok(1);
  assert.equal(h.values()[1], 13);
  assert.equal(h.values()[2], 8);
  assert.equal(h.values()[12], 12);
});

test("実関数: 同梱12件projectionは追加GETゼロ、0とnullを区別して更新", async () => {
  const data = { ...values(12, 5), 1: 0, 2: null };
  const h = harness(12, data);
  await h.load();
  assert.equal(h.reads.length, 0);
  assert.deepEqual(h.values(), data);
  await h.refresh();
  assert.equal(h.reads.length, 0);
  assert.deepEqual(h.values(), data);
});
