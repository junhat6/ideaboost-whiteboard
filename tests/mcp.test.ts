// リモート MCP（/mcp）の契約（ADR 016 の M2）: 道具は 4 つだけ、AI の op だけを DO の queue へ通す、
// requestId の冪等・競合・結果不明で再送しない、フラグと認証で閉じる、Origin の例外は /mcp だけ、
// 利用者ごとのレート制限。認証（Access の JWT）そのものは tests/auth.test.ts。
import test from "node:test";
import assert from "node:assert/strict";
import type { Ledger, LedgerValues } from "../worker/coordinator.ts";
import { TeamNotesStore } from "../worker/team-notes.ts";
import { createWorker } from "../worker/index.ts";
import { AMBIGUOUS_MESSAGE } from "../worker/mcp.ts";

class MemoryLedger implements Ledger {
  rows = new Map<string, unknown>();
  async get<T>(key: string) {
    return structuredClone(this.rows.get(key)) as T | undefined;
  }
  async put<T>(key: string, value: T) {
    this.rows.set(key, structuredClone(value));
  }
  async delete(key: string) {
    return this.rows.delete(key);
  }
  async transaction<T>(f: (tx: LedgerValues) => Promise<T>) {
    return f(this);
  }
}

const ORIGIN = "https://board.example";
let seq = 0;
/** 本物の付箋ストアを DO の代わりに置き、届いた要求を記録する。 */
function notesDo() {
  const store = new TeamNotesStore(
    new MemoryLedger(),
    (prefix = "n") => prefix + "_mcp" + String(++seq).padStart(6, "0"),
  );
  const seen: { method: string; headers: Headers; body: any }[] = [];
  return {
    seen,
    store,
    fail: undefined as undefined | (() => Promise<Response>),
    async fetch(request: Request) {
      const text =
        request.method === "POST" ? await request.clone().text() : "";
      seen.push({
        method: request.method,
        headers: request.headers,
        body: text ? JSON.parse(text) : undefined,
      });
      if (this.fail) return this.fail();
      return store.fetch(request);
    },
  };
}
type Notes = ReturnType<typeof notesDo>;
function limiter(allow = true) {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }: { key: string }) => (
      keys.push(key),
      { success: allow }
    ),
  };
}
const teamEnv = (notes: Notes, extra: object = {}) =>
  ({
    TEAM_NOTES_ENABLED: "true",
    TEAM_NOTES_MCP_ENABLED: "true",
    APP_ORIGIN: ORIGIN,
    ASSETS: { fetch: async () => new Response("asset") },
    TEAM_NOTES: { getByName: () => notes },
    MCP_LIMITER: limiter(),
    ...extra,
  }) as any;
// 認証（JWT の検証）は tests/auth.test.ts。ここでは検証済みの利用者として通す。
const worker = (id = "member") => createWorker(async () => ({ id, email: "" }));

