import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "./github.mjs";
import { fixture, env, req } from "../tests/github-fixture.mjs";
import {
  sprintAssignmentWindow,
  validCatalogMilestone,
} from "./sprint-boundary.mjs";

const metadata = (start = "2026-10-21", extra = {}) =>
  `説明\n<!-- idea-boost-sprint:v2\n${JSON.stringify({ schema_version: 2, timezone: "Asia/Tokyo", assignment_start_date: start, ...extra })}\n-->`;
const milestone = (number = 9, overrides = {}) => ({
  number,
  title: `Sprint ${number}`,
  description: metadata(),
  dueOn: "2026-10-28T00:00:00Z",
  state: "OPEN",
  closedAt: null,
  ...overrides,
});
const expectedWindow = {
  policy: "sprint-v2-exclusive-jst",
  startAt: "2026-10-20T15:00:00.000Z",
  endAt: "2026-10-27T15:00:00.000Z",
};
test("v2正式期間はJST開始日から期日当日00:00直前まで、closedAtで推定しない", () => {
  assert.deepEqual(sprintAssignmentWindow(milestone()), expectedWindow);
  assert.deepEqual(
    sprintAssignmentWindow(
      milestone(9, {
        dueOn: "2026-10-27T15:00:00Z",
        state: "CLOSED",
        closedAt: "2026-10-26T00:00:00Z",
      }),
    ),
    expectedWindow,
  );
  assert.equal(
    sprintAssignmentWindow(milestone(9, { dueOn: "2026-10-28T23:00:00Z" }))
      .endAt,
    "2026-10-28T15:00:00.000Z",
  );
});
for (const [label, overrides] of [
  ["markerなし", { description: "学校日は21日から28日" }],
  ["null説明", { description: null }],
  ["旧version", { description: metadata().replace(":v2", ":v1") }],
  ["重複marker", { description: metadata() + metadata() }],
  ["混在marker", { description: metadata() + "idea-boost-sprint:v3" }],
  ["壊れたJSON", { description: "<!-- idea-boost-sprint:v2 {broken} -->" }],
  [
    "schema不明",
    { description: metadata("2026-10-21", { schema_version: 3 }) },
  ],
  [
    "timezone不明",
    { description: metadata("2026-10-21", { timezone: "UTC" }) },
  ],
  ["実在しない日", { description: metadata("2026-02-30") }],
  ["日付入力型不正", { description: metadata(123) }],
  ["開始終了同日", { description: metadata("2026-10-28") }],
  ["開始終了逆転", { description: metadata("2026-10-29") }],
  ["期日未定", { dueOn: null }],
  ["期日不正", { dueOn: "2026-02-30T00:00:00Z" }],
  ["番号不一致", { title: "Sprint 10" }],
  ["title推測禁止", { title: "今週のSprint 9" }],
])
  test(`不明metadataは終了期間を作らない ${label}`, () => {
    assert.equal(sprintAssignmentWindow(milestone(9, overrides)), undefined);
  });
