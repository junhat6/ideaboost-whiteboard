import test from "node:test";
import assert from "node:assert/strict";
import { fixture, env, req } from "../tests/github-fixture.mjs";
import { createComments, validateComment } from "./comments.mjs";
const payload = { body: "## コメント\n原文", requestId: "comment_0123456789" };
test("comments read/write use scoped Issue; invalid payload and arbitrary Issue never write", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(req("/api/issues/2/comments?page=1"), env)).status,
    200,
  );
  for (const path of [
    "/api/issues/999/comments",
    "/api/issues/2/comments?bad=1",
  ]) {
    const r = await f.handler(req(path, payload), env);
    assert.ok(r.status >= 400);
  }
  assert.equal(
    (
      await f.handler(
        req("/api/issues/2/comments", { ...payload, title: "invalid" }),
        env,
      )
    ).status,
    400,
  );
  assert.equal(
    f.calls.filter((c) => c.url.includes("/comments") && c.method === "POST")
      .length,
    0,
  );
  const r = await f.handler(req("/api/issues/2/comments", payload), env);
  assert.equal(r.status, 201);
  const b = await r.json();
  assert.equal(b.comment.body, payload.body);
  assert.equal(b.comment.author.type, "Bot");
  assert.equal(
    f.calls.filter((c) => c.url.includes("/comments") && c.method === "POST")
      .length,
    1,
  );
});
test("comment transport uncertainty and malformed success map to ambiguous, never retry", async () => {
  const f = fixture({ commentFailure: true });
  const r = await f.handler(req("/api/issues/2/comments", payload), env);
  assert.equal((await r.json()).ambiguous, true);
  assert.equal(
    f.calls.filter((c) => c.url.includes("/comments") && c.method === "POST")
      .length,
    1,
  );
  let writes = 0;
  const handler = createComments({
    scope: async () => {},
    visibility: async () => {},
    read: async () => [],
    write: async () => {
      writes++;
      return {};
    },
  });
  const bad = await handler(req("/api/issues/2/comments", payload), 2, payload);
  assert.equal((await bad.json()).ambiguous, true);
  assert.equal(writes, 1);
});
test("comments visibility checked after read and before post; input bounds and pagination enforced", async () => {
  let privateScope = false,
    writes = 0;
  const h = createComments({
    scope: async () => {},
    visibility: async () => {
      if (privateScope) throw Error("private");
    },
    read: async () => {
      privateScope = true;
      return [];
    },
    write: async () => {
      writes++;
      return {};
    },
  });
  await assert.rejects(() => h(req("/api/issues/2/comments"), 2));
  await assert.rejects(() =>
    h(req("/api/issues/2/comments", payload), 2, payload),
  );
  assert.equal(writes, 0);
  assert.throws(() => validateComment({ ...payload, body: " " }));
  assert.throws(() =>
    validateComment({ ...payload, body: "日".repeat(21000) }),
  );
  assert.equal((await h(req("/api/issues/2/comments?page=0"), 2)).status, 400);
});
test("private transition after accepted POST retains scope signal and ambiguous fence", async () => {
  let posted = false;
  const h = createComments({
    scope: async () => {},
    visibility: async () => {
      if (posted)
        throw Object.assign(Error("private"), { code: "scope_not_public" });
    },
    read: async () => [],
    write: async () => {
      posted = true;
      return {
        id: 1,
        body: "body",
        created_at: "2026-10-26T00:00:00Z",
        user: { login: "app" },
        html_url:
          "https://github.com/engineer-first/idea-boost/issues/2#issuecomment-1",
      };
    },
  });
  const r = await h(req("/api/issues/2/comments", payload), 2, payload);
  const b = await r.json();
  assert.equal(b.error, "scope_not_public");
  assert.equal(b.ambiguous, true);
});
