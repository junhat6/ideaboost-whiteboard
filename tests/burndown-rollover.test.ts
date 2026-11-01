import test from "node:test";
import assert from "node:assert/strict";
import { BurnHistory, validateBurnSource, jstDay } from "../worker/burndown.ts";

const cutoff = "2026-10-28T15:00:00.000Z";
const policy = "sprint-v2-exclusive-jst";
function fixture() {
  let now = Date.parse("2026-10-28T14:00:00Z"),
    status = 200,
    reads = 0,
    alarm: number | null = null,
    failPinCommit = false;
  const map = new Map<string, any>(),
    listed: string[] = [];
  const data: any = {
    ok: true,
    scope: "type:PBI",
    observedAt: new Date(now).toISOString(),
    milestones: [
      {
        number: 9,
        title: "Sprint 9",
        dueOn: "2026-10-29T00:00:00Z",
        assignmentWindow: {
          policy,
          startAt: "2026-10-20T15:00:00.000Z",
          endAt: cutoff,
        },
      },
      {
        number: 10,
        title: "Sprint 10",
        dueOn: "2026-11-05T00:00:00Z",
        assignmentWindow: {
          policy,
          startAt: cutoff,
          endAt: "2026-11-04T15:00:00.000Z",
        },
      },
    ],
    tasks: [
      {
        id: "unfinished",
        parent: "pbi",
        estimate: 5,
        status: "作業中",
        complete: false,
        milestone: 9,
      },
      {
        id: "done",
        parent: "pbi",
        estimate: 3,
        status: "完了",
        complete: true,
        milestone: 9,
      },
    ],
  };
  const storage: any = {
    get: async (key: string | string[]) =>
      Array.isArray(key)
        ? new Map(
            key
              .filter((k) => map.has(k))
              .map((k) => [k, structuredClone(map.get(k))]),
          )
        : structuredClone(map.get(key)),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      const entries =
        typeof key === "string" ? [[key, value]] : Object.entries(key);
      for (const [k, v] of entries) map.set(String(k), structuredClone(v));
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) map.delete(key);
    },
    list: async ({ prefix }: { prefix: string }) => {
      listed.push(prefix);
      return new Map([...map].filter(([key]) => key.startsWith(prefix)).sort());
    },
    getAlarm: async () => alarm,
    setAlarm: async (time: number) => {
      alarm = time;
    },
    transaction: async (run: (tx: any) => Promise<unknown>) => {
      const before = structuredClone(map),
        previousAlarm = alarm;
      try {
        const result = await run(storage);
        if (
          failPinCommit &&
          [...map.keys()].some(
            (key) => key.startsWith("sprint-boundary:") && !before.has(key),
          )
        )
          throw Error("synthetic pin commit failed");
        return result;
      } catch (error) {
        map.clear();
        for (const [key, value] of before) map.set(key, value);
        alarm = previousAlarm;
        throw error;
      }
    },
  };
  const create = () =>
    new BurnHistory(
      storage,
      async () => {
        reads++;
        return status === 200
          ? Response.json(data)
          : Response.json(
              {
                error:
                  status === 403
                    ? "scope_not_public"
                    : "observation_unavailable",
              },
              { status },
            );
      },
      () => now,
    );
  let history = create();
  const fetch = (milestone: number | null = 9) =>
    history.fetch(
      new Request(
        `https://test/api/burndown${milestone === null ? "" : `?milestone=${milestone}`}`,
      ),
    );
  return {
    data,
    map,
    listed,
    get reads() {
      return reads;
    },
    set status(value: number) {
      status = value;
    },
    set failPinCommit(value: boolean) {
      failPinCommit = value;
    },
    time(value: string | number) {
      now = typeof value === "number" ? value : Date.parse(value);
      data.observedAt = new Date(now).toISOString();
    },
    restart() {
      history = create();
    },
    fetch,
    async read(milestone: number | null = 9) {
      const response = await fetch(milestone);
      assert.equal(response.status, 200);
      return response.json() as Promise<any>;
    },
    save: (days: string[]) =>
      history.fetch(
        new Request("https://test/api/burndown/schedule?milestone=9", {
          method: "POST",
          headers: { Origin: "https://test" },
          body: JSON.stringify({
            schoolDays: days,
            expectedRevision: "0",
            requestId: crypto.randomUUID(),
          }),
        }),
      ),
    async fire() {
      alarm = null;
      await history.alarm();
    },
  };
}
const pins = (f: ReturnType<typeof fixture>) =>
  [...f.map].filter(([key]) => key.startsWith("sprint-boundary:"));