test("catalogの正式nullable fieldsと型を検証し、欠落・不正を正常な空にしない", () => {
  assert.equal(validCatalogMilestone(milestone()), true);
  assert.equal(
    validCatalogMilestone(milestone(9, { description: null, dueOn: null })),
    true,
  );
  for (const overrides of [
    { number: 0 },
    { number: 1.5 },
    { title: null },
    { description: undefined },
    { dueOn: undefined },
    { dueOn: "2026-10-28" },
    { dueOn: "2026-10-28T24:00:00Z" },
    { state: "UNKNOWN" },
    { closedAt: undefined },
    { closedAt: "broken" },
  ])
    assert.equal(validCatalogMilestone(milestone(9, overrides)), false);
});

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
const catalog = () => [
  milestone(9, { state: "CLOSED", closedAt: "2026-10-28T00:00:00Z" }),
  milestone(10, {
    description: metadata("2026-10-28"),
    dueOn: "2026-11-04T00:00:00Z",
  }),
];
function observationFixture({
  milestones = catalog(),
  viewFilter = "type:PBI",
  rewrite = () => {},
} = {}) {
  const upstream = fixture({
    viewFilter,
    parentInProject: true,
    milestones,
  });
  upstream.issue.milestone = { number: 10, title: "Sprint 10", state: "OPEN" };
  upstream.issue.parent.milestone = upstream.issue.milestone;
  const handler = createHandler({
    crypto: webcrypto,
    now: () => Date.parse("2026-10-28T01:00:00Z"),
    fetch: async (url, options) => {
      const input = options.body ? JSON.parse(options.body) : {},
        response = await upstream.fetch(url, options),
        data = await response.json(),
        project = data.data?.organization?.projectV2;
      if (project && input.query?.includes("hoursField:"))
        project.hoursField = structuredClone(field);
      if (project && input.query?.includes("hoursValue:"))
        for (const item of project.items.nodes) item.hoursValue = null;
      const result = await rewrite(input.query || "", data, input.variables);
      return result instanceof Response
        ? result
        : Response.json(data, { status: response.status });
    },
  });
  return {
    ...upstream,
    source: () => handler(req("/api/burndown"), config),
    board: () => handler(req(), config),
    catalogCalls: () =>
      upstream.calls.filter((call) =>
        call.parsed?.query?.includes("ObservationMilestones"),
      ),
  };
}
test("全作業がS10へ移ってもS9をcatalogに保持、初回boardは追加query0", async () => {
  const f = observationFixture();
  const board = await f.board();
  assert.equal(board.status, 200);
  assert.equal(f.catalogCalls().length, 0);
  const response = await f.source();
  assert.equal(response.status, 200);
  const source = await response.json();
  assert.deepEqual(
    source.milestones.map((m) => m.number),
    [9, 10],
  );
  assert.deepEqual(source.milestones[0], {
    number: 9,
    title: "Sprint 9",
    dueOn: "2026-10-28T00:00:00Z",
    assignmentWindow: expectedWindow,
  });
  assert.equal(
    source.tasks.every((task) => task.milestone === 10),
    true,
  );
  assert.equal(f.catalogCalls().length, 1);
  assert.match(f.catalogCalls()[0].parsed.query, /states:\[OPEN,CLOSED\]/);
  assert.equal(
    f.calls.some(
      (call) =>
        call.method === "PATCH" || call.parsed?.query?.startsWith("mutation"),
    ),
    false,
  );
});
for (const viewFilter of ["milestone:Sprint", "assignee:@me"])
  test(`full-scanにもcatalogを接続し、通常board追加0とhours未対応fail closedを維持 ${viewFilter}`, async () => {
    const complete = observationFixture({ viewFilter });
    assert.equal((await complete.board()).status, 200);
    assert.equal(complete.catalogCalls().length, 0);
    const source = await complete.source();
    assert.equal(complete.catalogCalls().length, 1);
    assert.equal(source.status, 503);
    assert.equal((await source.json()).error, "estimate_hours_unavailable");
    const incomplete = observationFixture({
      viewFilter,
      rewrite(query, body) {
        if (query.includes("ObservationMilestones"))
          body.data.repository.milestones.totalCount = 3;
      },
    });
    const failure = await incomplete.source();
    assert.equal(failure.status, 503);
    assert.equal((await failure.json()).error, "observation_incomplete");
    assert.equal(incomplete.catalogCalls().length, 1);
  });