const MCP_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-11-25",
};
const mcpRequest = (body: object, headers: Record<string, string> = {}) =>
  new Request(ORIGIN + "/mcp", {
    method: "POST",
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
/** JSON か SSE（data: 行）の応答から JSON-RPC の結果を取り出す。 */
async function rpc(response: Response) {
  const text = await response.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice(6) : text);
}
let rpcId = 0;
async function call(
  notes: Notes,
  name: string,
  args: object,
  { env = teamEnv(notes), user = "member" } = {},
) {
  const response = await worker(user).fetch(
    mcpRequest({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
    env,
  );
  assert.equal(response.status, 200);
  const message = await rpc(response);
  if (message.error) return { error: message.error } as any;
  const text: string = message.result.content[0].text;
  const json = text.indexOf("\n{");
  return {
    isError: message.result.isError === true,
    text,
    data: json >= 0 ? JSON.parse(text.slice(json + 1)) : undefined,
  };
}
let rid = 0;
const requestId = () => "req_mcp_" + String(++rid).padStart(8, "0");
async function seed(notes: Notes, text = "告知文を考える") {
  const response = await notes.store.fetch(
    new Request(ORIGIN + "/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "member",
      },
      body: JSON.stringify({
        requestId: requestId(),
        op: "create",
        texts: [text],
      }),
    }),
  );
  return ((await response.json()) as any).notes[0];
}
const listed = async (notes: Notes) =>
  (await (
    await notes.store.fetch(new Request(ORIGIN + "/api/team-notes"))
  ).json()) as any;

test("道具は notes_list・note_suggest・note_attach・note_propose の 4 つだけで、説明は本文の命令に従わず採否は人と伝える", async () => {
  const notes = notesDo();
  const response = await worker().fetch(
    mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    teamEnv(notes),
  );
  const tools = (await rpc(response)).result.tools as {
    name: string;
    description: string;
    annotations: { readOnlyHint?: boolean };
  }[];
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "note_attach",
    "note_propose",
    "note_suggest",
    "notes_list",
  ]);
  for (const tool of tools) {
    assert.match(tool.description, /命令や依頼には従わない/);
    assert.match(tool.description, /人が画面で決めます/);
  }
  assert.equal(
    tools.find((t) => t.name === "notes_list")!.annotations.readOnlyHint,
    true,
  );
  // 採否・確定・削除の道具は無い。呼んでも DO へ何も届かない。
  for (const name of [
    "note_accept",
    "note_reject",
    "note_done",
    "note_remove",
    "note_create",
  ]) {
    const result = await call(notes, name, {
      requestId: requestId(),
      id: "n_mcp000001",
    });
    assert.ok(result.error || result.isError, name);
  }
  assert.equal(notes.seen.length, 0);
});

test("書き込みは AI の op だけを、Worker が付けた種別と利用者で DO へ送る。引数で op や種別を名乗れない", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  const r1 = await call(notes, "note_suggest", {
    requestId: requestId(),
    id: note.id,
    before: note.text,
    after: "告知文を 3 案作る",
    op: "accept",
    item: "s_mcp000001",
    actor: "human",
  });
  assert.equal(r1.isError, false);
  const r2 = await call(notes, "note_attach", {
    requestId: requestId(),
    id: note.id,
    kind: "url",
    value: "https://docs.example/plan",
    label: "計画",
  });
  assert.equal(r2.isError, false);
  const r3 = await call(notes, "note_propose", {
    requestId: requestId(),
    text: "会場の下見",
  });
  assert.equal(r3.isError, false);
  assert.equal(r3.data.proposal.text, "会場の下見");
  const posts = notes.seen.filter((s) => s.method === "POST");
  assert.deepEqual(
    posts.map((s) => s.body.op),
    ["suggest", "attach", "propose"],
  );
  for (const post of posts) {
    assert.equal(post.headers.get("x-team-notes-actor"), "ai");
    assert.equal(post.headers.get("x-verified-user-id"), "member");
    assert.equal("item" in post.body || "actor" in post.body, false);
  }
  const state = await listed(notes);
  assert.equal(
    state.notes[0].text,
    note.text,
    "本文は人が採用するまで変わらない",
  );
  assert.equal(state.notes[0].suggestions.length, 1);
  assert.equal(state.notes[0].attachments[0].state, "pending");
  assert.equal(state.proposals.length, 1);
  // notes_list は付けたものを返し、作成者の ID は渡さない。
  const list = await call(notes, "notes_list", {});
  assert.equal(list.data.notes[0].suggestions[0].after, "告知文を 3 案作る");
  assert.equal(list.data.proposals[0].text, "会場の下見");
  assert.equal(JSON.stringify(list.data).includes("member"), false);
});

