import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, webcrypto } from "node:crypto";
import { createHandler, pemToPkcs8, fingerprint } from "./github.mjs";
import {
  privateKey,
  env,
  revision,
  makeIssue,
  fixture,
  req,
  originalFingerprint,
  parentFingerprint,
  patch,
} from "../tests/github-fixture.mjs";
test("PKCS1 and PKCS8 both import with WebCrypto", async () => {
  for (const type of ["pkcs1", "pkcs8"])
    await webcrypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(privateKey.export({ type, format: "pem" })),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
});
test("auth and origin reject before external requests; health has no secrets", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.handler(
        req("/api/issues/2", patch(), { "x-verified-user-id": "" }),
        env,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.handler(
        req("/api/issues/2", patch(), { origin: "https://evil.example" }),
        env,
      )
    ).status,
    403,
  );
  const r = await f.handler(req("/api/health"), env);
  assert.deepEqual(await r.json(), {
    configured: true,
    mode: "github",
    accessMode: "team",
  });
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(f.calls.length, 0);
});
test("paginates, preserves null status and formal parent outside project; filter honest", async () => {
  const f = fixture({ paginate: true });
  const r = await f.handler(req(), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.tasks[0].status, null);
  assert.equal(b.tasks[0].lane, "I1");
  assert.equal(b.lanes[0].type, "PBI");
  assert.equal(b.lanes[0].projectItemId, null);
  assert.equal(b.scope.filterApplied, true);
  assert.equal(
    f.calls.find((c) => c.parsed?.query?.includes("BoardRows")).parsed.variables
      .filter,
    "milestone:Sprint",
  );
  assert.equal(
    f.calls.filter((c) =>
      /BoardItems|BoardBootstrap/.test(c.parsed?.query ?? ""),
    ).length,
    2,
  );
  assert.equal(JSON.stringify(b).includes("SECRET"), false);
});
test("rejects revision/status conflict without mutation", async () => {
  for (const change of [
    { expectedRevision: "2020-01-01T00:00:00Z" },
    { expectedStatus: "未整理" },
  ]) {
    const f = fixture();
    const r = await f.handler(req("/api/issues/2", patch(change)), env);
    assert.equal(r.status, 409);
    assert.equal(
      f.calls.some(
        (c) => c.method === "PATCH" || c.parsed?.query?.startsWith("mutation"),
      ),
      false,
    );
  }
});
test("saves changed fields only, confirms readback and deduplicates request", async () => {
  const f = fixture();
  let r = await f.handler(
    req("/api/issues/2", patch({ body: "original", assignees: [] })),
    env,
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).issue.title, "Updated");
  assert.deepEqual(f.calls.find((c) => c.method === "PATCH").parsed, {
    title: "Updated",
  });
  r = await f.handler(
    req("/api/issues/2", patch({ body: "original", assignees: [] })),
    env,
  );
  assert.equal(r.status, 200);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
  assert.equal(
    (await f.handler(req("/api/issues/2", patch({ title: "Different" })), env))
      .status,
    409,
  );
});
test("partial mutation explicit and actual data returned; does not rollback", async () => {
  const f = fixture({ statusFailure: true });
  const r = await f.handler(
    req("/api/issues/2", patch({ status: "作業中" })),
    env,
  );
  assert.equal(r.status, 502);
  const d = await r.json();
  assert.equal(d.partial, true);
  assert.equal(d.ambiguous, true);
  assert.equal(d.issue.title, "Updated");
  assert.equal(d.issue.status, null);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("uncertain network write re-reads without replay even if data changed", async () => {
  const f = fixture({ networkPatch: true });
  const r = await f.handler(req("/api/issues/2", patch()), env);
  const d = await r.json();
  assert.equal(d.ambiguous, true);
  assert.equal(d.issue.title, "Updated");
  await f.handler(req("/api/issues/2", patch()), env);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("strict inputs and scope cannot be overridden", async () => {
  for (const data of [
    patch({ state: "closed" }),
    patch({ repo: "other" }),
    patch({ status: "done" }),
    patch({ assignees: ["unknown"] }),
    patch({ title: "" }),
  ]) {
    const f = fixture();
    assert.equal(
      (await f.handler(req("/api/issues/2", data), env)).status,
      400,
    );
  }
  const f = fixture();
  assert.equal(
    (await f.handler(req("/api/board?repo=other"), env)).status,
    400,
  );
  assert.equal(
    (await f.handler(req("/api/issues/99", patch()), env)).status,
    404,
  );
});
test("same issue simultaneous request is rejected", async () => {
  const f = fixture();
  const a = f.handler(req("/api/issues/2", patch()), env);
  const b = f.handler(
    req("/api/issues/2", patch({ requestId: "request_second_012345" })),
    env,
  );
  const statuses = await Promise.all([a, b].map(async (p) => (await p).status));
  assert.deepEqual(statuses.sort(), [200, 409]);
});

test("contextual view filter is explicitly not applied", async () => {
  const f = fixture({ viewFilter: "assignee:@me" });
  const d = await (await f.handler(req(), env)).json();
  assert.equal(d.scope.filterApplied, false);
  assert.equal(
    f.calls
      .find((c) => c.parsed?.query?.includes("BoardBootstrap"))
      .parsed.query.includes("query:$filter"),
    false,
  );
});
test("parent PBI outside project status write is rejected", async () => {
  const f = fixture();
  const r = await f.handler(
    req(
      "/api/issues/1",
      patch({ expectedFingerprint: parentFingerprint, status: "作業中" }),
    ),
    env,
  );
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "issue_not_in_project_status");
});

test("formal parent outside project allows issue fields, not project writes", async () => {
  const f = fixture();
  const r = await f.handler(
    req("/api/issues/1", patch({ expectedFingerprint: parentFingerprint })),
    env,
  );
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.issue.title, "Updated");
  assert.equal(d.issue.statusEditable, false);
});

test("PBI outside filtered view preserves real project status and membership", async () => {
  const f = fixture({ parentInProject: true });
  const d = await (await f.handler(req(), env)).json();
  assert.equal(d.lanes[0].status, "レビュー中");
  assert.equal(d.lanes[0].projectItemId, "ITEM1");
  assert.equal(d.lanes[0].statusEditable, true);
});

test("JWT expiry/skew and token least privilege payload", async () => {
  const f = fixture();
  await f.handler(req(), env);
  const c = f.calls.find((c) => c.url.includes("/access_tokens"));
  const payload = JSON.parse(
    Buffer.from(c.headers.authorization.split(".")[1], "base64url"),
  );
  assert.equal(payload.exp - payload.iat, 600);
  assert.equal(payload.iss, "123");
  assert.deepEqual(c.parsed, {
    repositories: ["idea-boost"],
    permissions: { issues: "write", organization_projects: "write" },
  });
});
test("dynamic status option mutation and null clearing", async () => {
  for (const [initialStatus, status] of [
    [null, "作業中"],
    ["作業中", null],
  ]) {
    const f = fixture({ initialStatus });
    const r = await f.handler(
      req(
        "/api/issues/2",
        patch({ title: "Issue 2", status, expectedStatus: initialStatus }),
      ),
      env,
    );
    assert.equal(r.status, 200);
    assert.equal((await r.json()).issue.status, status);
    assert.equal(
      f.calls.some((c) => c.method === "PATCH"),
      false,
    );
    const m = f.calls.find((c) => c.parsed?.query?.startsWith("mutation"));
    assert.equal(m.parsed.variables.input.fieldId, "STATUS");
    assert.equal(m.parsed.variables.input.itemId, "ITEM2");
    assert.equal(
      m.parsed.variables.input.value?.singleSelectOptionId,
      status ? "WORK" : undefined,
    );
  }
});
test("same request in flight is rejected, never replayed", async () => {
  const f = fixture();
  const responses = await Promise.all([
    f.handler(req("/api/issues/2", patch()), env),
    f.handler(req("/api/issues/2", patch()), env),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});

test("type:PBI view selects rows, expands formal children and descendants, excludes unrelated tasks", async () => {
  const filter = "repo:engineer-first/idea-boost is:issue type:PBI is:open";
  const f = fixture({ viewFilter: filter, extraTasks: true });
  const d = await (await f.handler(req(), env)).json();
  assert.deepEqual(
    d.lanes.map((i) => i.id),
    ["I1"],
  );
  assert.deepEqual(
    d.tasks.map((i) => i.id),
    ["I2", "I3"],
  );
  assert.equal(d.tasks[1].lane, "I1");
  assert.equal(d.tasks[1].status, "作業中");
  assert.equal(d.scope.filterTarget, "PBI rows");
  assert.equal(d.scope.childTasksExpanded, true);
  assert.equal(d.scope.filterApplied, true);
  assert.equal(
    f.calls.find((c) => c.parsed?.query?.includes("BoardRows")).parsed.variables
      .filter,
    filter,
  );
  assert.equal(
    f.calls
      .find((c) => c.parsed?.query?.includes("BoardBootstrap"))
      .parsed.query.includes("query:$filter"),
    false,
  );
});

test("all API reads require verified identity", async () => {
  const f = fixture();
  for (const path of ["/api/health", "/api/board", "/api/assignees"])
    assert.equal(
      (await f.handler(req(path, null, { "x-verified-user-id": "" }), env))
        .status,
      401,
    );
  assert.equal(f.calls.length, 0);
});

test("same-second external body change conflicts by content fingerprint", async () => {
  const f = fixture();
  f.issue.body = "changed within same second";
  const r = await f.handler(req("/api/issues/2", patch()), env);
  assert.equal(r.status, 409);
  assert.equal(
    f.calls.some((c) => c.method === "PATCH"),
    false,
  );
});

test("independent reads overlap, cold token is single-flight, and parent hydration is deduplicated", async () => {
  const f = fixture({ extraTasks: true });
  let releaseItems;
  const itemsGate = new Promise((resolve) => {
    releaseItems = resolve;
  });
  const started = new Set();
  const handler = createHandler({
    fetch: async (url, opt) => {
      const query = opt.body ? JSON.parse(opt.body).query || "" : "";
      if (query.includes("BoardRelations")) {
        started.add("items");
        await itemsGate;
      }
      if (query.includes("BoardRows")) started.add("rows");
      if (url.includes("/assignees")) started.add("assignees");
      if (started.has("rows") && started.has("assignees")) releaseItems();
      return f.fetch(url, opt);
    },
  });
  const response = await handler(req(), env);
  assert.equal(response.status, 200);
  assert.equal(started.size, 3);
  assert.equal(
    f.calls.filter((c) => c.url.includes("/access_tokens")).length,
    1,
  );
  const parents = f.calls.filter((c) =>
    c.parsed?.query?.includes("ParentDetails"),
  );
  assert.equal(parents.length, 1);
  assert.deepEqual(parents[0].parsed.variables.ids, ["I1"]);
  assert.match(response.headers.get("server-timing"), /relations;dur=/);
  assert.equal((await response.json()).lanes[0].body, "original");
});

test("lean Project index hydrates only selected formal descendants and never emits missing content", async () => {
  const f = fixture({ extraTasks: true });
  const handler = createHandler({
    fetch: async (url, opt) => {
      const query = opt.body ? JSON.parse(opt.body).query || "" : "";
      const response = await f.fetch(url, opt);
      if (!query.includes("BoardBootstrap") && !query.includes("BoardItems"))
        return response;
      assert.equal(query.includes("body"), false);
      assert.equal(query.includes("assignees"), false);
      assert.equal(query.includes("fieldValueByName"), false);
      const data = await response.json();
      for (const item of data.data.organization.projectV2.items.nodes) {
        delete item.content.body;
        delete item.content.title;
        delete item.content.assignees;
      }
      return Response.json(data);
    },
  });
  const r = await handler(req(), env);
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.deepEqual(
    b.tasks.map((t) => t.id),
    ["I2", "I3"],
  );
  for (const i of [...b.lanes, ...b.tasks]) {
    assert.equal(i.body, "original");
    assert.ok(i.title);
    assert.match(i.fingerprint, /^[a-f0-9]{64}$/);
  }
  const details = f.calls.filter((c) =>
    c.parsed?.query?.includes("IssueDetails"),
  );
  assert.deepEqual(details[0].parsed.variables.ids, ["I1", "I2", "I3"]);
});

test("missing Issue hydration fails closed instead of returning an incomplete editable card", async () => {
  const f = fixture();
  const handler = createHandler({
    fetch: async (url, opt) => {
      if (opt.body && JSON.parse(opt.body).query?.includes("IssueDetails"))
        return Response.json({ data: { nodes: [] } });
      return f.fetch(url, opt);
    },
  });
  const r = await handler(req(), env);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "issue_details_unavailable");
});

test("opaque index pages stay sequential while relation batches overlap and preserve source order", async () => {
  const f = fixture();
  const parent = makeIssue(1, "PBI");
  const issues = Array.from({ length: 201 }, (_, n) =>
    makeIssue(n + 2, "Task", parent),
  );
  let active = 0,
    peak = 0;
  const handler = createHandler({
    fetch: async (url, opt) => {
      const b = opt.body ? JSON.parse(opt.body) : {};
      const q = b.query || "";
      if (/BoardBootstrap|BoardItems/.test(q)) {
        const base = await (await f.fetch(url, opt)).json();
        const start = Number(b.variables?.after || 0);
        base.data.organization.projectV2.items = {
          nodes: issues.slice(start, start + 100).map((i) => ({
            id: "ITEM" + i.number,
            isArchived: false,
            content: { id: i.id, repository: i.repository },
          })),
          pageInfo: {
            hasNextPage: start + 100 < issues.length,
            endCursor: String(start + 100),
          },
        };
        return Response.json(base);
      }
      if (q.includes("BoardRelations")) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) =>
          setTimeout(resolve, b.variables.ids[0] === "I2" ? 20 : 1),
        );
        active--;
        return Response.json({
          data: { nodes: issues.filter((i) => b.variables.ids.includes(i.id)) },
        });
      }
      if (q.includes("IssueDetails"))
        return Response.json({
          data: {
            nodes: [parent, ...issues].filter((i) =>
              b.variables.ids.includes(i.id),
            ),
            statuses: b.variables.items.map((id) => ({
              id,
              fieldValueByName: { name: "未整理" },
            })),
          },
        });
      return f.fetch(url, opt);
    },
  });
  const r = await handler(req(), env);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(peak, 3);
  assert.deepEqual(
    data.tasks.map((i) => i.number),
    issues.map((i) => i.number),
  );
  assert.equal(
    data.tasks.every((i) => i.lane === "I1"),
    true,
  );
  assert.equal(
    data.tasks.every((i) => i.status === "未整理"),
    true,
  );
});