test("不明metadataにはoptional windowを追加せず従来のmilestone shapeを保つ", async () => {
  const f = observationFixture({
    milestones: [milestone(10, { description: null, dueOn: null })],
  });
  const response = await f.source();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).milestones, [
    { number: 10, title: "Sprint 10", dueOn: null },
  ]);
});
test("完全な分割catalogを最後まで取得し、順序に依存せず番号順で返す", async () => {
  const f = observationFixture({
    rewrite(query, body, variables) {
      if (!query.includes("ObservationMilestones")) return;
      body.data.repository.milestones = {
        totalCount: 2,
        nodes: [catalog()[variables.after ? 0 : 1]],
        pageInfo: {
          hasNextPage: !variables.after,
          endCursor: variables.after ? "done" : "next",
        },
      };
    },
  });
  const response = await f.source();
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).milestones.map((m) => m.number),
    [9, 10],
  );
  assert.equal(f.catalogCalls().length, 2);
});
for (const [label, rewrite] of [
  [
    "repository欠落",
    (body) => {
      body.data.repository = null;
    },
  ],
  [
    "誤repo",
    (body) => {
      body.data.repository.nameWithOwner = "other/repo";
    },
  ],
  [
    "nodes欠落",
    (body) => {
      delete body.data.repository.milestones.nodes;
    },
  ],
  [
    "pageInfo欠落",
    (body) => {
      delete body.data.repository.milestones.pageInfo;
    },
  ],
  [
    "total不一致",
    (body) => {
      body.data.repository.milestones.totalCount = 3;
    },
  ],
  [
    "上限超過",
    (body) => {
      body.data.repository.milestones.totalCount = 101;
    },
  ],
  [
    "重複番号",
    (body) => {
      body.data.repository.milestones.nodes[1] = catalog()[0];
    },
  ],
  [
    "field欠落",
    (body) => {
      delete body.data.repository.milestones.nodes[0].description;
    },
  ],
  [
    "次pageが空",
    (body) => {
      body.data.repository.milestones.nodes = [];
      body.data.repository.milestones.pageInfo = {
        hasNextPage: true,
        endCursor: "next",
      };
    },
  ],
  [
    "cursor欠落",
    (body) => {
      body.data.repository.milestones.nodes.pop();
      body.data.repository.milestones.pageInfo = {
        hasNextPage: true,
        endCursor: null,
      };
    },
  ],
])
  test(`不完全catalogは503、空sourceへ変換しない ${label}`, async () => {
    const f = observationFixture({
      rewrite(query, body) {
        if (query.includes("ObservationMilestones")) rewrite(body);
      },
    });
    const response = await f.source();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "observation_incomplete");
  });
test("catalogにないProject milestoneは不完全として拒否", async () => {
  const f = observationFixture({ milestones: [catalog()[0]] });
  assert.equal((await f.source()).status, 503);
});
test("100件の完全catalogは許可、途中のtotal変動やcursor循環は拒否", async () => {
  const full = observationFixture({
    milestones: Array.from({ length: 100 }, (_, i) =>
      milestone(i + 1, { description: null }),
    ),
  });
  assert.equal((await full.source()).status, 200);
  for (const mode of ["total-change", "cursor-cycle"]) {
    const f = observationFixture({
      rewrite(query, body, variables) {
        if (!query.includes("ObservationMilestones")) return;
        body.data.repository.milestones = {
          totalCount: mode === "total-change" && variables.after ? 4 : 3,
          nodes: [catalog()[variables.after ? 1 : 0]],
          pageInfo: { hasNextPage: true, endCursor: "same" },
        };
      },
    });
    assert.equal((await f.source()).status, 503);
    assert.equal(f.catalogCalls().length, 2);
  }
});
for (const privacy of ["catalog", "project-end", "hours-end"])
  test(`catalog取得中・取得後の公開失効を遮断 ${privacy}`, async () => {
    let catalogRead = false;
    const f = observationFixture({
      rewrite(query, body) {
        if (query.includes("ObservationMilestones")) {
          catalogRead = true;
          if (privacy === "catalog") body.data.repository.isPrivate = true;
        }
        if (query.includes("PublicScope") && catalogRead) {
          if (privacy === "project-end")
            body.data.organization.projectV2.public = false;
          if (privacy === "hours-end")
            body.data.organization.projectV2.hoursField.issueField.visibility =
              "ORG_ONLY";
        }
      },
    });
    const response = await f.source();
    assert.equal(response.status, 403);
    assert.equal(
      (await response.json()).error,
      privacy === "hours-end"
        ? "estimate_hours_not_public"
        : "scope_not_public",
    );
  });
