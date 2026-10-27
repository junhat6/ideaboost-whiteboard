import test from "node:test";
import assert from "node:assert/strict";
import {
  BurnHistory,
  summarizeBurn,
  validateBurnSource,
  jstDay,
  nextJstDay,
  validSchoolDays,
  completedBurnTask,
} from "../worker/burndown.ts";
function fixture(sourceOverride?: () => Promise<Response>) {
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
      return sourceOverride
        ? sourceOverride()
        : Response.json(data, { status });
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
    excludedChildren: 0,
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
  assert.deepEqual(result.schedule.schoolDays, [
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
  ]);
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
test("取得失敗・不完全応答は偽ゼロを記録せず、失効時も履歴を保持して公開を遮断", async () => {
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
  const stored = [...f.map].filter(([k]) => k.startsWith("observation:"));
  assert.equal(stored.length, 1);
  f.status = 200;
  f.data.tasks[0].estimate = 2;
  const recovered: any = await (await f.read()).json();
  assert.equal(recovered.observations.length, 1);
  assert.equal(recovered.observations[0].remainingHours, 2);
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
test("実handlerのoptional query失敗/不完全ページは既存履歴を消さず、復旧で再利用", async () => {
  const {
    fixture: githubFixture,
    env,
    req,
  } = await import("./github-fixture.mjs");
  const { createHandler } = await import("../server/github.mjs");
  const { webcrypto } = await import("node:crypto");
  const github = githubFixture({
    viewFilter: "type:PBI",
    parentInProject: true,
  });
  let mode = "ok";
  const config = {
    ...env,
    AUTH_MODE: "public-temporary",
    ESTIMATE_HOURS_READ_ENABLED: "true",
    ESTIMATE_HOURS_FIELD_ID: "123",
    ESTIMATE_HOURS_NODE_ID: "IFN_test",
    ESTIMATE_HOURS_PROJECT_FIELD_ID: "PVTF_test",
  };
  const field = {
    __typename: "ProjectV2Field",
    id: "PVTF_test",
    name: "Estimate Hours",
    dataType: "NUMBER",
    isIssueField: true,
    issueField: {
      __typename: "IssueFieldNumber",
      id: "IFN_test",
      fullDatabaseId: "123",
      name: "Estimate Hours",
      dataType: "NUMBER",
      visibility: "ALL",
    },
  };
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url: any, opt: any) => {
      const q = opt.body ? JSON.parse(opt.body).query : "";
      if (mode === "optional-error" && q?.includes("hoursField:"))
        return Response.json({
          errors: [{ message: "temporarily unavailable" }],
        });
      const response = await github.fetch(url, opt),
        data = await response.json(),
        project = data.data?.organization?.projectV2;
      if (project && q?.includes("hoursField:"))
        project.hoursField = {
          ...field,
          issueField: {
            ...field.issueField,
            visibility: mode === "private" ? "ORG_ONLY" : "ALL",
          },
        };
      if (project && q?.includes("hoursValue:"))
        for (const item of project.items.nodes) item.hoursValue = null;
      if (project && q?.includes("BoardRowsFull") && mode === "bad-page")
        project.items = { nodes: [], pageInfo: {} };
      return Response.json(data, { status: response.status });
    },
  });
  const f = fixture(() => handler(req("/api/burndown"), config));
  assert.equal((await f.read()).status, 404); // Fixture milestone is 1; the observation is still recorded.
  const original = structuredClone([...f.map]);
  for (const failure of ["optional-error", "bad-page", "private"]) {
    mode = failure;
    const response = await f.history.fetch(
      new Request("https://test/api/burndown?milestone=1"),
    );
    assert.equal(response.status, failure === "private" ? 403 : 503);
    assert.deepEqual([...f.map], original);
  }
  mode = "ok";
  const recovered: any = await (
    await f.history.fetch(new Request("https://test/api/burndown?milestone=1"))
  ).json();
  assert.equal(recovered.observations.length, 1);
  assert.equal(recovered.current.unestimated, 1);
});
test("JST00:05の失敗した閲覧でも当日00:10のalarmを翌日に延期しない", async () => {
  const f = fixture();
  f.advance(65 * 60000);
  f.status = 503;
  assert.equal((await f.read()).status, 503);
  assert.equal(f.alarm, Date.parse("2026-10-27T15:10:00Z"));
  assert.equal(
    nextJstDay(Date.parse("2026-10-27T15:10:00Z")),
    Date.parse("2026-10-28T15:10:00Z"),
  );
});