const raw = (f: ReturnType<typeof fixture>) =>
  [...f.map].filter(
    ([key]) => key.startsWith("observation:") || key.startsWith("tasks:"),
  );

test("未完5h・完了3hの9を10へ移動しても9の終了時表示は5/8hの保存観測を保持", async () => {
  const f = fixture(),
    before = await f.read();
  assert.equal(before.display.mode, "live");
  assert.deepEqual(before.display.summary, before.current);
  assert.equal(pins(f).length, 0);
  const original = structuredClone(raw(f));
  f.time(cutoff);
  f.data.tasks[0].milestone = 10;
  const moved = await f.read();
  assert.equal(moved.current.remainingHours, 0);
  assert.equal(moved.current.estimatedHours, 3);
  assert.equal(moved.display.mode, "historical");
  assert.equal(moved.display.summary.remainingHours, 5);
  assert.equal(moved.display.summary.estimatedHours, 8);
  assert.equal(moved.display.observedAt, before.observedAt);
  assert.equal(moved.observedAt, cutoff);
  assert.equal(moved.display.cutoff, cutoff);
  assert.equal(moved.display.policy, policy);
  assert.equal(moved.observations.length, 1);
  assert.equal(moved.rebase.basis, "final-observation");
  assert.equal(moved.rebase.observations[0].remainingHours, 5);
  assert.equal((await f.read(null)).milestone, 10);
  f.time("2026-10-29T08:00:00Z");
  Object.assign(f.data.tasks[0], {
    estimate: 13,
    complete: true,
    status: "完了",
  });
  assert.deepEqual((await f.read()).display, moved.display);
  f.data.tasks[1].milestone = 10;
  const allMoved = await f.read();
  assert.equal(allMoved.current.total, 0);
  assert.deepEqual(allMoved.display, moved.display);
  assert.deepEqual(allMoved.rebase, moved.rebase);
  assert.equal((await f.read(10)).display.mode, "live");
  for (const [key, value] of original) assert.deepEqual(f.map.get(key), value);
  assert.ok(allMoved.milestones.some((m: any) => m.number === 9));
});

test("終了前の正当な残り0hを採用し最後の非zero値へ巻き戻さない", async () => {
  const f = fixture();
  await f.read();
  f.time("2026-10-28T14:30:00Z");
  Object.assign(f.data.tasks[0], { complete: true, status: "完了" });
  const finished = await f.read();
  f.time(cutoff);
  f.data.tasks.forEach((task: any) => {
    task.milestone = 10;
  });
  const result = await f.read();
  assert.equal(result.display.summary.remainingHours, 0);
  assert.equal(result.display.summary.estimatedHours, 8);
  assert.equal(result.display.observedAt, finished.observedAt);
  assert.equal(result.observations[0].remainingHours, 0);
});

test("cutoffと同時刻の保存点は除外し日indexの直前最終点を使う（過去raw全走査なし）", async () => {
  const f = fixture();
  await f.read();
  f.time("2026-10-28T14:59:59.999Z");
  f.data.tasks[0].estimate = 4;
  const last = await f.read();
  f.listed.length = 0;
  f.time(cutoff);
  f.data.tasks[0].estimate = 99;
  const result = await f.read();
  assert.equal(result.current.remainingHours, 99);
  assert.equal(result.display.summary.remainingHours, 4);
  assert.equal(result.display.observedAt, last.observedAt);
  assert.ok(
    result.observations.every(
      (v: any) => Date.parse(v.at) < Date.parse(cutoff),
    ),
  );
  assert.ok(
    f.listed
      .filter((prefix) => prefix.startsWith("observation:"))
      .every(
        (prefix) => prefix === `observation:${jstDay(Date.parse(cutoff))}:`,
      ),
  );
});

test("終了前の完全保存観測がなければcurrentを代用せずhistorical summary=null", async () => {
  const f = fixture();
  f.time(cutoff);
  const result = await f.read();
  assert.equal(result.current.remainingHours, 5);
  assert.deepEqual(result.display, {
    mode: "historical",
    summary: null,
    observedAt: null,
    cutoff,
    policy,
  });
  assert.deepEqual(result.observations, []);
});

