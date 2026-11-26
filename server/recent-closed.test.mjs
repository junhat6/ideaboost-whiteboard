import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler, recentClosedFilter } from "./github.mjs";
import { env, fixture, makeIssue, req } from "../tests/github-fixture.mjs";

// 合成データのみ。Close済みPBIはview 16 (is:open) から外れるため、
// 明示opt-inの時だけ直近の範囲を追加で読み、既定の読み取りは変えない。
const VIEW = "repo:engineer-first/idea-boost is:issue type:PBI is:open";
const NOW = Date.parse("2026-11-16T03:00:00Z");

function closedFixture() {
  const f = fixture({ viewFilter: VIEW });
  const closed = {
    ...makeIssue(5, "PBI"),
    state: "CLOSED",
    stateReason: "COMPLETED",
  };
  const child = makeIssue(6, "Task", closed);
  const queries = [];
  const json = (nodes) =>
    Response.json({
      data: {
        organization: {
          projectV2: { items: { nodes, pageInfo: { hasNextPage: false } } },
        },
      },
    });
  const handler = createHandler({
    crypto: webcrypto,
    now: () => NOW,
    fetch: async (url, opt) => {
      const body = opt.body ? JSON.parse(opt.body) : {};
      const query = body.query || "";
      if (query) queries.push({ query, filter: body.variables?.filter });
      assert.doesNotMatch(query, /\bmutation\b/);
      if (query.includes("BoardRowsClosed"))
        return json([
          {
            id: "ITEM5",
            isArchived: false,
            content: { ...closed, subIssuesSummary: { total: 1 } },
            fieldValueByName: { name: "完了" },
          },
        ]);
      const response = await f.fetch(url, opt);
      if (
        query.includes("BoardChildren") &&
        body.variables.filter.includes("#5")
      ) {
        const data = await response.json();
        data.data.organization.projectV2.items.nodes.push({
          id: "ITEM6",
          isArchived: false,
          content: { ...child, subIssuesSummary: { total: 0 } },
          fieldValueByName: { name: "完了" },
        });
        return Response.json(data);
      }
      if (query.includes("BoardBootstrap")) {
        // Project order puts the closed PBI first; the board must keep it.
        const data = await response.json();
        data.data.organization.projectV2.items.nodes.unshift(
          { id: "ITEM5", isArchived: false, content: closed },
          { id: "ITEM6", isArchived: false, content: child },
        );
        return Response.json(data);
      }
      return response;
    },
  });
  return { handler, queries };
}

test("default board read stays open-only and never asks for closed rows", async () => {
  const f = closedFixture();
  const d = await (await f.handler(req(), env)).json();
  assert.deepEqual(
    d.lanes.map((i) => i.id),
    ["I1"],
  );
  assert.equal(d.scope.recentClosed, null);
  assert.equal(
    f.queries.some((q) => q.query.includes("BoardRowsClosed")),
    false,
  );
});

test("closed=recent adds recently closed PBIs with their children in Project order", async () => {
  const f = closedFixture();
  const r = await f.handler(req("/api/board?closed=recent"), env);
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(
    d.lanes.map((i) => [i.id, i.state]),
    [
      ["I5", "CLOSED"],
      ["I1", "OPEN"],
    ],
  );
  assert.deepEqual(
    d.tasks.filter((t) => t.lane === "I5").map((t) => t.id),
    ["I6"],
  );
  assert.equal(
    f.queries.find((q) => q.query.includes("BoardRowsClosed")).filter,
    "repo:engineer-first/idea-boost is:issue type:PBI is:closed closed:>=2026-11-06",
  );
  assert.deepEqual(d.scope.recentClosed, {
    days: 10,
    filter:
      "repo:engineer-first/idea-boost is:issue type:PBI is:closed closed:>=2026-11-06",
  });
  // The original open view filter remains the reported scope.
  assert.equal(d.scope.viewFilter, VIEW);
});

test("closed parameter accepts only a single recent value", async () => {
  const f = closedFixture();
  for (const path of [
    "/api/board?closed=all",
    "/api/board?closed=recent&closed=recent",
    "/api/board?closed=",
  ])
    assert.equal((await f.handler(req(path), env)).status, 400, path);
});

test("recent closed filter only rewrites an explicit is:open qualifier", () => {
  assert.equal(recentClosedFilter("type:PBI", NOW), null);
  assert.equal(recentClosedFilter("type:PBI is:openish", NOW), null);
  assert.equal(
    recentClosedFilter("is:open type:PBI", NOW),
    "is:closed closed:>=2026-11-06 type:PBI",
  );
});
