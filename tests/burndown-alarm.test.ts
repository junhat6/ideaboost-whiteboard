import test from "node:test";
import assert from "node:assert/strict";
import { BurnHistory, jstDay, nextJstDay } from "../worker/burndown.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

// Synthetic storage only: fired alarms are consumed, transactions commit together,
// and restart retains durable data but creates a new BurnHistory instance.
function fixture() {
  let now = Date.parse("2026-10-27T14:00:00Z"),
    alarm: number | null = null,
    sourceReads = 0,
    transactions = 0,
    inTransaction = false,
    failSetAlarm = false,
    failCommit = false,
    failObservationWrite = false,
    alarmGate: ReturnType<typeof deferred> | null = null,
    alarmEntered: ReturnType<typeof deferred> | null = null;
  const map = new Map<string, any>(),
    data: any = {
      ok: true,
      scope: "view16",
      observedAt: new Date(now).toISOString(),
      milestones: [{ number: 9, title: "Sprint 9", dueOn: null }],
      tasks: [
        {
          id: "task",
          parent: "pbi",
          estimate: 2,
          status: "作業中",
          complete: false,
          milestone: 9,
        },
      ],
    };
  let source: () => Promise<Response> = async () => Response.json(data);
  const methods = (
    values: Map<string, any>,
    state: { alarm: number | null },
  ) => ({
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      const entries =
        typeof key === "string" ? [[key, value]] : Object.entries(key);
      if (
        failObservationWrite &&
        entries.some(([k]) => String(k).startsWith("observation:"))
      )
        throw Error("synthetic observation write failed");
      for (const [k, v] of entries) values.set(String(k), structuredClone(v));
    },
    delete: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...values].filter(([key]) => key.startsWith(prefix)).sort()),
    getAlarm: async () => {
      const previous = state.alarm,
        gate = alarmGate;
      if (gate) {
        alarmGate = null;
        alarmEntered!.resolve();
        await gate.promise;
      }
      return previous;
    },
    setAlarm: async (time: number | Date) => {
      if (failSetAlarm) throw Error("synthetic setAlarm failed");
      state.alarm = Number(time);
    },
  });
  const liveState = {
    get alarm() {
      return alarm;
    },
    set alarm(value: number | null) {
      alarm = value;
    },
  };
  const storage: any = {
    ...methods(map, liveState),
    transaction: async (run: (tx: any) => Promise<unknown>) => {
      assert.equal(
        inTransaction,
        false,
        "scheduler transactions must not overlap",
      );
      transactions++;
      inTransaction = true;
      const pending = structuredClone(map),
        state = { alarm };
      try {
        const result = await run(methods(pending, state));
        if (failCommit) throw Error("synthetic transaction commit failed");
        map.clear();
        for (const [key, value] of pending) map.set(key, value);
        alarm = state.alarm;
        return result;
      } finally {
        inTransaction = false;
      }
    },
  };
  const create = () =>
    new BurnHistory(
      storage,
      async () => {
        assert.equal(
          inTransaction,
          false,
          "upstream fetch must remain outside storage transactions",
        );
        sourceReads++;
        return source();
      },
      () => now,
    );
  let history = create();
  const setTime = (time: number) => {
    now = time;
    data.observedAt = new Date(now).toISOString();
  };
  return {
    data,
    map,
    get now() {
      return now;
    },
    get alarm() {
      return alarm;
    },
    get sourceReads() {
      return sourceReads;
    },
    get transactions() {
      return transactions;
    },
    set failSetAlarm(value: boolean) {
      failSetAlarm = value;
    },
    set failCommit(value: boolean) {
      failCommit = value;
    },
    set failObservationWrite(value: boolean) {
      failObservationWrite = value;
    },
    set source(value: () => Promise<Response>) {
      source = value;
    },
    set status(value: number) {
      source = async () =>
        value === 200
          ? Response.json(data)
          : Response.json(
              { error: "observation_unavailable" },
              { status: value },
            );
    },
    setTime,
    reserve(time: number | null) {
      alarm = time;
    },
    restart() {
      history = create();
    },
    read: (milestone = 9) =>
      history.fetch(
        new Request(`https://test/api/burndown?milestone=${milestone}`),
      ),
    fire(time = alarm ?? now) {
      setTime(time);
      alarm = null;
      return history.alarm();
    },
    pauseNextAlarmRead() {
      const entered = deferred(),
        gate = deferred();
      alarmGate = gate;
      alarmEntered = entered;
      return { entered: entered.promise, release: gate.resolve };
    },
  };
}
const observations = (f: ReturnType<typeof fixture>) =>
  [...f.map].filter(([key]) => key.startsWith("observation:"));

