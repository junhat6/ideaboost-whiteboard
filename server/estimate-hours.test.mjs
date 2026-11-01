import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler, validateMutation } from "./github.mjs";
import { fixture, env, req } from "../tests/github-fixture.mjs";
import {
  hoursContract,
  publicHours,
  projectHours,
  validHours,
} from "./estimate-hours.mjs";
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
const value = {
  __typename: "ProjectV2ItemIssueFieldValue",
  field: { id: "PVTF_test" },
  issueFieldValue: {
    __typename: "IssueFieldNumberValue",
    value: 1.5,
    field: { id: "IFN_test" },
  },
};
test("公開canonical Numberのみ、非負有限、nullと取得不可を区別", () => {
  assert.equal(hoursContract({}), null);
  assert.equal(publicHours(field, config), true);
  assert.equal(
    publicHours(
      { ...field, issueField: { ...field.issueField, visibility: "ORG_ONLY" } },
      config,
    ),
    false,
  );
  assert.equal(projectHours(value, config), 1.5);
  assert.equal(projectHours(null, config), null);
  assert.equal(projectHours(undefined, config), undefined);
  assert.equal(
    projectHours({ ...value, field: { id: "other" } }, config),
    undefined,
  );
  for (const v of [-1, Infinity, NaN, 1001, "1"])
    assert.equal(validHours(v), false);
  for (const v of [null, 0, 0.1, 2.5, 1000]) assert.equal(validHours(v), true);
});
for (const mode of ["value", "unset", "missing", "private-end"])
  test(`Task同梱 ${mode}、REST N+1なし`, async () => {
    const f = fixture({ viewFilter: "type:PBI", parentInProject: true });
    const h = createHandler({
      crypto: webcrypto,
      fetch: async (url, opt) => {
        const q = opt.body ? JSON.parse(opt.body).query : "";
        const r = await f.fetch(url, opt);
        const d = await r.json();
        const p = d.data?.organization?.projectV2;
        if (p && q?.includes("hoursField:"))
          p.hoursField = {
            ...field,
            issueField: {
              ...field.issueField,
              visibility:
                mode === "private-end" && q.includes("PublicScope")
                  ? "ORG_ONLY"
                  : "ALL",
            },
          };
        if (p && q?.includes("hoursValue:"))
          for (const i of p.items.nodes)
            if (mode !== "missing")
              i.hoursValue = mode === "unset" ? null : value;
        return Response.json(d, { status: r.status });
      },
    });
    const r = await h(req(), config);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.tasks.length, 1);
    assert.equal(
      b.tasks[0].estimateHours,
      mode === "value" ? 1.5 : mode === "unset" ? null : undefined,
    );
    assert.equal(
      f.calls.some((c) => /issue-field-values|issue-fields/.test(c.url)),
      false,
    );
  });

