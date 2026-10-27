import test from "node:test";
import assert from "node:assert/strict";
import {
  BurnHistory,
  summarizeBurn,
  validateBurnSource,
  jstDay,
  nextJstDay,
} from "../worker/burndown.ts";
function fixture() {
  let now = Date.parse("2026-10-27T14:00:00Z"),
    status = 200;
  const data: any = {
    ok: true,
    scope: "view16",
    observedAt: new Date(now).toISOString(),
    milestones: [
      { number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" },
    ],
    tasks: [
      {
        id: "a",
        parent: "p",
        estimate: 2,
        status: "作業中",
        complete: false,
        milestone: 9,
      },
      {
        id: "b",
        parent: "p",
        estimate: null,
        status: "未整理",
        complete: false,
        milestone: 9,
      },
    ],
  };
  const map = new Map<string, any>();
  let alarm = 0,
    reads = 0;
  const storage: any = {
    get: async (k: string) => map.get(k),
    put: async (k: string | Record<string, unknown>, v?: any) => {
      if (typeof k === "string") map.set(k, structuredClone(v));
      else
        for (const [key, value] of Object.entries(k))
          map.set(key, structuredClone(value));
    },
    delete: async (k: string | string[]) => {
      for (const key of Array.isArray(k) ? k : [k]) map.delete(key);
    },
    list: async ({ prefix }: any) =>
      new Map([...map].filter(([k]) => k.startsWith(prefix)).sort()),
    setAlarm: async (t: number) => {
      alarm = t;
    },
  };
  const history = new BurnHistory(
    storage,
    async () => {
      reads++;
      return Response.json(data, { status });
    },
    () => now,
  );
  return {
    history,
    data,
    map,
    get alarm() {
      return alarm;
    },
    get reads() {
      return reads;
    },
    set status(v: number) {
      status = v;
    },
    advance(ms: number) {
      now += ms;
      data.observedAt = new Date(now).toISOString();
    },
    read: () =>
      history.fetch(new Request("https://test/api/burndown?milestone=9")),
  };
}
test("未設定を0見積と混同せず取消を成果から分ける", () => {
  const f = fixture();
  f.data.tasks.push({
    id: "c",
    parent: "p",
    estimate: 3,
    status: "見送り",
    complete: false,
    milestone: 9,
  });
  assert.deepEqual(summarizeBurn(f.data.tasks), {
    remainingHours: 2,
    estimatedHours: 2,
    unestimated: 1,
    estimated: 1,
    total: 2,
    cancelled: 1,
  });
  assert.equal(validateBurnSource(f.data), true);
  f.data.tasks[0].estimate = "2";
  assert.equal(validateBurnSource(f.data), false);
});
test("観測以後の追加・再見積・完了・reopenだけ履歴へ、過去点不変", async () => {
  const f = fixture();
  await f.read();
  f.advance(60000);
  f.data.tasks[0].estimate = 5;
  await f.read();
  f.advance(60000);
  f.data.tasks[0].status = "完了";
  f.data.tasks[0].complete = true;
  await f.read();
  f.advance(60000);
  f.data.tasks[0].status = "作業中";
  f.data.tasks[0].complete = false;
  const result: any = await (await f.read()).json();
  assert.deepEqual(
    [...f.map.entries()]
      .filter(([k]) => k.startsWith("observation:"))
      .map(([, v]) => v.summaries[9].remainingHours),
    [2, 5, 0, 5],
  );
  assert.equal(result.ideal, null);
});
test("JST日次alarm、同日同内容は冪等、日跨ぎは新観測", async () => {
  const f = fixture();
  await f.read();
  await f.read();
  assert.equal(
    [...f.map.keys()].filter((k) => k.startsWith("observation:")).length,
    1,
  );
  assert.equal(jstDay(Date.parse("2026-10-27T15:00:00Z")), "2026-10-28");
  assert.equal(f.alarm, nextJstDay(Date.parse("2026-10-27T14:00:00Z")));
  f.advance(2 * 3600000);
  await f.history.alarm();
  assert.equal(
    [...f.map.keys()].filter((k) => k.startsWith("observation:")).length,
    2,
  );
});
test("取得失敗・不完全応答は偽ゼロを記録せず、失効時は履歴を消去", async () => {
  const f = fixture();
  await f.read();
  f.status = 503;
  assert.equal((await f.read()).status, 503);
  assert.equal(
    [...f.map.keys()].filter((k) => k.startsWith("observation:")).length,
    1,
  );
  f.status = 200;
  f.data.tasks[0].estimate = undefined;
  assert.equal((await f.read()).status, 503);
  f.status = 403;
  assert.equal((await f.read()).status, 403);
  assert.equal(f.map.size, 0);
});
test("同時閲覧の公開確認と観測はsingleflight、日次上限は明示", async () => {
  const f = fixture();
  await Promise.all([f.read(), f.read(), f.read()]);
  assert.equal(f.reads, 1);
  for (let i = 0; i < 97; i++) {
    f.advance(1000);
    f.data.tasks[0].estimate = i;
    await f.read();
  }
  const result: any = await (await f.read()).json();
  assert.equal(result.recordingLimited, true);
  assert.equal(result.observations.length, 1);
  assert.equal(
    [...f.map.keys()].filter((k) => k.startsWith("observation:")).length,
    96,
  );
  assert.equal(result.current.remainingHours, 96);
});
test("存在しないスプリントを作業ゼロの正常結果にしない", async () => {
  const f = fixture();
  const r = await f.history.fetch(
    new Request("https://test/api/burndown?milestone=999"),
  );
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "sprint_unavailable");
});