test("simultaneous cold board requests share one installation token exchange", async () => {
  const f = fixture();
  const handler = f.newHandler();
  const responses = await Promise.all([
    handler(req(), env),
    handler(req(), env),
  ]);
  assert.equal(
    responses.every((r) => r.status === 200),
    true,
  );
  assert.equal(
    f.calls.filter((c) => c.url.includes("/access_tokens")).length,
    1,
  );
});

test("focused PBI path matches full-scan hierarchy, full editor data and milestone semantics", async () => {
  const fast = fixture({
    viewFilter: "type:PBI",
    extraTasks: true,
    parentInProject: true,
  });
  const scan = fixture({
    viewFilter: "milestone:Sprint",
    extraTasks: true,
    parentInProject: true,
  });
  const a = await (await fast.handler(req(), env)).json();
  const b = await (await scan.handler(req(), env)).json();
  assert.deepEqual(a.lanes, b.lanes);
  assert.deepEqual(a.tasks, b.tasks);
  assert.deepEqual(a.scope.milestones, b.scope.milestones);
  assert.equal(
    fast.calls.some((c) =>
      /BoardRelations|ParentDetails|IssueDetails/.test(c.parsed?.query || ""),
    ),
    false,
  );
  const empty = await (
    await fast.handler(req("/api/board?milestone=2"), env)
  ).json();
  assert.deepEqual(empty.lanes, []);
  assert.deepEqual(empty.tasks, []);
});