test("23:59:59.999観測の保存が00:00:00.001でも翌日更新で終了直前の5hを失わない", async () => {
  const f = fixture(),
    observed = new Date(Date.parse(cutoff) - 1).toISOString();
  f.time(Date.parse(cutoff) + 1);
  f.data.observedAt = observed;
  const first = await f.read(),
    original = structuredClone(raw(f)),
    day = jstDay(Date.parse(observed));
  assert.equal(first.display.summary.remainingHours, 5);
  assert.equal(first.display.observedAt, observed);
  assert.equal(first.observations[0].day, day);
  assert.equal(f.map.get(`day:${day}`).observedAt, observed);
  f.time(Date.parse(cutoff) + 60000);
  f.data.tasks[0].milestone = 10;
  const later = await f.read();
  assert.equal(later.current.remainingHours, 0);
  assert.deepEqual(later.display, first.display);
  assert.equal(later.observations[0].day, day);
  for (const [key, value] of original) assert.deepEqual(f.map.get(key), value);
});

test("跨いで保存された観測も観測日ごとの96件予算に数え、翌観測日は新しい予算", async () => {
  const f = fixture(),
    end = Date.parse(cutoff),
    previousDay = jstDay(end - 1),
    nextDay = jstDay(end);
  for (let i = 0; i < 96; i++) {
    f.time(end + i + 1);
    f.data.observedAt = new Date(end - 100 + i).toISOString();
    f.data.tasks[0].estimate = i;
    await f.read();
  }
  f.time(end + 100);
  f.data.observedAt = new Date(end - 1).toISOString();
  f.data.tasks[0].estimate = 96;
  const limited = await f.read();
  assert.equal(limited.recordingLimited, true);
  assert.equal(limited.current.remainingHours, 96);
  assert.equal(limited.display.summary.remainingHours, 95);
  assert.equal(
    [...f.map.keys()].filter((key) =>
      key.startsWith(`observation:${previousDay}:`),
    ).length,
    96,
  );
  f.time(end + 60000);
  const next = await f.read();
  assert.equal(next.recordingLimited, false);
  assert.equal(next.display.summary.remainingHours, 95);
  assert.equal(
    [...f.map.keys()].filter((key) => key.startsWith(`observation:${nextDay}:`))
      .length,
    1,
  );
});

test("180日外のobservedAtを持つ遅い応答は保存nowの日へ移さず保持期限外として除く", async () => {
  const f = fixture(),
    observed = new Date(Date.parse(cutoff) - 1).toISOString();
  f.time(Date.parse(cutoff) + 181 * 86400000);
  f.data.observedAt = observed;
  const result = await f.read();
  assert.equal(result.display.summary, null);
  assert.deepEqual(result.observations, []);
  assert.equal(f.map.has(`day:${jstDay(Date.parse(observed))}`), false);
  assert.equal(raw(f).length, 0);
});

test("active windowはpinしないが終了後はdue・policy変更と再起動でも旧pinを再解釈しない", async () => {
  const f = fixture();
  await f.read();
  assert.equal(pins(f).length, 0);
  f.time(cutoff);
  const ended = await f.read();
  const savedPins = structuredClone(pins(f));
  assert.equal(savedPins.length, 1);
  assert.deepEqual(Object.keys(savedPins[0][1]).sort(), ["cutoff", "policy"]);
  f.data.milestones[0].dueOn = "2027-03-31T00:00:00Z";
  f.data.milestones[0].assignmentWindow = {
    policy: "future-unknown-policy",
    startAt: cutoff,
    endAt: "2027-03-30T15:00:00Z",
  };
  f.restart();
  assert.deepEqual((await f.read()).display, ended.display);
  assert.deepEqual(pins(f), savedPins);
  delete f.data.milestones[0].assignmentWindow;
  assert.deepEqual((await f.read()).display, ended.display);
});

test("active中の正式metadata訂正は終了まで固定せず、初回終了時の境界だけをpin", async () => {
  const f = fixture();
  await f.read();
  const later = "2026-10-29T15:00:00.000Z";
  f.data.milestones[0].assignmentWindow.endAt = later;
  f.time(cutoff);
  assert.equal((await f.read()).display.mode, "live");
  assert.equal(pins(f).length, 0);
  f.time(later);
  assert.equal((await f.read()).display.cutoff, later);
});

