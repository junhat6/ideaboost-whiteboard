import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "./github.mjs";
import { fixture, env, req } from "../tests/github-fixture.mjs";
import { publicProjectPoints, projectPoint } from "./project-points.mjs";
const field = {
  __typename: "ProjectV2Field",
  id: "PVTF_lADOEYcVLM4Bb8yFzhnWjbg",
  name: "Story points",
  dataType: "NUMBER",
  isIssueField: true,
  issueField: {
    __typename: "IssueFieldNumber",
    id: "IFN_kgDOAuy0Fw",
    fullDatabaseId: "49067031",
    name: "Story points",
    dataType: "NUMBER",
    visibility: "ALL",
  },
};
const value = {
  __typename: "ProjectV2ItemIssueFieldValue",
  field: { id: field.id },
  issueFieldValue: {
    __typename: "IssueFieldNumberValue",
    value: 0.1,
    field: { id: field.issueField.id },
  },
};
test("linked Project value requires canonical identity, numeric type and public definition", () => {
  assert.equal(publicProjectPoints(field), true);
  assert.equal(projectPoint(value), 0.1);
  assert.equal(projectPoint(null), null);
  assert.equal(projectPoint(undefined), undefined);
  for (const override of [
    { id: "other" },
    { isIssueField: false },
    { dataType: "TEXT" },
    { issueField: { ...field.issueField, visibility: "ORG_ONLY" } },
    { issueField: { ...field.issueField, id: "other" } },
  ])
    assert.equal(publicProjectPoints({ ...field, ...override }), false);
  assert.equal(
    projectPoint({
      ...value,
      __typename: "ProjectV2ItemFieldNumberValue",
      number: 5,
    }),
    undefined,
  );
});
for (const variant of [
  "value",
  "unset",
  "missing",
  "private-start",
  "private-end",
  "schema-error",
])
  test(`board bundled points ${variant} preserves scope and avoids REST per-Issue reads`, async () => {
    const f = fixture({ viewFilter: "type:PBI", parentInProject: true });
    const handler = createHandler({
      crypto: webcrypto,
      fetch: async (url, opt) => {
        const q = opt.body ? JSON.parse(opt.body).query : "";
        if (variant === "schema-error" && q?.includes("pointsField:"))
          return Response.json({ errors: [{ message: "field unavailable" }] });
        const r = await f.fetch(url, opt);
        const data = await r.json();
        const p = data.data?.organization?.projectV2;
        if (p && q?.includes("pointsField:"))
          p.pointsField = {
            ...field,
            issueField: {
              ...field.issueField,
              visibility:
                variant === "private-start" ||
                (variant === "private-end" && q.includes("PublicScope"))
                  ? "ORG_ONLY"
                  : "ALL",
            },
          };
        if (p && q?.includes("pointsValue:"))
          for (const item of p.items.nodes) {
            if (variant !== "missing")
              item.pointsValue = variant === "unset" ? null : value;
          }
        return Response.json(data, { status: r.status });
      },
    });
    const r = await handler(req(), {
      ...env,
      AUTH_MODE: "public-temporary",
      STORY_POINTS_READ_ENABLED: "true",
    });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.lanes.length, 1);
    assert.deepEqual(
      b.storyPoints.values,
      variant === "value" ? { 1: 0.1 } : variant === "unset" ? { 1: null } : {},
    );
    assert.equal(
      f.calls.some((c) => /issue-field-values|issue-fields/.test(c.url)),
      false,
    );
  });

test("board field scope key equals shared-reader key contract", async () => {
  const f = fixture({ viewFilter: "type:PBI", parentInProject: true });
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) => {
      const r = await f.fetch(url, opt);
      const d = await r.json();
      if (d.data?.organization?.projectV2)
        d.data.organization.projectV2.pointsField = field;
      return Response.json(d);
    },
  });
  const e = {
    ...env,
    AUTH_MODE: "public-temporary",
    STORY_POINTS_READ_ENABLED: "true",
  };
  const b = await (await handler(req(), e)).json();
  const guard = await (await handler(req("/api/scope"), e)).json();
  assert.equal(
    guard.scopeKey,
    JSON.stringify([
      b.scope.viewFilter,
      b.scope.statusOptions,
      b.scope.statusColors,
      b.scope.storyPointsField,
    ]),
  );
});
