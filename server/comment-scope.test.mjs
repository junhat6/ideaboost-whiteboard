import test from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./github.mjs";
import { env, req } from "../tests/github-fixture.mjs";
function fixture({
  pbi = false,
  members = [],
  children = [],
  more = false,
  privateStart = false,
  privateEnd = false,
  malformed = false,
  linked = false,
} = {}) {
  let reads = 0,
    scopeReads = 0;
  const handler = createHandler({
    fetch: async (url, opt) => {
      if (url.includes("/access_tokens"))
        return Response.json({
          token: "mock",
          expires_at: "2099-01-01T00:00:00Z",
        });
      if (url.includes("/comments")) {
        reads++;
        return Response.json([]);
      }
      const { query, variables } = JSON.parse(opt.body);
      if (query.includes("query LinkedPullRequests")) {
        reads++;
        assert.ok(query.includes("includeClosedPrs:true"));
        assert.ok(query.includes("excludeUserLinked:false"));
        return Response.json({
          data: {
            repository: {
              isPrivate: false,
              issue: {
                number: 1,
                closedByPullRequestsReferences: {
                  nodes: [],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
        });
      }
      if (query.includes("query CommentScope")) {
        scopeReads++;
        assert.ok(query.includes("includeArchived:false"));
        return Response.json({
          data: {
            repository: {
              isPrivate: privateStart,
              issue: {
                id: "I1",
                number: 1,
                repository: { nameWithOwner: "engineer-first/idea-boost" },
                issueType: { name: pbi ? "PBI" : "Task" },
                projectItems: malformed
                  ? null
                  : {
                      nodes:
                        scopeReads === 1
                          ? members
                          : [{ isArchived: false, project: { id: "P3" } }],
                      pageInfo: {
                        hasNextPage: more && scopeReads === 1,
                        endCursor: "next",
                      },
                    },
              },
            },
            organization: { projectV2: { id: "P3", public: true } },
          },
        });
      }
      if (query.includes("query CommentParentScope")) {
        assert.match(
          variables.filter,
          /parent-issue:engineer-first\/idea-boost#1$/,
        );
        return Response.json({
          data: {
            organization: {
              projectV2: {
                items: { nodes: children, pageInfo: { hasNextPage: false } },
              },
            },
          },
        });
      }
      if (query.includes("PublicScope"))
        return Response.json({
          data: {
            repository: { isPrivate: privateEnd },
            organization: { projectV2: { public: true } },
          },
        });
      throw Error("unexpected full-board request");
    },
  });
  return {
    run: () =>
      handler(
        req(linked ? "/api/issues/1/pull-requests" : "/api/issues/1/comments"),
        {
          ...env,
          AUTH_MODE: "public-temporary",
        },
      ),
    reads: () => reads,
    scopeReads: () => scopeReads,
  };
}
test("comment scope paginates target membership and denies archived, other project, unrelated and malformed", async () => {
  const paged = fixture({ more: true });
  assert.equal((await paged.run()).status, 200);
  assert.equal(paged.scopeReads(), 2);
  for (const options of [
    { members: [{ isArchived: true, project: { id: "P3" } }] },
    { members: [{ isArchived: false, project: { id: "Other" } }] },
    { malformed: true },
    {},
  ]) {
    const f = fixture(options);
    assert.ok((await f.run()).status >= 400);
    assert.equal(f.reads(), 0);
  }
});
test("only direct same-repo PBI parent of nonarchived project Issue is an additional scope", async () => {
  const child = {
    isArchived: false,
    content: {
      repository: { nameWithOwner: "engineer-first/idea-boost" },
      parent: { id: "I1" },
    },
  };
  assert.equal(
    (await fixture({ pbi: true, children: [child] }).run()).status,
    200,
  );
  for (const options of [
    { pbi: false, children: [child] },
    { pbi: true, children: [{ ...child, isArchived: true }] },
    {
      pbi: true,
      children: [
        {
          ...child,
          content: { ...child.content, parent: { id: "Grandchild" } },
        },
      ],
    },
    {
      pbi: true,
      children: [
        {
          ...child,
          content: {
            ...child.content,
            repository: { nameWithOwner: "other/repo" },
          },
        },
      ],
    },
  ]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, 403);
    assert.equal(f.reads(), 0);
  }
});
test("comment public checks fail closed before and after REST read", async () => {
  const members = [{ isArchived: false, project: { id: "P3" } }];
  const before = fixture({ members, privateStart: true });
  assert.equal((await before.run()).status, 403);
  assert.equal(before.reads(), 0);
  const after = fixture({ members, privateEnd: true });
  const r = await after.run();
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "scope_not_public");
  assert.equal(after.reads(), 1);
});

test("linked PR endpoint uses narrow scope and final visibility without full board", async () => {
  const members = [{ isArchived: false, project: { id: "P3" } }];
  for (const privateEnd of [false, true]) {
    const f = fixture({ members, linked: true, privateEnd });
    const r = await f.run();
    assert.equal(r.status, privateEnd ? 403 : 200);
    assert.equal(f.reads(), 1);
  }
  const denied = fixture({ linked: true });
  assert.equal((await denied.run()).status, 403);
  assert.equal(denied.reads(), 0);
});