test("時間だけの保存は単一field POST/解除、本文を変更しない", async () => {
  const { patch } = await import("../tests/github-fixture.mjs");
  const f = fixture();
  let current = null;
  const writes = [];
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) => {
      if (url.endsWith("/orgs/engineer-first/issue-fields"))
        return Response.json([
          {
            id: 123,
            name: "Estimate Hours",
            data_type: "number",
            visibility: "all",
          },
        ]);
      if (url.includes("/issue-field-values")) {
        if (opt.method === "POST") {
          writes.push({ url, method: opt.method, body: JSON.parse(opt.body) });
          current = JSON.parse(opt.body).issue_field_values[0].value;
        }
        if (opt.method === "DELETE") {
          writes.push({ url, method: opt.method });
          current = null;
          return new Response(null, { status: 204 });
        }
        return Response.json(
          current === null
            ? []
            : [{ issue_field_id: 123, data_type: "number", value: current }],
        );
      }
      return f.fetch(url, opt);
    },
  });
  for (const [value, old, id] of [
    [2.5, null, "hours-request-0001"],
    [null, 2.5, "hours-request-0002"],
  ]) {
    const payload = patch({
      estimateHours: value,
      expectedEstimateHours: old,
      requestId: id,
    });
    delete payload.title;
    const r = await handler(req("/api/issues/2", payload), config);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).issue.estimateHours, value);
  }
  assert.deepEqual(writes[0].body, {
    issue_field_values: [{ field_id: 123, value: 2.5 }],
  });
  assert.equal(writes[1].method, "DELETE");
  assert.ok(writes[1].url.endsWith("/123"));
  assert.equal(
    f.calls.some((c) => c.method === "PATCH"),
    false,
  );
});
test("不正時間/expected欠落を拒否し、公開field確認不能は書込なし", async () => {
  const { patch } = await import("../tests/github-fixture.mjs");
  for (const v of [-1, Infinity, 1001, "1"])
    assert.throws(() =>
      validateMutation(
        patch({ estimateHours: v, expectedEstimateHours: null }),
      ),
    );
  assert.throws(() => validateMutation(patch({ estimateHours: 1 })));
  const f = fixture();
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) =>
      url.endsWith("/orgs/engineer-first/issue-fields")
        ? Response.json([
            {
              id: 123,
              name: "Estimate Hours",
              data_type: "number",
              visibility: "organization_members_only",
            },
          ])
        : f.fetch(url, opt),
  });
  const r = await handler(
    req(
      "/api/issues/2",
      patch({ estimateHours: 1, expectedEstimateHours: null }),
    ),
    config,
  );
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "estimate_hours_not_public");
  assert.equal(
    f.calls.some(
      (c) => c.method === "PATCH" || c.url.includes("/issue-field-values"),
    ),
    false,
  );
});
for (const type of ["Bug", "競合調査", "Future work", null])
  test(`種類 ${type} も正式PBI配下の末端作業として同梱・集計`, async () => {
    const f = fixture({
      viewFilter: "type:PBI",
      parentInProject: true,
      extraTasks: true,
    });
    f.issue.issueType = type === null ? null : { name: type };
    const handler = createHandler({
      crypto: webcrypto,
      fetch: async (url, opt) => {
        const q = opt.body ? JSON.parse(opt.body).query : "";
        const r = await f.fetch(url, opt),
          d = await r.json();
        const p = d.data?.organization?.projectV2;
        if (p && q?.includes("hoursField:")) p.hoursField = field;
        if (p && q?.includes("hoursValue:"))
          for (const item of p.items.nodes) item.hoursValue = value;
        return Response.json(d, { status: r.status });
      },
    });
    const response = await handler(req("/api/burndown"), config);
    assert.equal(response.status, 200);
    const result = await response.json();
    // I2 has child I3: I2's estimate is never added to I3's estimate.
    assert.deepEqual(
      result.tasks.map((t) => t.id),
      ["I3"],
    );
    assert.equal(result.tasks[0].estimate, 1.5);
    assert.equal(result.tasks[0].parent, "I2");
    assert.equal(result.tasks[0].pbi, "I1");
  });