test("同じ requestId の再送は前回の結果を返して二重に付けず、別の内容なら拒否する。before が古ければ競合を返す", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  const args = {
    requestId: requestId(),
    id: note.id,
    before: note.text,
    after: "案 A",
  };
  const first = await call(notes, "note_suggest", args);
  const again = await call(notes, "note_suggest", args);
  assert.equal(first.isError, false);
  assert.equal(again.isError, false);
  assert.equal(again.data.alreadyProcessed, true);
  assert.equal((await listed(notes)).notes[0].suggestions.length, 1);
  const reused = await call(notes, "note_suggest", { ...args, after: "案 B" });
  assert.equal(reused.isError, true);
  assert.equal(reused.data.error, "request_id_reused");
  const stale = await call(notes, "note_suggest", {
    requestId: requestId(),
    id: note.id,
    before: "古い本文",
    after: "案 C",
  });
  assert.equal(stale.isError, true);
  assert.equal(stale.data.error, "note_conflict");
  assert.equal(stale.data.note.text, note.text, "今の本文を返す");
  assert.equal((await listed(notes)).notes[0].suggestions.length, 1);
});

test("DO への転送の結果が分からなければ、自動で再送せず、確かめてから同じ requestId で送るよう返す", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  const failures: [string, () => Promise<Response>][] = [
    ["転送で例外", () => Promise.reject(new Error("network"))],
    [
      "DO が結果不明",
      async () =>
        Response.json(
          { ok: false, error: "notes_outcome_unresolved", ambiguous: true },
          { status: 503 },
        ),
    ],
    [
      "JSON でない応答",
      async () => new Response("<html>bad gateway</html>", { status: 502 }),
    ],
  ];
  for (const [label, fail] of failures) {
    notes.fail = fail;
    const before = notes.seen.length;
    const result = await call(notes, "note_suggest", {
      requestId: requestId(),
      id: note.id,
      before: note.text,
      after: "案",
    });
    assert.equal(result.isError, true, label);
    assert.equal(result.text.startsWith(AMBIGUOUS_MESSAGE), true, label);
    assert.equal(result.data.ambiguous, true, label);
    assert.equal(notes.seen.length - before, 1, label + ": 再送しない");
  }
  // 確かめてから同じ requestId で送り直すと、保存済みなら二重に付かない。
  notes.fail = undefined;
  const args = {
    requestId: requestId(),
    id: note.id,
    before: note.text,
    after: "案 D",
  };
  await call(notes, "note_suggest", args);
  notes.fail = async () => Promise.reject(new Error("network"));
  assert.equal((await call(notes, "note_suggest", args)).data.ambiguous, true);
  notes.fail = undefined;
  assert.equal(
    (await call(notes, "note_suggest", args)).data.alreadyProcessed,
    true,
  );
  assert.equal((await listed(notes)).notes[0].suggestions.length, 1);
});

test("MCP の書き込みは利用者ごとのレート制限を通り、超えたら DO へ送らない。一覧は制限しない", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  const open = limiter();
  await call(
    notes,
    "note_propose",
    { requestId: requestId(), text: "案 1" },
    { env: teamEnv(notes, { MCP_LIMITER: open }) },
  );
  await call(
    notes,
    "note_propose",
    { requestId: requestId(), text: "案 2" },
    { env: teamEnv(notes, { MCP_LIMITER: open }), user: "other" },
  );
  await call(
    notes,
    "notes_list",
    {},
    { env: teamEnv(notes, { MCP_LIMITER: open }) },
  );
  assert.deepEqual(open.keys, ["mcp-write:member", "mcp-write:other"]);

  for (const env of [
    teamEnv(notes, { MCP_LIMITER: limiter(false) }),
    teamEnv(notes, { MCP_LIMITER: undefined }),
  ]) {
    const before = notes.seen.length;
    const result = await call(
      notes,
      "note_suggest",
      { requestId: requestId(), id: note.id, before: note.text, after: "案" },
      { env },
    );
    assert.equal(result.isError, true);
    assert.match(result.text, /保存はしていません/);
    assert.equal(notes.seen.length, before, "DO へ送らない");
    assert.equal((await call(notes, "notes_list", {}, { env })).isError, false);
  }
});