async function integratedSourceFixture() {
  const { createHandler } = await import("../server/github.mjs"),
    { fixture: githubFixture, env, req } = await import("./github-fixture.mjs"),
    { webcrypto } = await import("node:crypto"),
    upstream = githubFixture({ viewFilter: "type:PBI", parentInProject: true }),
    f = fixture(),
    calls: { url: string; method: string; query?: string }[] = [];
  let mode:
      | number
      | "ok"
      | "network"
      | "incomplete"
      | "private"
      | "hours-private"
      | "graphql"
      | "invalid-json" = "ok",
    boundary: "bootstrap" | "relation" = "bootstrap";
  const config = {
    ...env,
    AUTH_MODE: "public-temporary",
    ESTIMATE_HOURS_READ_ENABLED: "true",
    ESTIMATE_HOURS_FIELD_ID: "123",
    ESTIMATE_HOURS_NODE_ID: "IFN_test",
    ESTIMATE_HOURS_PROJECT_FIELD_ID: "PVTF_test",
  };
  const handler = createHandler({
    crypto: webcrypto,
    now: () => f.now,
    fetch: async (url: string, options: any) => {
      const query = options.body ? JSON.parse(options.body).query : undefined;
      calls.push({ url, method: options.method || "GET", query });
      if (
        query?.includes(
          boundary === "bootstrap" ? "BoardBootstrap" : "ObservationChildren",
        )
      ) {
        if (typeof mode === "number")
          return Response.json(
            { message: "synthetic GitHub unavailable" },
            { status: mode },
          );
        if (mode === "network")
          throw new TypeError("synthetic GitHub network failure");
        if (mode === "graphql")
          return Response.json({
            errors: [{ message: "synthetic GraphQL failure" }],
          });
        if (mode === "invalid-json")
          return new Response("{broken", { status: 200 });
      }
      const response = await upstream.fetch(url, options),
        body = await response.json(),
        project = body.data?.organization?.projectV2;
      if (project && query?.includes("hoursField:"))
        project.hoursField = {
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
            visibility:
              mode === "hours-private" && query.includes("PublicScope")
                ? "ORG_ONLY"
                : "ALL",
          },
        };
      if (project && query?.includes("hoursValue:"))
        for (const item of project.items.nodes)
          item.hoursValue = {
            __typename: "ProjectV2ItemIssueFieldValue",
            field: { id: "PVTF_test" },
            issueFieldValue: {
              __typename: "IssueFieldNumberValue",
              value: 1.5,
              field: { id: "IFN_test" },
            },
          };
      if (project && mode === "incomplete" && query?.includes("BoardRowsFull"))
        project.items.pageInfo = {};
      if (
        project &&
        boundary === "relation" &&
        query?.includes("BoardRowsFull")
      )
        project.items.nodes[0].content.subIssuesSummary.total = 2;
      if (project && mode === "private" && query?.includes("PublicScope"))
        project.public = false;
      return Response.json(body, { status: response.status });
    },
  });
  const readSource = () => handler(req("/api/burndown"), config);
  f.source = readSource;
  return {
    f,
    set mode(value: typeof mode) {
      mode = value;
    },
    set boundary(value: typeof boundary) {
      boundary = value;
    },
    readSource,
    readBoard: () => handler(req("/api/board"), config),
    assertReadOnly() {
      for (const call of calls) {
        if (call.url.includes("/access_tokens")) continue; // Synthetic App auth only.
        if (call.url.endsWith("/graphql"))
          assert.match(call.query!, /^\s*query\b/);
        else assert.equal(call.method, "GET");
      }
    },
  };
}