test("focused hierarchy paginates each level, rejects unrelated/foreign/archived cards and keeps Project order", async () => {
  const f = fixture({ viewFilter: "type:PBI", extraTasks: true });
  const handler = createHandler({
    fetch: async (url, opt) => {
      const body = opt.body ? JSON.parse(opt.body) : {};
      const q = body.query || "";
      const response = await f.fetch(url, opt);
      if (!/BoardBootstrap|BoardChildren/.test(q)) return response;
      const data = await response.json();
      const c = data.data.organization.projectV2.items;
      if (q.includes("BoardBootstrap"))
        c.nodes.sort((a, b) =>
          a.content.id === "I3" ? -1 : b.content.id === "I3" ? 1 : 0,
        );
      if (q.includes("BoardChildren")) {
        if (!body.variables.after)
          return Response.json({
            data: {
              organization: {
                projectV2: {
                  items: {
                    nodes: [],
                    pageInfo: { hasNextPage: true, endCursor: "second" },
                  },
                },
              },
            },
          });
        c.nodes.push({
          id: "BAD",
          content: makeIssue(99, "Task"),
          isArchived: false,
        });
        c.nodes.push({
          id: "FOREIGN",
          content: {
            ...makeIssue(98, "Task"),
            repository: { nameWithOwner: "other/repo" },
          },
          isArchived: false,
        });
        c.nodes.push({
          id: "ARCHIVED",
          content: makeIssue(97, "Task"),
          isArchived: true,
        });
        // Missing child-summary is invalid even on an unrelated same-repo card: provide a complete upstream shape.
        for (const item of c.nodes)
          item.content.subIssuesSummary ??= { total: 0 };
      }
      return Response.json(data);
    },
  });
  const r = await handler(req(), env);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.deepEqual(
    data.tasks.map((i) => i.id),
    ["I3", "I2"],
  );
  assert.equal(
    data.tasks.every((i) => i.lane === "I1"),
    true,
  );
  assert.equal(
    f.calls.filter((c) => c.parsed?.query?.includes("BoardChildren")).length,
    4,
  );
});