test("Project外に子が欠けた観測は0件や親見積へ置き換えない", async () => {
  const f = fixture({ viewFilter: "type:PBI", parentInProject: true });
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) => {
      const q = opt.body ? JSON.parse(opt.body).query : "";
      const r = await f.fetch(url, opt),
        d = await r.json(),
        p = d.data?.organization?.projectV2;
      if (p && q?.includes("hoursField:")) p.hoursField = field;
      if (p && q?.includes("hoursValue:"))
        for (const item of p.items.nodes) {
          item.hoursValue = value;
          item.content.subIssuesSummary.total = 1;
        }
      return Response.json(d, { status: r.status });
    },
  });
  const response = await handler(req("/api/burndown"), config);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "observation_incomplete");
});
test("時間書込後の公開失効は明示コードとunknown fenceを保持", async () => {
  const { patch } = await import("../tests/github-fixture.mjs");
  const f = fixture();
  let wrote = false;
  const h = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) => {
      if (url.endsWith("/orgs/engineer-first/issue-fields"))
        return Response.json([
          {
            id: 123,
            name: "Estimate Hours",
            data_type: "number",
            visibility: wrote ? "organization_members_only" : "all",
          },
        ]);
      if (url.includes("/issue-field-values")) {
        if (opt.method === "POST") wrote = true;
        return Response.json([]);
      }
      return f.fetch(url, opt);
    },
  });
  const p = patch({ estimateHours: 2, expectedEstimateHours: null });
  delete p.title;
  const response = await h(req("/api/issues/2", p), config),
    data = await response.json();
  assert.equal(wrote, true);
  assert.equal(response.status, 403);
  assert.equal(data.error, "estimate_hours_not_public");
  assert.equal(data.ambiguous, true);
  assert.deepEqual(data.completed, ["estimateHours"]);
});
for (const [inProject, descendants] of [
  [false, 0],
  [true, 0],
  [false, 1],
  [false, undefined],
])
  test(`正式な子の欠落をProject外と読取不足に分ける ${inProject}/${descendants}`, async () => {
    const f = fixture({ viewFilter: "type:PBI", parentInProject: true });
    const h = createHandler({
      crypto: webcrypto,
      fetch: async (url, opt) => {
        const q = opt.body ? JSON.parse(opt.body).query : "";
        if (q?.includes("ObservationChildren"))
          return Response.json({
            data: {
              repository: {
                issue: {
                  id: "I2",
                  subIssues: {
                    nodes: [
                      {
                        id: "outside",
                        subIssuesSummary: { total: descendants },
                        issueType: { name: "Bug" },
                        repository: {
                          nameWithOwner: "engineer-first/idea-boost",
                        },
                        projectItems: {
                          nodes: inProject
                            ? [{ isArchived: false, project: { id: "P3" } }]
                            : [],
                          pageInfo: { hasNextPage: false },
                        },
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          });
        const r = await f.fetch(url, opt),
          d = await r.json(),
          p = d.data?.organization?.projectV2;
        if (p && q?.includes("hoursField:")) p.hoursField = field;
        if (p && q?.includes("hoursValue:"))
          for (const item of p.items.nodes) {
            item.hoursValue = value;
            item.content.subIssuesSummary.total = 1;
          }
        return Response.json(d, { status: r.status });
      },
    });
    const response = await h(req("/api/burndown"), config),
      data = await response.json();
    assert.equal(response.status, inProject || descendants !== 0 ? 503 : 200);
    if (!inProject && descendants === 0) {
      assert.deepEqual(data.tasks, []);
      assert.deepEqual(data.excludedChildren, [{ milestone: 1, count: 1 }]);
    } else assert.equal(data.error, "observation_incomplete");
  });

function assertObservationReadOnly(...fixtures) {
  for (const fixture of fixtures)
    for (const call of fixture.f.calls) {
      // Installation token minting is fixture auth, not an Issue/Project mutation.
      if (call.url.includes("/access_tokens")) continue;
      if (call.url.endsWith("/graphql"))
        assert.match(
          call.parsed.query,
          /^\s*query\b/,
          "観測中にGraphQL mutationを送っている",
        );
      else assert.equal(call.method, "GET", "観測中にREST書込を送っている");
    }
}

function observationReadFixture({
  viewFilter = "type:PBI",
  initialStatus = null,
  assigneesStatus = 200,
  assigneesGate,
  onAssigneesRead = () => {},
  visibility = "public",
} = {}) {
  const f = fixture({ viewFilter, parentInProject: true, initialStatus });
  f.issue.body = "観測元の本文を保持";
  f.issue.assignees.nodes = [
    {
      login: "assigned",
      name: "現在の担当",
      avatarUrl: "https://example.test/a",
    },
  ];
  let assigneesReads = 0,
    finalVisibilityReads = 0;
  const handler = createHandler({
    crypto: webcrypto,
    now: () => Date.parse("2026-10-27T08:00:00Z"),
    fetch: async (url, options) => {
      if (url.includes("/assignees")) {
        assigneesReads++;
        onAssigneesRead();
        if (assigneesGate) await assigneesGate;
        if (assigneesStatus !== 200)
          return Response.json(
            { message: "fixture assignees failure" },
            { status: assigneesStatus },
          );
      }
      const query = options.body ? JSON.parse(options.body).query : "",
        response = await f.fetch(url, options),
        data = await response.json(),
        project = data.data?.organization?.projectV2;
      if (query?.includes("PublicScope")) finalVisibilityReads++;
      if (project && query?.includes("hoursField:")) {
        project.hoursField = {
          ...field,
          issueField: {
            ...field.issueField,
            visibility:
              (visibility === "hours-private-end" &&
                query.includes("PublicScope")) ||
              (visibility === "hours-private-start" &&
                query.includes("BoardBootstrap"))
                ? "ORG_ONLY"
                : "ALL",
          },
        };
      }
      if (project && query?.includes("hoursValue:"))
        for (const item of project.items.nodes) item.hoursValue = value;
      if (
        project &&
        ((visibility === "project-private-start" &&
          query?.includes("BoardBootstrap")) ||
          (visibility === "project-private-end" &&
            query?.includes("PublicScope")))
      )
        project.public = false;
      return Response.json(data, { status: response.status });
    },
  });
  return {
    f,
    handler,
    assigneesReads: () => assigneesReads,
    finalVisibilityReads: () => finalVisibilityReads,
  };
}

test("観測はStatus完了でも見送り・重複クローズを成果にせず、正本の理由と見積を保持する", async () => {
  for (const stateReason of ["COMPLETED", "NOT_PLANNED", "DUPLICATE"]) {
    const f = observationReadFixture({ initialStatus: "完了" });
    Object.assign(f.f.issue, { state: "CLOSED", stateReason });
    const response = await f.handler(req("/api/burndown"), config);
    assert.equal(response.status, 200);
    const { tasks } = await response.json();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].complete, stateReason === "COMPLETED");
    assert.equal(tasks[0].stateReason, stateReason);
    assert.equal(tasks[0].status, "完了");
    assert.equal(tasks[0].estimate, 1.5);
    assertObservationReadOnly(f);
  }
});

test("観測は担当者候補503に依存せず、候補一覧なしで同じsourceを返す", async () => {
  const healthy = observationReadFixture(),
    failed = observationReadFixture({ assigneesStatus: 503 });
  const baseline = await healthy.handler(req("/api/burndown"), config),
    response = await failed.handler(req("/api/burndown"), config);
  assert.equal(baseline.status, 200);
  assert.equal(response.status, 200);
  const source = await response.json();
  assert.deepEqual(source, await baseline.json());
  assert.deepEqual(source, {
    ok: true,
    scope: "type:PBI",
    observedAt: "2026-10-27T08:00:00.000Z",
    milestones: [{ number: 1, title: "Sprint", dueOn: null }],
    tasks: [
      {
        id: "I2",
        parent: "I1",
        pbi: "I1",
        estimate: 1.5,
        status: null,
        state: "OPEN",
        stateReason: null,
        complete: false,
        milestone: 1,
      },
    ],
    excludedChildren: [],
  });
  assert.equal(healthy.assigneesReads(), 0);
  assert.equal(failed.assigneesReads(), 0);
  assert.equal(failed.finalVisibilityReads(), 1);
  assertObservationReadOnly(healthy, failed);
});

test("担当者候補の未解放gateでも観測は完了し、通常boardは候補完了を待つ（合成遅延）", async (t) => {
  let release = () => {},
    assigneesEntered = () => {},
    timeout;
  const gate = new Promise((resolve) => (release = resolve)),
    entered = new Promise((resolve) => (assigneesEntered = resolve)),
    chart = observationReadFixture({ assigneesGate: gate }),
    board = observationReadFixture({
      assigneesGate: gate,
      onAssigneesRead: assigneesEntered,
    });
  let boardFinished = false;
  const start = performance.now(),
    chartFlight = chart.handler(req("/api/burndown"), config),
    boardFlight = board.handler(req(), config).then((response) => {
      boardFinished = true;
      return response;
    });
  try {
    const deadline = new Promise((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "deadline" }), 1000);
    });
    const outcome = await Promise.race([
      Promise.all([chartFlight, entered]).then(([response]) => ({
        kind: "chart",
        response,
      })),
      deadline,
    ]);
    assert.equal(
      outcome.kind,
      "chart",
      "観測が候補一覧の未解放gateを待っている",
    );
    assert.equal(outcome.response.status, 200);
    assert.equal(chart.assigneesReads(), 0);
    assert.equal(board.assigneesReads(), 1);
    assert.equal(boardFinished, false);
    t.diagnostic(
      `合成gate未解放の観測完了: ${(performance.now() - start).toFixed(1)}ms。通常boardは待機中（実API性能の主張ではない）。`,
    );
  } finally {
    clearTimeout(timeout);
    release();
    // Regression failures also release both handlers: no dangling gate or timeout.
    await Promise.all([chartFlight, boardFlight]);
  }
  assertObservationReadOnly(chart, board);
  const response = await boardFlight;
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).assigneeOptions, [
    {
      login: "alice",
      name: null,
      avatarUrl: "https://avatars.githubusercontent.com/a",
    },
  ]);
});