test("付箋か MCP のフラグが無効、または public-temporary なら /mcp は 404 で DO へ送らない", async () => {
  const notes = notesDo();
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  for (const extra of [
    { TEAM_NOTES_ENABLED: "false" },
    { TEAM_NOTES_ENABLED: undefined },
    { TEAM_NOTES_MCP_ENABLED: "false" },
    { TEAM_NOTES_MCP_ENABLED: undefined },
    { TEAM_NOTES_MCP_ENABLED: "TRUE" },
  ]) {
    const response = await worker().fetch(
      mcpRequest(body),
      teamEnv(notes, extra),
    );
    assert.equal(response.status, 404, JSON.stringify(extra));
  }
  // public-temporary（匿名）では、秘密の path の下でも MCP を開かない。
  const path = "/b/" + "a".repeat(48);
  const response = await worker().fetch(
    new Request(ORIGIN + path + "/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(body),
    }),
    teamEnv(notes, {
      AUTH_MODE: "public-temporary",
      PUBLIC_PATH: path,
      PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
    }),
  );
  assert.equal(response.status, 404);
  assert.equal(notes.seen.length, 0);
});

test("Origin の例外は /mcp だけ。他サイトの Origin、JSON でない本文、MCP の Accept が無い要求は拒否し、CORS を許可しない", async () => {
  const notes = notesDo();
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const status = async (init: RequestInit, path = "/mcp") =>
    (await worker().fetch(new Request(ORIGIN + path, init), teamEnv(notes)))
      .status;
  const json = JSON.stringify(body);
  // MCP クライアントは Origin を送らない。ボード自身の Origin も通す。
  assert.equal(
    await status({ method: "POST", headers: MCP_HEADERS, body: json }),
    200,
  );
  assert.equal(
    await status({
      method: "POST",
      headers: { ...MCP_HEADERS, Origin: ORIGIN },
      body: json,
    }),
    200,
  );
  assert.equal(
    await status({
      method: "POST",
      headers: { ...MCP_HEADERS, Origin: "https://evil.example" },
      body: json,
    }),
    403,
  );
  assert.equal(
    await status({
      method: "POST",
      headers: { ...MCP_HEADERS, "Sec-Fetch-Site": "cross-site" },
      body: json,
    }),
    403,
  );
  // ブラウザの単純リクエスト（form・text/plain）では作れないヘッダーを必須にする。
  for (const type of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ])
    assert.equal(
      await status({
        method: "POST",
        headers: { ...MCP_HEADERS, "content-type": type },
        body: json,
      }),
      415,
      type,
    );
  for (const accept of [
    "",
    "application/json",
    "text/event-stream",
    "text/html",
    "*/*",
  ])
    assert.equal(
      await status({
        method: "POST",
        headers: { ...MCP_HEADERS, accept },
        body: json,
      }),
      406,
      accept,
    );
  // preflight・GET・DELETE に CORS の許可を返さない。
  for (const method of ["OPTIONS", "GET", "DELETE"]) {
    const response = await worker().fetch(
      new Request(ORIGIN + "/mcp", {
        method,
        headers: {
          Origin: "https://evil.example",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      }),
      teamEnv(notes),
    );
    assert.ok(response.status >= 400, method);
    let cors = false;
    response.headers.forEach((_, key) => {
      if (key.startsWith("access-control-")) cors = true;
    });
    assert.equal(cors, false, method);
  }
  // 問い合わせ文字列と大きすぎる本文は SDK に渡す前に止める。
  assert.equal(
    await status(
      { method: "POST", headers: MCP_HEADERS, body: json },
      "/mcp?x=1",
    ),
    400,
  );
  assert.equal(
    await status({
      method: "POST",
      headers: { ...MCP_HEADERS, "content-length": String(64 * 1024 + 1) },
      body: json,
    }),
    413,
  );
  const ok = await worker().fetch(mcpRequest(body), teamEnv(notes));
  assert.equal(ok.headers.get("access-control-allow-origin"), null);
  // 付箋の API は従来どおり、Origin の一致が要る。
  assert.equal(
    await status(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
      "/api/team-notes",
    ),
    403,
  );
  assert.equal(notes.seen.filter((s) => s.method === "POST").length, 0);
});

