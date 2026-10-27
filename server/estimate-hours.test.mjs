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
for (const inProject of [false, true])
  test(`正式な子の欠落をProject外と読取不足に分ける ${inProject}`, async () => {
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
    assert.equal(response.status, inProject ? 503 : 200);
    if (!inProject) {
      assert.deepEqual(data.tasks, []);
      assert.deepEqual(data.excludedChildren, [{ milestone: 1, count: 1 }]);
    } else assert.equal(data.error, "observation_incomplete");
  });