test("選択されていない終了sprintも完全source取得とalarmで境界だけをpin", async () => {
  const f = fixture();
  await f.read();
  f.time(cutoff);
  await f.fire();
  assert.equal(pins(f).length, 1);
  assert.equal(pins(f)[0][1].cutoff, cutoff);
  f.data.milestones[0].assignmentWindow.endAt = "2027-03-30T15:00:00.000Z";
  assert.equal((await f.read(null)).milestone, 10);
  assert.equal((await f.read()).display.cutoff, cutoff);
});

test("180日保持を過ぎた終了summaryは消え、pinだけから復活させない", async () => {
  const f = fixture();
  await f.read();
  const originalKeys = raw(f).map(([key]) => key);
  f.time(cutoff);
  assert.equal((await f.read()).display.summary.remainingHours, 5);
  f.time(Date.parse(cutoff) + 181 * 86400000);
  const expired = await f.read();
  assert.equal(expired.display.mode, "historical");
  assert.equal(expired.display.summary, null);
  assert.equal(expired.display.observedAt, null);
  assert.equal(expired.display.cutoff, cutoff);
  assert.deepEqual(expired.observations, []);
  for (const key of originalKeys) assert.equal(f.map.has(key), false);
  assert.ok(pins(f).every(([, value]) => !Object.hasOwn(value, "summary")));
});

for (const status of [403, 503])
  test(`終了履歴があっても毎回source/public確認し${status}を履歴で迂回しない`, async () => {
    const f = fixture();
    await f.read();
    f.time(cutoff);
    await f.read();
    const before = structuredClone([...f.map]),
      reads = f.reads;
    f.status = status;
    const response = await f.fetch();
    assert.equal(response.status, status);
    assert.equal(f.reads, reads + 1);
    assert.equal(Object.hasOwn(await response.json(), "display"), false);
    assert.deepEqual([...f.map], before);
  });

test("scope変更時は別pinと同scopeの観測だけを使用し他scopeの5hを開示しない", async () => {
  const f = fixture();
  await f.read();
  f.time(cutoff);
  await f.read();
  f.data.scope = "different-filter";
  const changed = await f.read();
  assert.equal(changed.display.summary, null);
  assert.deepEqual(changed.observations, []);
  assert.equal(pins(f).length, 2);
  assert.ok(
    pins(f).every(([key]) => /^sprint-boundary:[a-f0-9]{64}:9$/.test(key)),
  );
  f.data.scope = "type:PBI";
  assert.equal((await f.read()).display.summary.remainingHours, 5);
});

test("学校カレンダー変更は終了境界・保存summaryに影響しない", async () => {
  const f = fixture();
  await f.read();
  f.time(cutoff);
  const before = await f.read(),
    savedPins = structuredClone(pins(f));
  assert.equal((await f.save(["2026-10-20", "2026-10-28"])).status, 200);
  const after = await f.read();
  assert.deepEqual(after.display, before.display);
  assert.deepEqual(pins(f), savedPins);
  assert.deepEqual(after.schedule.schoolDays, ["2026-10-20", "2026-10-28"]);
});

test("metadataなし・未知policy・非JST境界はdueだけで終了と推測せずlive", async () => {
  for (const window of [
    undefined,
    { policy: "unknown", startAt: "2026-10-20T15:00:00Z", endAt: cutoff },
    { policy, startAt: "2026-10-20T00:00:00Z", endAt: "2026-10-28T00:00:00Z" },
  ]) {
    const f = fixture();
    f.data.milestones[0].assignmentWindow = window;
    f.time(cutoff);
    const result = await f.read();
    assert.equal(result.display.mode, "live");
    assert.equal(result.display.summary.remainingHours, 5);
    assert.equal(pins(f).length, 0);
  }
  const f = fixture();
  f.data.milestones[0].assignmentWindow.endAt = "invalid-date";
  assert.equal(validateBurnSource(f.data), false);
  assert.equal((await f.fetch()).status, 503);
});

test("同時終了GETとpin tx失敗でも半端な境界を残さず、再取得は同じ終了点を返す", async () => {
  const f = fixture();
  await f.read();
  f.time(cutoff);
  f.failPinCommit = true;
  assert.equal((await f.fetch()).status, 503);
  assert.equal(pins(f).length, 0);
  f.failPinCommit = false;
  const results = await Promise.all([f.read(), f.read(), f.read(10)]);
  assert.equal(pins(f).length, 1);
  assert.deepEqual(results[0].display, results[1].display);
  assert.equal(results[0].display.summary.remainingHours, 5);
  assert.equal(results[2].display.mode, "live");
});