test("実createHandlerのGitHub bootstrap 503からalarm短期再試行と復旧観測まで接続", async () => {
  const source = await integratedSourceFixture(),
    f = source.f;
  assert.equal((await f.read(1)).status, 200);
  const before = structuredClone(observations(f));
  source.mode = 503;
  await assert.rejects(f.fire(), /observation_unavailable/);
  assert.equal(f.alarm, f.now + 60000);
  assert.equal(f.map.get("alarm-retry").attempts, 1);
  assert.deepEqual(observations(f), before);
  source.mode = "ok";
  await f.fire();
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(observations(f).length, 2);
  assert.deepEqual(observations(f).slice(0, 1), before);
  assert.equal(observations(f).at(-1)![1].summaries[1].remainingHours, 1.5);
  source.assertReadOnly();
});

for (const failure of [429, 500, 502, 503, 504, "network"] as const)
  test(`実GitHub境界${failure}は観測unavailableへ区別し、alarmをretryして通常boardのエラーは変えない`, async () => {
    const source = await integratedSourceFixture(),
      f = source.f;
    source.mode = failure;
    const response = await source.readSource();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "observation_unavailable");
    const board = await source.readBoard(),
      problem = await board.json();
    assert.equal(board.status, 502);
    assert.equal(
      problem.error,
      failure === "network" ? "github_network_error" : "github_request_failed",
    );
    if (typeof failure === "number")
      assert.equal(problem.upstreamStatus, failure);
    await assert.rejects(f.fire(), /observation_unavailable/);
    assert.equal(f.alarm, f.now + 60000);
    assert.equal(f.map.get("alarm-retry").attempts, 1);
    assert.equal(observations(f).length, 0);
    source.assertReadOnly();
  });

for (const [mode, status, error] of [
  ["incomplete", 503, "observation_incomplete"],
  ["private", 403, "scope_not_public"],
  ["hours-private", 403, "estimate_hours_not_public"],
  [401, 503, "observation_incomplete"],
  ["graphql", 503, "observation_incomplete"],
  ["invalid-json", 503, "observation_incomplete"],
] as const)
  test(`実source ${mode}は履歴を守り短期retryしない`, async () => {
    const source = await integratedSourceFixture(),
      f = source.f;
    assert.equal((await f.read(1)).status, 200);
    const before = structuredClone(observations(f));
    source.mode = mode;
    const response = await source.readSource();
    assert.equal(response.status, status);
    assert.equal((await response.json()).error, error);
    await assert.rejects(f.fire());
    assert.equal(f.alarm, nextJstDay(f.now));
    assert.equal(f.map.has("alarm-retry"), false);
    assert.deepEqual(observations(f), before);
    source.assertReadOnly();
  });

for (const [failure, retry] of [
  [401, false],
  [429, true],
  [503, true],
  ["network", true],
  ["graphql", false],
  ["invalid-json", false],
] as const)
  test(`実relation境界${failure}はouter502ではなくupstream原因でretry=${retry}を判断`, async () => {
    const source = await integratedSourceFixture(),
      f = source.f;
    assert.equal((await f.read(1)).status, 200);
    const before = structuredClone(observations(f));
    source.boundary = "relation";
    source.mode = failure;
    const response = await source.readSource(),
      problem = await response.json();
    assert.equal(response.status, 502);
    assert.equal(
      problem.error,
      typeof failure === "number"
        ? "github_request_failed"
        : failure === "network"
          ? "github_network_error"
          : failure === "graphql"
            ? "github_graphql_error"
            : "github_invalid_response",
    );
    if (typeof failure === "number")
      assert.equal(problem.upstreamStatus, failure);
    await assert.rejects(f.fire());
    assert.equal(f.alarm, retry ? f.now + 60000 : nextJstDay(f.now));
    assert.equal(f.map.has("alarm-retry"), retry);
    assert.deepEqual(observations(f), before);
    // The standard board does not perform the chart-only relation reconciliation.
    const board = await source.readBoard();
    assert.equal(board.status, 200);
    assert.equal((await board.json()).assigneeOptions[0].login, "alice");
    source.assertReadOnly();
  });

