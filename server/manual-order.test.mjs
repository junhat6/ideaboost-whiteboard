import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "./github.mjs";
import { env, fixture, makeIssue, req } from "../tests/github-fixture.mjs";

// 合成データのみ。番号・旧優先順位・取得完了順に依存しないことを確認する。
function orderedFixture({ focused = true, defect = null } = {}) {
  const fallback = fixture({
    viewFilter: focused ? "type:PBI" : "milestone:Sprint",
  });
  let items = Array.from({ length: 131 }, (_, position) => {
    const number = ((position * 47) % 131) + 1000;
    return {
      id: `PROJECT_${number}`,
      isArchived: false,
      content: {
        ...makeIssue(number, position % 2 === 0 ? "PBI" : "Task"),
        subIssuesSummary: { total: 0 },
        milestone: {
          number: position % 3 === 0 ? 2 : 1,
          title: "Sprint",
          state: "OPEN",
        },
      },
      fieldValueByName: null,
      // Historical values deliberately contradict POSITION and may be absent.
      fieldValues: {
        nodes:
          position % 3
            ? [
                { field: { name: "優先順位" }, number: 131 - position },
                {
                  field: { name: "優先度" },
                  name: position % 2 ? "最優先" : "低",
                },
              ]
            : [],
      },
    };
  });
  const queries = [];
  function connection(list, after, size) {
    const start = after ? Number(after.slice(1)) : 0;
    const next = start + size;
    return {
      nodes: list.slice(start, next),
      pageInfo: {
        hasNextPage: next < list.length,
        endCursor: next < list.length ? `p${next}` : null,
      },
    };
  }
  const handler = createHandler({
    crypto: webcrypto,
    fetch: async (url, opt) => {
      const body = opt.body ? JSON.parse(opt.body) : {};
      const query = body.query || "";
      if (query) queries.push(query);
      assert.doesNotMatch(
        query,
        /\bmutation\b/,
        "board reads must not mutate GitHub",
      );
      if (/BoardRelations|IssueDetails/.test(query)) {
        const wanted = new Set(body.variables.ids);
        return Response.json({
          data: {
            // Reverse resolver results: merge must still use Project source order.
            nodes: items
              .filter((item) => wanted.has(item.content.id))
              .map((item) => item.content)
              .reverse(),
            statuses: items.map((item) => ({
              id: item.id,
              fieldValueByName: null,
            })),
          },
        });
      }
      if (/BoardBootstrap|BoardItems|BoardRows/.test(query)) {
        assert.match(
          query,
          /orderBy:\s*\{\s*field:POSITION,\s*direction:ASC\s*\}/,
        );
        assert.doesNotMatch(query, /優先順位|優先度|CREATED_AT/);
        const response = await fallback.fetch(url, opt);
        const data = await response.json();
        const rows = /BoardRows/.test(query);
        const list = rows
          ? items.filter((item) => item.content.issueType.name === "PBI")
          : items;
        let c = connection(
          list,
          body.variables?.after,
          rows && defect?.startsWith("rows-") ? 2 : rows && focused ? 50 : 100,
        );
        if (
          ((!rows && defect === "duplicate") ||
            (rows && defect === "rows-duplicate")) &&
          body.variables?.after
        ) {
          c.nodes[0] = list[0];
        }
        if (
          (!rows && defect === "cycle") ||
          (rows && defect === "rows-cycle")
        ) {
          const page = !body.variables?.after
            ? 0
            : body.variables.after === "a"
              ? 1
              : 2;
          c = {
            nodes: [list[page]],
            pageInfo: { hasNextPage: true, endCursor: page === 1 ? "b" : "a" },
          };
        }
        data.data.organization.projectV2.items = c;
        return Response.json(data);
      }
      return fallback.fetch(url, opt);
    },
  });
  return {
    handler,
    queries,
    expected(milestone = null) {
      return items
        .filter(
          (item) =>
            item.content.issueType.name === "PBI" &&
            (milestone === null || item.content.milestone.number === milestone),
        )
        .map((item) => item.content.id);
    },
    reverse() {
      items = items.toReversed();
    },
  };
}

for (const focused of [true, false]) {
  test(`${focused ? "focused" : "full scan"}: shared manual order survives 131 mixed items, pagination, legacy values and filtering`, async () => {
    const f = orderedFixture({ focused });
    const response = await f.handler(req(), env);
    const board = await response.json();
    assert.equal(response.status, 200, JSON.stringify(board));
    assert.deepEqual(
      board.lanes.map((lane) => lane.id),
      f.expected(),
    );
    assert.equal(
      f.queries.filter((q) => q.includes("query BoardItems")).length,
      1,
    );
    if (focused)
      assert.equal(
        f.queries.filter((q) => q.includes("query BoardRowsFull")).length,
        2,
      );
    const filtered = await (
      await f.handler(req("/api/board?milestone=2"), env)
    ).json();
    assert.deepEqual(
      filtered.lanes.map((lane) => lane.id),
      f.expected(2),
    );
    const before = board.lanes.map((lane) => lane.id);
    f.reverse();
    const refreshed = await (await f.handler(req(), env)).json();
    assert.deepEqual(
      refreshed.lanes.map((lane) => lane.id),
      before.toReversed(),
    );
  });
  for (const defect of ["duplicate", "cycle", "rows-duplicate", "rows-cycle"]) {
    test(`${focused ? "focused" : "full scan"}: rejects ${defect} pages instead of publishing a fabricated order`, async () => {
      const f = orderedFixture({ focused, defect });
      const response = await f.handler(req(), env);
      const result = await response.json();
      assert.equal(response.status, 502);
      assert.equal(result.error, "project_order_unavailable");
      assert.equal(result.lanes, undefined);
    });
  }
}
