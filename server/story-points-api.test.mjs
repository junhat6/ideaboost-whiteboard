import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "./github.mjs";
import { env, req } from "../tests/github-fixture.mjs";
const definition = {
  id: 49067031,
  node_id: "IFN_kgDOAuy0Fw",
  name: "Story points",
  data_type: "number",
  visibility: "all",
};
function fixture({
  deny = false,
  type = "PBI",
  privateAfter = false,
  fieldPrivateAfter = false,
  badLink = false,
} = {}) {
  const calls = [];
  let definitions = 0,
    valueRead = false;
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, body });
      if (url.endsWith("/access_tokens"))
        return Response.json({
          token: "fixture-only",
          expires_at: "2099-01-01T00:00:00Z",
        });
      if (url.endsWith("/issue-fields")) {
        if (deny)
          return Response.json(
            { message: "Resource not accessible by integration" },
            { status: 403 },
          );
        definitions++;
        return Response.json([
          {
            ...definition,
            visibility:
              fieldPrivateAfter && definitions > 1
                ? "organization_members_only"
                : "all",
          },
        ]);
      }
      if (body?.query?.includes("query PublicScope"))
        return Response.json({
          data: {
            repository: { isPrivate: privateAfter && valueRead },
            organization: { projectV2: { public: true } },
          },
        });
      if (body?.query?.includes("query CommentScope"))
        return Response.json({
          data: {
            repository: {
              isPrivate: false,
              issue: {
                id: "I1",
                number: body.variables.number,
                issueType: { name: type },
                repository: { nameWithOwner: "engineer-first/idea-boost" },
                projectItems: {
                  nodes: [{ isArchived: false, project: { id: "P3" } }],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
            organization: { projectV2: { id: "P3", public: true } },
          },
        });
      if (url.includes("/issue-field-values?")) {
        valueRead = true;
        return Response.json(
          [{ issue_field_id: 49067031, data_type: "number", value: 0.1 }],
          {
            headers: badLink
              ? { link: '<https://evil.example/?page=2>; rel="next"' }
              : {},
          },
        );
      }
      throw new Error("Unexpected request");
    },
  });
  return {
    calls,
    read: (path = "/api/story-points?issues=1", enabled = true) =>
      handler(req(path), {
        ...env,
        AUTH_MODE: "public-temporary",
        STORY_POINTS_READ_ENABLED: enabled ? "true" : undefined,
      }),
  };
}
test("disabled feature makes no requests; enabled exact field is read only after canonical PBI scope", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.read(undefined, false)).json(), {
    values: {},
  });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await (await f.read()).json(), { values: { 1: 0.1 } });
  const scope = f.calls.findIndex((c) =>
    c.body?.query?.includes("CommentScope"),
  );
  assert.ok(
    f.calls.findIndex((c) => c.url.includes("issue-field-values")) > scope,
  );
  assert.equal(
    f.calls.filter((c) => c.url.endsWith("/issue-fields")).length,
    2,
  );
  assert.ok(
    f.calls.every(
      (c) =>
        !c.body?.query?.includes("BoardItems") &&
        !c.body?.query?.includes("IssueDetails"),
    ),
  );
  assert.deepEqual(
    f.calls.find((c) => c.url.endsWith("/access_tokens")).body.permissions,
    { issues: "write", organization_projects: "write", issue_fields: "read" },
  );
});
test("definition denial does not read values or expand permissions; Task never reads PBI points", async () => {
  for (const options of [{ deny: true }, { type: "Task" }]) {
    const f = fixture(options);
    assert.deepEqual(
      await (await f.read()).json(),
      options.deny ? { values: {}, fieldReadStatus: 403 } : { values: {} },
    );
    assert.ok(f.calls.every((c) => !c.url.includes("issue-field-values")));
  }
});
test("field private transition or untrusted pagination removes SP; repository private transition signals whole-board stop", async () => {
  for (const options of [{ fieldPrivateAfter: true }, { badLink: true }]) {
    const f = fixture(options);
    assert.deepEqual(await (await f.read()).json(), { values: {} });
  }
  const r = await fixture({ privateAfter: true }).read();
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "scope_not_public");
});
test("invalid or excessive Issue requests are rejected before upstream access", async () => {
  for (const query of [
    "",
    "?issues=1,1",
    "?issues=1,2,3,4,5,6,7",
    "?issues=1&field=5",
    "?issues=-1",
    "?issues=1&issues=2",
  ]) {
    const f = fixture();
    assert.equal((await f.read("/api/story-points" + query)).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