test("日次alarmの503は60秒後に再観測し、復旧時だけ新しい点を記録して過去点を保持", async () => {
  const f = fixture();
  assert.equal((await f.read()).status, 200);
  const before = structuredClone(observations(f));
  f.status = 503;
  await assert.rejects(f.fire());
  assert.equal(f.alarm, f.now + 60000);
  assert.deepEqual(f.map.get("alarm-retry"), {
    day: jstDay(f.now),
    attempts: 1,
  });
  assert.deepEqual(observations(f), before);
  f.status = 200;
  f.data.tasks[0].estimate = 5;
  await f.fire();
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(observations(f).length, 2);
  assert.deepEqual(observations(f).slice(0, 1), before);
  assert.equal(observations(f).at(-1)![1].summaries[9].remainingHours, 5);
  assert.equal(f.map.get("alarm-retry").attempts, 1);
});

test("永久503でもJST日ごとの短期追加予約は60/300/900秒の3回だけ、翌日に予算を更新", async () => {
  const f = fixture();
  f.status = 503;
  for (const [index, delay] of [60000, 300000, 900000].entries()) {
    await assert.rejects(f.fire());
    assert.equal(f.alarm, f.now + delay);
    assert.deepEqual(f.map.get("alarm-retry"), {
      day: jstDay(f.now),
      attempts: index + 1,
    });
  }
  await assert.rejects(f.fire());
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(f.map.get("alarm-retry").attempts, 3);
  assert.equal(f.sourceReads, 4);
  assert.equal(observations(f).length, 0);
  const previousDay = jstDay(f.now);
  await assert.rejects(f.fire());
  assert.notEqual(jstDay(f.now), previousDay);
  assert.equal(f.alarm, f.now + 60000);
  assert.deepEqual(f.map.get("alarm-retry"), {
    day: jstDay(f.now),
    attempts: 1,
  });
  assert.equal(
    [...f.map.keys()].filter((key) => key.startsWith("alarm-")).length,
    1,
  );
});

test("GET成功・alarm成功・DO再起動でも同日の短期再試行予算を復活させない", async () => {
  const f = fixture();
  f.status = 503;
  await assert.rejects(f.fire());
  const firstAlarm = f.alarm;
  f.restart();
  f.status = 200;
  assert.equal((await f.read()).status, 200);
  assert.equal(f.alarm, firstAlarm);
  assert.equal(f.map.get("alarm-retry").attempts, 1);
  await f.fire();
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(f.map.get("alarm-retry").attempts, 1);
  f.restart();
  f.status = 503;
  await assert.rejects(f.fire(f.now + 1000));
  assert.equal(f.alarm, f.now + 300000);
  assert.equal(f.map.get("alarm-retry").attempts, 2);
  f.restart();
  await assert.rejects(f.fire());
  assert.equal(f.alarm, f.now + 900000);
  assert.equal(f.map.get("alarm-retry").attempts, 3);
  f.status = 200;
  await f.read();
  f.restart();
  f.status = 503;
  await assert.rejects(f.fire());
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(f.map.get("alarm-retry").attempts, 3);
});

for (const status of [429, 500, 502, 503, 504])
  test(`HTTP ${status}だけのsource失敗は短期再試行を1回予約し、観測を捏造しない`, async () => {
    const f = fixture();
    f.status = status;
    await assert.rejects(f.fire());
    assert.equal(f.alarm, f.now + 60000);
    assert.deepEqual(f.map.get("alarm-retry"), {
      day: jstDay(f.now),
      attempts: 1,
    });
    assert.equal(observations(f).length, 0);
  });