for (const viewFilter of ["type:PBI", "milestone:Sprint"])
  test(`通常boardは候補一覧と本文/担当を維持し、候補503も従来どおり失敗 ${viewFilter}`, async () => {
    const healthy = observationReadFixture({ viewFilter }),
      failed = observationReadFixture({ viewFilter, assigneesStatus: 503 });
    const response = await healthy.handler(req(), config);
    assert.equal(response.status, 200);
    const board = await response.json();
    assert.deepEqual(board.assigneeOptions, [
      {
        login: "alice",
        name: null,
        avatarUrl: "https://avatars.githubusercontent.com/a",
      },
    ]);
    assert.equal(board.tasks[0].body, "観測元の本文を保持");
    assert.deepEqual(board.tasks[0].assignees, healthy.f.issue.assignees.nodes);
    assert.equal(healthy.assigneesReads(), 1);
    const unavailable = await failed.handler(req(), config);
    assert.equal(unavailable.status, 502);
    const error = await unavailable.json();
    assert.equal(error.error, "github_request_failed");
    assert.equal(error.upstreamStatus, 503);
    assert.equal(failed.assigneesReads(), 1);
    assertObservationReadOnly(healthy, failed);
  });

test("一般viewの観測は候補一覧を取得せず、既存のhours未対応503を維持", async () => {
  for (const assigneesStatus of [200, 503]) {
    const f = observationReadFixture({
      viewFilter: "milestone:Sprint",
      assigneesStatus,
    });
    const response = await f.handler(req("/api/burndown"), config);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "estimate_hours_unavailable");
    assert.equal(f.assigneesReads(), 0);
    assertObservationReadOnly(f);
  }
});

for (const visibility of [
  "project-private-start",
  "project-private-end",
  "hours-private-start",
  "hours-private-end",
])
  test(`候補一覧を省略しても観測の公開性guardは維持 ${visibility}`, async () => {
    const f = observationReadFixture({ visibility, assigneesStatus: 503 });
    const response = await f.handler(req("/api/burndown"), config);
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).error,
      visibility.startsWith("project-")
        ? "scope_not_public"
        : "estimate_hours_not_public",
    );
    assert.equal(f.assigneesReads(), 0);
    assert.equal(
      f.finalVisibilityReads(),
      visibility === "project-private-start" ? 0 : 1,
    );
    assertObservationReadOnly(f);
  });

test("候補一覧省略はIssue自身の担当者完全性確認を弱めない", async () => {
  const f = observationReadFixture();
  f.f.issue.assignees.pageInfo.hasNextPage = true;
  const response = await f.handler(req("/api/burndown"), config);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "observation_incomplete");
  assert.equal(f.assigneesReads(), 0);
  assertObservationReadOnly(f);
});