const settingsRequest = (
  schoolDays: string[],
  expectedRevision = "0",
  requestId = crypto.randomUUID(),
  milestone = 9,
) =>
  new Request(`https://test/api/burndown/schedule?milestone=${milestone}`, {
    method: "POST",
    headers: { Origin: "https://test" },
    body: JSON.stringify({ schoolDays, expectedRevision, requestId }),
  });
test("学校日程は限定設定として永続保存、競合・同request・公開失効と既存履歴を保護", async () => {
  const f = fixture();
  const first: any = await (await f.read()).json();
  assert.equal(first.schedule.schoolDays.length, 6);
  const before = structuredClone(
    [...f.map].filter(([k]) => k.startsWith("observation:")),
  );
  const id = crypto.randomUUID(),
    days = ["2026-10-22", "2026-10-28"];
  const response = await f.history.fetch(settingsRequest(days, "0", id));
  assert.equal(response.status, 200);
  const saved: any = await response.json();
  assert.deepEqual((await (await f.read()).json()).schedule, saved.schedule);
  assert.deepEqual(
    await (await f.history.fetch(settingsRequest(days, "0", id))).json(),
    saved,
  );
  assert.equal(
    (await f.history.fetch(settingsRequest([], "0", id))).status,
    409,
  );
  assert.equal((await f.history.fetch(settingsRequest([], "0"))).status, 409);
  assert.deepEqual(
    [...f.map].filter(([k]) => k.startsWith("observation:")),
    before,
  );
  assert.equal(
    (await f.history.fetch(settingsRequest([], "0", crypto.randomUUID(), 999)))
      .status,
    404,
  );
  f.status = 403;
  assert.equal(
    (await f.history.fetch(settingsRequest([], saved.schedule.revision)))
      .status,
    403,
  );
  assert.deepEqual(f.map.get("school-days:9"), saved.schedule);
  f.status = 200;
  assert.equal(
    (await f.history.fetch(settingsRequest([], saved.schedule.revision)))
      .status,
    200,
  );
  assert.deepEqual((await (await f.read()).json()).schedule.schoolDays, []);
});
test("日程validationは実在日付/順序/重複/長さ/Originを限定する", async () => {
  for (const dates of [
    ["2026-02-30"],
    ["2026-10-21", "2026-10-21"],
    ["2026-10-22", "2026-10-21"],
    ["2026-01-01", "2026-12-31"],
    Array(61).fill("2026-10-21"),
  ])
    assert.equal(validSchoolDays(dates), false);
  assert.equal(validSchoolDays([]), true);
  assert.equal(validSchoolDays(["2026-10-21"]), true);
  const f = fixture();
  assert.equal(
    (await f.history.fetch(settingsRequest(["2026-02-30"]))).status,
    400,
  );
  assert.equal(
    (
      await f.history.fetch(
        new Request("https://test/api/burndown/schedule?milestone=9", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.history.fetch(
        new Request("https://test/api/burndown/schedule?milestone=9", {
          method: "POST",
          headers: { Origin: "https://test" },
          body: "x".repeat(4097),
        }),
      )
    ).status,
    400,
  );
  assert.equal(f.reads, 0);
});
test("Status完了またはclosed-completedは残りから除き、not_planned/見送りは成果にしない", () => {
  const f = fixture();
  const base = f.data.tasks[0];
  const cases = [
    { status: "完了", state: "OPEN", stateReason: null, complete: true },
    {
      status: "作業中",
      state: "CLOSED",
      stateReason: "COMPLETED",
      complete: true,
    },
    {
      status: "作業中",
      state: "OPEN",
      stateReason: "REOPENED",
      complete: false,
    },
    {
      status: "完了",
      state: "CLOSED",
      stateReason: "NOT_PLANNED",
      complete: false,
    },
    {
      status: "見送り",
      state: "CLOSED",
      stateReason: "COMPLETED",
      complete: false,
    },
  ];
  f.data.tasks = cases.map((v, i) => ({ ...base, ...v, id: String(i) }));
  assert.equal(validateBurnSource(f.data), true);
  for (const task of f.data.tasks)
    assert.equal(completedBurnTask(task), task.complete);
  const sum = summarizeBurn(f.data.tasks);
  assert.equal(sum.estimatedHours, 6);
  assert.equal(sum.remainingHours, 2);
  assert.equal(sum.cancelled, 2);
  f.data.tasks[1].complete = false;
  assert.equal(validateBurnSource(f.data), false);
});