test("source()の通常transport rejectは元messageを保持して60秒後を予約", async () => {
  const f = fixture();
  f.source = async () => {
    throw new TypeError("synthetic fetch failed");
  };
  await assert.rejects(f.fire(), /synthetic fetch failed/);
  assert.equal(f.alarm, f.now + 60000);
  assert.equal(f.map.get("alarm-retry").attempts, 1);
});

for (const message of [
  "observation_incomplete",
  "scope_not_public",
  "estimate_hours_not_public",
  "invalid_private_key",
  "estimate_hours_unavailable",
])
  test(`source rejectでも既知の${message}は短期retryせず履歴を保護`, async () => {
    const f = fixture();
    await f.read();
    const before = structuredClone(observations(f));
    f.source = async () => {
      throw Error(message);
    };
    await assert.rejects(f.fire(), (error: Error) => error.message === message);
    assert.equal(f.alarm, nextJstDay(f.now));
    assert.equal(f.map.has("alarm-retry"), false);
    assert.deepEqual(observations(f), before);
  });

for (const [label, response] of [
  ...[400, 401, 403, 404, 408, 422, 501].map(
    (status) =>
      [
        `HTTP ${status}`,
        () => Response.json({ error: "unavailable" }, { status }),
      ] as const,
  ),
  [
    "field公開失効403",
    () =>
      Response.json({ error: "estimate_hours_not_public" }, { status: 403 }),
  ],
  [
    "不完全観測503",
    () => Response.json({ error: "observation_incomplete" }, { status: 503 }),
  ],
  [
    "公開失効を示す503",
    () => Response.json({ error: "scope_not_public" }, { status: 503 }),
  ],
  [
    "credential設定不備503",
    () => Response.json({ error: "invalid_private_key" }, { status: 503 }),
  ],
  [
    "見積field利用不可503",
    () =>
      Response.json({ error: "estimate_hours_unavailable" }, { status: 503 }),
  ],
  [
    "GitHub実status欠落502",
    () => Response.json({ error: "github_request_failed" }, { status: 502 }),
  ],
  [
    "GitHub実status型不正502",
    () =>
      Response.json(
        { error: "github_request_failed", upstreamStatus: "503" },
        { status: 502 },
      ),
  ],
  ["成功JSON parse失敗", () => new Response("{broken", { status: 200 })],
  ["成功source validation失敗", () => Response.json({ ok: true, tasks: [] })],
] as const)
  test(`${label}は短期retryせず通常日次だけを予約し、既存履歴を保持`, async () => {
    const f = fixture();
    await f.read();
    const before = structuredClone(observations(f));
    f.source = async () => response();
    await assert.rejects(f.fire());
    assert.equal(f.alarm, nextJstDay(f.now));
    assert.equal(f.map.has("alarm-retry"), false);
    assert.deepEqual(observations(f), before);
  });

test("観測storage失敗もsource通信失敗と区別し短期retry予算を消費しない", async () => {
  const f = fixture();
  await f.read();
  const before = structuredClone(observations(f));
  f.failObservationWrite = true;
  await assert.rejects(f.fire());
  assert.equal(f.alarm, nextJstDay(f.now));
  assert.equal(f.map.has("alarm-retry"), false);
  assert.deepEqual(observations(f), before);
});

test("閲覧はJST00:10をbootstrapするだけで、成功/失敗とも既存earlier alarmを延期しない", async () => {
  const f = fixture();
  await f.read();
  assert.equal(f.alarm, Date.parse("2026-10-27T15:10:00Z"));
  const earlier = f.now + 10000;
  f.reserve(earlier);
  await f.read();
  assert.equal(f.alarm, earlier);
  f.status = 503;
  assert.equal((await f.read()).status, 503);
  assert.equal(f.alarm, earlier);
  assert.equal(f.map.has("alarm-retry"), false);
});

test("alarm実行中に別予約されたearlier alarmを保持して追加予約予算を消費しない", async () => {
  const f = fixture();
  f.source = async () => {
    f.reserve(f.now + 10000);
    return Response.json({ error: "unavailable" }, { status: 503 });
  };
  await assert.rejects(f.fire());
  assert.equal(f.alarm, f.now + 10000);
  assert.equal(f.map.has("alarm-retry"), false);
});

