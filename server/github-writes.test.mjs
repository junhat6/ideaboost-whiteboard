// dev Worker（GITHUB_WRITES 付き）から実チームの Issue へ書かせない契約（ADR 017）。
import test from "node:test";
import assert from "node:assert/strict";
import { githubWritesDisabled, isGithubRead } from "./github.mjs";
import { fixture, env, req, patch } from "../tests/github-fixture.mjs";

// GitHub へ実際に出た書き込み（停止判定と同じ isGithubRead で読み取りでないもの）。
const BASE = "https://api.github.com";
const writes = (calls) =>
  calls.filter(
    (c) =>
      !c.url.includes("/access_tokens") &&
      !isGithubRead(c.method, c.url.slice(BASE.length), c.parsed),
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

// 構文解析せずに読み取りと誤認させる GraphQL。停止中は全て書き込みとして止める（fail closed）。
const disguised = [
  [
    "query の後ろの mutation を operationName で選ぶ",
    { query: "query A { x } mutation B { y }", operationName: "B" },
  ],
  [
    "operationName が付いているだけ",
    { query: "query A { x }", operationName: "A" },
  ],
  [
    "operationName が null でも項目がある",
    { query: "query A { x }", operationName: null },
  ],
  ["複数 operation に mutation", { query: "query A { x } mutation B { y }" }],
  ["subscription", { query: "query A { x } subscription S { y }" }],
  ["大文字の MUTATION", { query: "query A { x } MUTATION B { y }" }],
  ["カンマで区切った mutation", { query: "query A { x },mutation{ y }" }],
  ["コメントの中の mutation", { query: "query A { x } # mutation" }],
  ["文字列の中の mutation", { query: 'query A { x(s: "mutation") }' }],
  ["query が文字列でない（配列）", { query: ["query A { x }"] }],
  ["query が文字列でない（null）", { query: null }],
  ["query が無い", { variables: {} }],
  ["想定外の項目", { query: "query A { x }", extensions: {} }],
];

test("停止中は operationName・複数 operation・コメントや文字列の中の mutation を含む GraphQL も送らない", async () => {
  const disabled = { ...env, GITHUB_WRITES: "disabled" };
  for (const [label, body] of disguised) {
    assert.equal(isGithubRead("POST", "/graphql", body), false, label);
    const f = fixture();
    await assert.rejects(
      f.handler.github.api(disabled, "/graphql", { method: "POST", body }),
      (e) => e.status === 403 && e.code === "github_writes_disabled",
      label,
    );
    // token の取得も含めて何も送らない。
    assert.deepEqual(f.calls, [], label);
  }
});

test("本番（GITHUB_WRITES 未設定）は同じ GraphQL を従来どおり送る", async () => {
  for (const [label, body] of disguised) {
    const f = fixture();
    await f.handler.github
      .api(env, "/graphql", { method: "POST", body })
      .catch(() => {});
    assert.equal(
      f.calls.filter((c) => c.url === BASE + "/graphql").length,
      1,
      label,
    );
  }
});

test("今の読み取りの GraphQL は全て読み取りと判定され、止まるのは実際の mutation だけ", async () => {
  // 本番の設定で、読み取りと書き込みの代表的な経路を一通り動かし、送られた GraphQL を全部集める。
  const sent = [];
  const run = async (request, opts) => {
    const f = fixture(opts);
    await f.handler(request, env);
    sent.push(...f.calls.filter((c) => c.url === BASE + "/graphql"));
  };
  await run(req());
  await run(req(), { paginate: true });
  await run(req("/api/scope"));
  await run(req("/api/issues/2/comments?page=1"));
  await run(req("/api/issues/2", patch()));
  await run(
    req(
      "/api/issues/2",
      patch({
        title: "Issue 2",
        status: "作業中",
        requestId: "request_status_0001",
      }),
    ),
  );
  await run(
    req("/api/issues/2/comments", {
      body: "本文",
      requestId: "comment_0123456789",
    }),
  );
  const names = new Set();
  let mutations = 0;
  for (const c of sent) {
    const isMutation = c.parsed.query.startsWith("mutation");
    if (isMutation) mutations++;
    else names.add(c.parsed.query.match(/^query (\w+)/)?.[1]);
    assert.equal(
      isGithubRead(c.method, "/graphql", c.parsed),
      !isMutation,
      c.parsed.query.slice(0, 60),
    );
  }
  // MutationContext のように名前に Mutation を含む読み取りも止めない（語の境界で判定）。
  assert.ok(names.has("MutationContext"), [...names].join(","));
  assert.ok(names.size >= 5, [...names].join(","));
  assert.equal(mutations, 1);
});
