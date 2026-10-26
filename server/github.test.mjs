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
    f.calls.filter((c) => c.parsed?.query?.includes("BoardItems")).length,
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
    f.calls.find((c) => c.parsed?.query?.includes("BoardItems")).parsed
      .variables.filter,
    "repo:engineer-first/idea-boost",
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
    f.calls.find((c) => c.parsed?.query?.includes("BoardItems")).parsed
      .variables.filter,
    "repo:engineer-first/idea-boost",
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
      if (query.includes("BoardItems")) {
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
  assert.match(response.headers.get("server-timing"), /items;dur=/);
  assert.equal((await response.json()).lanes[0].body, "original");
});