test("JST00:10が短期候補より早い時は通常日次を優先しretry予算を消費しない", async () => {
  const f = fixture();
  f.setTime(Date.parse("2026-10-27T15:09:45Z"));
  f.status = 503;
  await assert.rejects(f.fire());
  assert.equal(f.alarm, Date.parse("2026-10-27T15:10:00Z"));
  assert.equal(f.map.has("alarm-retry"), false);
  await assert.rejects(f.fire());
  assert.equal(f.alarm, f.now + 60000);
  assert.equal(f.map.get("alarm-retry").attempts, 1);
});

test("短期予約がJST日付を跨いだ場合も新しい日の最初の追加予約は60秒", async () => {
  const f = fixture();
  f.setTime(Date.parse("2026-10-27T14:59:50Z"));
  f.status = 503;
  await assert.rejects(f.fire());
  assert.deepEqual(f.map.get("alarm-retry"), {
    day: "2026-10-27",
    attempts: 1,
  });
  assert.equal(f.alarm, Date.parse("2026-10-27T15:00:50Z"));
  await assert.rejects(f.fire());
  assert.deepEqual(f.map.get("alarm-retry"), {
    day: "2026-10-28",
    attempts: 1,
  });
  assert.equal(f.alarm, f.now + 60000);
});

test("GETのgetAlarm保留中のalarm完了予約も同queueを通り、短期再試行を翌日へ延期しない", async () => {
  const f = fixture();
  f.status = 503;
  const gate = f.pauseNextAlarmRead(),
    reading = f.read();
  let alarming: Promise<void> | undefined,
    timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gate.entered,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(Error("getAlarm gate was not reached")),
          1000,
        );
      }),
    ]);
    alarming = assert.rejects(f.fire(), /observation_unavailable/);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.transactions, 1);
    assert.equal(f.sourceReads, 0);
  } finally {
    clearTimeout(timeout);
    gate.release();
  }
  const [response] = await Promise.all([reading, alarming]);
  assert.equal(response.status, 503);
  assert.equal(f.alarm, f.now + 60000);
  assert.deepEqual(f.map.get("alarm-retry"), {
    day: jstDay(f.now),
    attempts: 1,
  });
  assert.equal(f.sourceReads, 1);
});

for (const failure of ["setAlarm", "commit"])
  test(`scheduler transaction途中の${failure}失敗はbudgetとalarmを一緒にrollback`, async () => {
    const f = fixture();
    f.status = 503;
    const previous = { day: jstDay(f.now), attempts: 1 };
    f.map.set("alarm-retry", previous);
    if (failure === "setAlarm") f.failSetAlarm = true;
    else f.failCommit = true;
    await assert.rejects(f.fire(), /synthetic/);
    assert.deepEqual(f.map.get("alarm-retry"), previous);
    assert.equal(f.alarm, null);
    f.failSetAlarm = false;
    f.failCommit = false;
    f.restart();
    await assert.rejects(f.fire());
    assert.equal(f.map.get("alarm-retry").attempts, 2);
    assert.equal(f.alarm, f.now + 300000);
  });

test("同日retry state不正は予算上限としてfail closed、日付変更時だけ正常な予算を開始", async () => {
  for (const attempts of [-1, 4, 1.5, "1", null]) {
    const f = fixture();
    f.status = 503;
    const previous = { day: jstDay(f.now), attempts };
    f.map.set("alarm-retry", previous);
    await assert.rejects(f.fire());
    assert.equal(f.alarm, nextJstDay(f.now));
    assert.deepEqual(f.map.get("alarm-retry"), previous);
    f.restart();
    await assert.rejects(f.fire());
    assert.deepEqual(f.map.get("alarm-retry"), {
      day: jstDay(f.now),
      attempts: 1,
    });
    assert.equal(f.alarm, f.now + 60000);
  }
});