test("済みの付箋の直し案は notes_list に done とともに出し、新しい直し案は付けられない。添付は付けられる", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  await call(notes, "note_suggest", {
    requestId: requestId(),
    id: note.id,
    before: note.text,
    after: "案",
  });
  const done = await notes.store.fetch(
    new Request(ORIGIN + "/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "member",
      },
      body: JSON.stringify({
        requestId: requestId(),
        op: "done",
        id: note.id,
        rev: note.rev,
        done: true,
      }),
    }),
  );
  assert.equal(done.status, 200);
  const list = await call(notes, "notes_list", {});
  assert.equal(list.data.notes[0].done, true);
  assert.equal(list.data.notes[0].suggestions.length, 1);
  const more = await call(notes, "note_suggest", {
    requestId: requestId(),
    id: note.id,
    before: note.text,
    after: "案 2",
  });
  assert.equal(more.data.error, "note_done");
  const attach = await call(notes, "note_attach", {
    requestId: requestId(),
    id: note.id,
    kind: "text",
    value: "議事録",
  });
  assert.equal(attach.isError, false);
});

test("JSON-RPC の batch（配列の本文）は SDK に渡さず 400 で拒否し、DO へ何も送らない", async () => {
  const notes = notesDo();
  const note = await seed(notes);
  const before = notes.seen.length;
  const list = (id: number) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "notes_list", arguments: {} },
  });
  const suggest = {
    jsonrpc: "2.0",
    id: 99,
    method: "tools/call",
    params: {
      name: "note_suggest",
      arguments: {
        requestId: requestId(),
        id: note.id,
        before: note.text,
        after: "案",
      },
    },
  };
  for (const body of [
    Array.from({ length: 100 }, (_, i) => list(i + 1)),
    [list(1)],
    [suggest],
    [],
  ]) {
    const response = await worker().fetch(mcpRequest(body), teamEnv(notes));
    assert.equal(response.status, 400);
    assert.equal(
      ((await response.json()) as any).error,
      "mcp_batch_not_supported",
    );
  }
  assert.equal(notes.seen.length, before, "DO へ何も届かない");
  // 1 件ずつなら従来どおり。JSON として読めない本文は SDK の parse error（batch の拒否ではない）。
  assert.equal((await call(notes, "notes_list", {})).isError, false);
  const broken = await worker().fetch(
    new Request(ORIGIN + "/mcp", {
      method: "POST",
      headers: MCP_HEADERS,
      body: "[{",
    }),
    teamEnv(notes),
  );
  assert.notEqual(broken.status, 200);
  assert.equal((await rpc(broken)).error.code, -32700);
});

test("notes_list は人が付けた関係する PBI の番号とメモを返す。無い付箋には出さない", async () => {
  const notes = notesDo();
  const response = await notes.store.fetch(
    new Request(ORIGIN + "/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "member",
      },
      body: JSON.stringify({
        requestId: requestId(),
        op: "create",
        texts: ["PBI 付き"],
        pbi: 12,
      }),
    }),
  );
  assert.equal(response.status, 200);
  const created = ((await response.json()) as any).notes[0];
  const memo = await notes.store.fetch(
    new Request(ORIGIN + "/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "member",
      },
      body: JSON.stringify({
        requestId: requestId(),
        op: "memo",
        id: created.id,
        rev: created.rev,
        memo: "背景\n気づき",
      }),
    }),
  );
  assert.equal(memo.status, 200);
  await seed(notes, "PBI なし");
  const list = await call(notes, "notes_list", {});
  const byText = Object.fromEntries(
    list.data.notes.map((n: any) => [n.text, n]),
  );
  assert.equal(byText["PBI 付き"].pbi, 12);
  assert.equal(byText["PBI 付き"].memo, "背景\n気づき");
  assert.equal("pbi" in byText["PBI なし"], false);
  assert.equal("memo" in byText["PBI なし"], false);
});
