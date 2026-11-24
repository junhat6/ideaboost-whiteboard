// dev Worker（GITHUB_WRITES 付き）から実チームの Issue へ書かせない契約（ADR 017）。
import test from "node:test";
import assert from "node:assert/strict";
import { githubWritesDisabled } from "./github.mjs";
import { fixture, env, req, patch } from "../tests/github-fixture.mjs";

// GitHub へ実際に出た書き込み。GraphQL は `query` で始まるものだけを読み取りとみなす。
const writes = (calls) =>
  calls.filter(
    (c) =>
      c.method !== "GET" &&
      !c.url.includes("/access_tokens") &&
      !(
        c.url.endsWith("/graphql") && /^\s*query\b/.test(c.parsed?.query ?? "")
      ),
  );

test("GITHUB_WRITES は未設定と enabled だけが書け、綴り違いを含む他の値は止める", () => {
  assert.equal(githubWritesDisabled({}), false);
  assert.equal(githubWritesDisabled({ GITHUB_WRITES: "enabled" }), false);
  for (const value of ["disabled", "", "false", "Enabled", "disable"])
    assert.equal(githubWritesDisabled({ GITHUB_WRITES: value }), true, value);
});

test("書き込み停止中は Issue の変更・Status・コメントを GitHub へ 1 件も送らず 403 で返す", async () => {
  const disabled = { ...env, GITHUB_WRITES: "disabled" };
  for (const [path, body] of [
    ["/api/issues/2", patch()],
    [
      "/api/issues/2",
      patch({
        title: "Issue 2",
        status: "作業中",
        requestId: "request_status_000001",
      }),
    ],
    [
      "/api/issues/2/comments",
      { body: "本文", requestId: "comment_0123456789" },
    ],
  ]) {
    const f = fixture();
    const r = await f.handler(req(path, body), disabled);
    assert.equal(r.status, 403, path);
    const data = await r.json();
    assert.equal(data.error, "github_writes_disabled");
    // 送る前に止めるので「結果不明」ではない。利用者に再取得を求める必要もない。
    assert.notEqual(data.uncertain, true);
    assert.deepEqual(writes(f.calls), [], path);
  }
  // 同じ fixture・同じ変更でも、変数が無ければ従来どおり書ける（本番の挙動は不変）。
  const f = fixture();
  assert.equal(
    (await f.handler(req("/api/issues/2", patch()), env)).status,
    200,
  );
  assert.equal(writes(f.calls).length, 1);
});

// 経路（POST /api/issues/*）の判定を通らない呼び出し（将来の /mcp が save() やコメントの
// write を直接呼ぶ場合）も、GitHub への送り口で止まることを確かめる。
const sends = [
  [
    "REST PATCH",
    (g, e) =>
      g.api(e, "/repos/o/r/issues/2", {
        method: "PATCH",
        body: { title: "x" },
      }),
  ],
  [
    "REST POST",
    (g, e) =>
      g.api(e, "/repos/o/r/issues/2/comments", {
        method: "POST",
        body: { body: "x" },
      }),
  ],
  [
    "REST DELETE",
    (g, e) => g.api(e, "/repos/o/r/issues/2/labels/x", { method: "DELETE" }),
  ],
  ["GraphQL mutation", (g, e) => g.gql(e, "mutation SetStatus { x }")],
  [
    "api() 直の mutation",
    (g, e) =>
      g.api(e, "/graphql", {
        method: "POST",
        body: { query: " mutation M { x }" },
      }),
  ],
  [
    "query で始まらない GraphQL",
    (g, e) =>
      g.api(e, "/graphql", {
        method: "POST",
        body: { query: "# note\nmutation M { x }" },
      }),
  ],
];

test("書き込み停止中は送り口（api/gql）で止め、token の取得も含めて GitHub へ何も送らない", async () => {
  const disabled = { ...env, GITHUB_WRITES: "disabled" };
  for (const [label, send] of sends) {
    const f = fixture();
    await assert.rejects(
      send(f.handler.github, disabled),
      (e) => e.status === 403 && e.code === "github_writes_disabled",
      label,
    );
    assert.deepEqual(f.calls, [], label);
  }
  // 読み取りは止めない。
  const f = fixture();
  await f.handler.github
    .api(disabled, "/repos/o/r/issues/2/comments")
    .catch(() => {});
  await f.handler.github.gql(disabled, "query Q { x }").catch(() => {});
  assert.deepEqual(
    f.calls
      .filter((c) => !c.url.includes("/access_tokens"))
      .map((c) => c.method),
    ["GET", "POST"],
  );
});

test("本番（GITHUB_WRITES 未設定）は送り口でも従来どおり書ける", async () => {
  for (const [label, send] of sends) {
    const f = fixture();
    await send(f.handler.github, env).catch(() => {});
    assert.equal(writes(f.calls).length, 1, label);
  }
});
