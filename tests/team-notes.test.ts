import test from "node:test";
import assert from "node:assert/strict";
import type { Ledger, LedgerValues } from "../worker/coordinator.ts";
import {
  TeamNotesStore,
  NOTE_TEXT_MAX,
  CREATE_BATCH_MAX,
  SUGGESTIONS_PENDING_MAX,
  ATTACHMENTS_PENDING_MAX,
  ATTACHMENT_TEXT_MAX,
  PROPOSALS_MAX,
} from "../worker/team-notes.ts";
import { createWorker } from "../worker/index.ts";
import { AccessError } from "../worker/auth.ts";

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
    const before = new Map(this.rows);
    try {
      return await f(this);
    } catch (e) {
      this.rows = before;
      throw e;
    }
  }
}
let seq = 0;
const store = (ledger = new MemoryLedger()) =>
  new TeamNotesStore(
    ledger,
    (prefix = "n") => prefix + "_test" + String(++seq).padStart(4, "0"),
  );
const post = (body: object, user = "member") =>
  new Request("https://board.example/api/team-notes", {
    method: "POST",
    headers: { "content-type": "application/json", "x-verified-user-id": user },
    body: JSON.stringify(body),
  });
const list = async (s: TeamNotesStore) =>
  (await (
    await s.fetch(new Request("https://board.example/api/team-notes"))
  ).json()) as any;

test("同じ requestId の再送は二重に貼らず、本文が違えば拒否する", async () => {
  const s = store();
  const body = {
    requestId: "req_create_000001",
    op: "create",
    texts: ["告知文を考える"],
  };
  const first = await s.fetch(post(body));
  assert.equal(first.status, 200);
  const again = await s.fetch(post(body));
  assert.equal(((await again.json()) as any).alreadyProcessed, true);
  assert.equal((await list(s)).notes.length, 1);
  const reused = await s.fetch(post({ ...body, texts: ["別の本文"] }));
  assert.equal(reused.status, 409);
  assert.equal(((await reused.json()) as any).error, "request_id_reused");
  assert.equal((await list(s)).notes.length, 1);
});

test("古い rev への変更は競合として止め、現在の付箋を返す", async () => {
  const s = store();
  const created = (await (
    await s.fetch(
      post({
        requestId: "req_create_000002",
        op: "create",
        texts: ["会場の電源確認"],
      }),
    )
  ).json()) as any;
  const note = created.notes[0];
  const edited = await s.fetch(
    post({
      requestId: "req_edit_00000001",
      op: "edit",
      id: note.id,
      rev: 1,
      text: "会場の電源と机を確認",
    }),
  );
  assert.equal(edited.status, 200);
  const stale = await s.fetch(
    post({
      requestId: "req_done_00000001",
      op: "done",
      id: note.id,
      rev: 1,
      done: true,
    }),
  );
  assert.equal(stale.status, 409);
  const body = (await stale.json()) as any;
  assert.equal(body.error, "note_conflict");
  assert.equal(body.note.text, "会場の電源と机を確認");
  assert.equal((await list(s)).notes[0].done, false);
});

test("剥がした付箋は一覧から消え、元に戻せる。剥がした付箋は編集できない", async () => {
  const s = store();
  const note = (
    (await (
      await s.fetch(
        post({
          requestId: "req_create_000003",
          op: "create",
          texts: ["お礼メール"],
        }),
      )
    ).json()) as any
  ).notes[0];
  assert.equal(
    (
      await s.fetch(
        post({
          requestId: "req_remove_000001",
          op: "remove",
          id: note.id,
          rev: 1,
        }),
      )
    ).status,
    200,
  );
  assert.equal((await list(s)).notes.length, 0);
  assert.equal(
    (
      await s.fetch(
        post({
          requestId: "req_edit_00000002",
          op: "edit",
          id: note.id,
          rev: 2,
          text: "x",
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await s.fetch(
        post({
          requestId: "req_restore_00001",
          op: "restore",
          id: note.id,
          rev: 2,
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await list(s)).notes.map((n: any) => n.text),
    ["お礼メール"],
  );
});

test("本文と件数を検証し、不正な要求では何も保存しない", async () => {
  const s = store();
  const cases: [object, string][] = [
    [
      { requestId: "req_bad_000000001", op: "create", texts: ["   "] },
      "invalid_text",
    ],
    [
      {
        requestId: "req_bad_000000002",
        op: "create",
        texts: ["あ".repeat(NOTE_TEXT_MAX + 1)],
      },
      "invalid_text",
    ],
    [
      {
        requestId: "req_bad_000000003",
        op: "create",
        texts: Array(CREATE_BATCH_MAX + 1).fill("x"),
      },
      "too_many_notes",
    ],
    [{ requestId: "short", op: "create", texts: ["x"] }, "invalid_request_id"],
    [{ requestId: "req_bad_000000004", op: "drop" }, "invalid_op"],
  ];
  for (const [body, error] of cases) {
    const r = await s.fetch(post(body));
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as any).error, error);
  }
  const ok = (await (
    await s.fetch(
      post({
        requestId: "req_create_000004",
        op: "create",
        texts: ["a\u0007b"],
      }),
    )
  ).json()) as any;
  assert.equal(ok.notes[0].text, "a b");
  assert.equal((await list(s)).notes.length, 1);
});

const path = "/b/" + "a".repeat(48);
// 第 2 引数を省くと有効。undefined を明示すると変数が無い Worker になる。
const publicEnv = (notes?: object, ...flag: [string | undefined] | []) =>
  ({
    TEAM_NOTES_ENABLED: flag.length ? flag[0] : "true",
    AUTH_MODE: "public-temporary",
    APP_ORIGIN: "https://board.example",
    PUBLIC_PATH: path,
    ASSETS: { fetch: async () => new Response("asset") },
    PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
    TEAM_NOTES: notes && { getByName: () => notes },
  }) as any;
const workerRequest = (method = "GET", origin = "https://board.example") =>
  new Request("https://board.example" + path + "/api/team-notes", {
    method,
    headers: {
      Origin: origin,
      "content-type": "application/json",
      "x-verified-user-id": "spoofed",
    },
    body: method === "POST" ? "{}" : undefined,
  });

test("Worker は付箋の書き込みにも Origin 検査と検証済みの利用者だけを使う", async () => {
  const seen: (string | null)[] = [];
  const notes = {
    fetch: async (r: Request) => {
      seen.push(r.headers.get("x-verified-user-id"));
      return Response.json({ ok: true });
    },
  };
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  const cross = await worker.fetch(
    workerRequest("POST", "https://evil.example"),
    publicEnv(notes),
  );
  assert.equal(cross.status, 403);
  assert.equal(seen.length, 0);
  assert.equal(
    (await worker.fetch(workerRequest("POST"), publicEnv(notes))).status,
    200,
  );
  assert.deepEqual(seen, ["public-anonymous"]);
  assert.equal((await worker.fetch(workerRequest(), publicEnv())).status, 503);
});

test("DO への転送が失敗した書き込みは、結果不明として再送を促さない", async () => {
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  const r = await worker.fetch(
    workerRequest("POST"),
    publicEnv({
      fetch: async () => {
        throw new Error("transport");
      },
    }),
  );
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), {
    ok: false,
    error: "notes_outcome_unresolved",
    ambiguous: true,
  });
});

test("付箋が無効な Worker は全メソッドで 404 を返し、DO へ転送しない", async () => {
  // ログイン必須化（#10）前に、匿名で書ける付箋を本番へ出さないための契約。
  let forwarded = 0;
  const notes = {
    fetch: async () => {
      forwarded++;
      return Response.json({ ok: true, notes: [] });
    },
  };
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  let limited = 0;
  const limitedEnv = (enabled: string | undefined) => ({
    ...publicEnv(notes, enabled),
    PUBLIC_LIMITER: {
      limit: async () => {
        limited++;
        return { success: true };
      },
    },
  });
  // 無効な経路の確認は、共有の public-read 枠を使わない。
  assert.equal(
    (await worker.fetch(workerRequest(), limitedEnv(undefined))).status,
    404,
  );
  assert.equal(limited, 0);
  assert.equal(
    (await worker.fetch(workerRequest(), limitedEnv("true"))).status,
    200,
  );
  assert.equal(limited, 1);
  forwarded = 0;
  for (const enabled of [undefined, "false", "TRUE", "1"])
    for (const method of ["GET", "POST"]) {
      const r = await worker.fetch(
        workerRequest(method),
        publicEnv(notes, enabled),
      );
      assert.equal(r.status, 404, `${enabled} ${method}`);
      assert.deepEqual(await r.json(), { ok: false, error: "not_found" });
    }
  // 問い合わせ文字列の検査（400）より先に閉じ、経路の存在を示さない。
  const query = await worker.fetch(
    new Request(
      "https://board.example" + path + "/api/team-notes?x=1",
      workerRequest(),
    ),
    publicEnv(notes, undefined),
  );
  assert.equal(query.status, 404);
  assert.equal(forwarded, 0);

  // チームモードでは無効でも認証が先に走り、未認証は 404 ではなく拒否される（fail closed）。
  const teamEnv = { ...publicEnv(notes, undefined), AUTH_MODE: undefined };
  const teamRequest = () => new Request("https://board.example/api/team-notes");
  const denied = await createWorker(async () => {
    throw new AccessError(401, "sign_in_required");
  }).fetch(teamRequest(), teamEnv);
  assert.equal(denied.status, 401);
  const member = await createWorker(async () => ({
    id: "member",
    email: "",
  })).fetch(teamRequest(), teamEnv);
  assert.equal(member.status, 404);
  assert.equal(forwarded, 0);
});

// ---- M1: 直し案・添付・提案付箋（AI は付けるだけ、採否は人だけ） ----

let rid = 0;
const req = () => "req_m1_" + String(++rid).padStart(8, "0");
/** Worker の内部の入口（M2 の MCP）が付ける ai 種別の要求。 */
const aiPost = (body: object, user = "assistant") =>
  new Request("https://board.example/api/team-notes", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-verified-user-id": user,
      "x-team-notes-actor": "ai",
    },
    body: JSON.stringify({ requestId: req(), ...body }),
  });
const humanPost = (body: object) => post({ requestId: req(), ...body });
const send = async (s: TeamNotesStore, r: Request) => {
  const response = await s.fetch(r);
  return { status: response.status, body: (await response.json()) as any };
};
async function oneNote(s: TeamNotesStore, text = "告知文を考える") {
  const r = await send(s, humanPost({ op: "create", texts: [text] }));
  return r.body.notes[0];
}

test("直し案は AI が付け、人が採用すると本文が after になり rev が上がる。再送は二重に適用しない", async () => {
  const s = store();
  const note = await oneNote(s);
  const suggested = await send(
    s,
    aiPost({
      op: "suggest",
      id: note.id,
      before: note.text,
      after: "ハッカソンの告知文を書く",
    }),
  );
  assert.equal(suggested.status, 200);
  // 案を付けても本文と rev は変わらない（人の編集が競合にならない）。
  assert.equal(suggested.body.note.rev, note.rev);
  assert.equal(suggested.body.note.text, note.text);
  const item = suggested.body.note.suggestions[0];
  assert.deepEqual(
    { before: item.before, after: item.after, by: item.by },
    { before: note.text, after: "ハッカソンの告知文を書く", by: "assistant" },
  );
  const accept = {
    requestId: "req_accept_00000001",
    op: "accept",
    id: note.id,
    item: item.id,
  };
  const accepted = await send(s, post(accept));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.note.text, "ハッカソンの告知文を書く");
  assert.equal(accepted.body.note.rev, note.rev + 1);
  assert.deepEqual(accepted.body.note.suggestions, []);
  const again = await send(s, post(accept));
  assert.equal(again.body.alreadyProcessed, true);
  const listed = (await list(s)).notes[0];
  assert.equal(listed.rev, note.rev + 1);
  assert.equal(listed.text, "ハッカソンの告知文を書く");
});

test("直し案の採用は before と現在の本文を確かめ、違えば 409 で現在の付箋を返す。却下は消える", async () => {
  const s = store();
  const note = await oneNote(s);
  const item = (
    await send(
      s,
      aiPost({ op: "suggest", id: note.id, before: note.text, after: "案 A" }),
    )
  ).body.note.suggestions[0];
  // 古い before の案は付けられない。
  const stale = await send(
    s,
    aiPost({ op: "suggest", id: note.id, before: "古い本文", after: "案 B" }),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "note_conflict");
  // 人が先に本文を直した。
  await send(
    s,
    humanPost({ op: "edit", id: note.id, rev: note.rev, text: "人が直した" }),
  );
  const conflict = await send(
    s,
    humanPost({ op: "accept", id: note.id, item: item.id }),
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "note_conflict");
  assert.equal(conflict.body.note.text, "人が直した");
  assert.equal((await list(s)).notes[0].text, "人が直した");
  const rejected = await send(
    s,
    humanPost({ op: "reject", id: note.id, item: item.id }),
  );
  assert.equal(rejected.status, 200);
  assert.deepEqual(rejected.body.note.suggestions, []);
  assert.equal(rejected.body.note.text, "人が直した");
  const missing = await send(
    s,
    humanPost({ op: "reject", id: note.id, item: item.id }),
  );
  assert.equal(missing.status, 404);
});

test("AI は付けるだけ。採否・作成・編集・済み・剥がすを AI が送っても、人が AI の op を送っても 403 で何も変えない", async () => {
  const s = store();
  const note = await oneNote(s);
  const item = (
    await send(
      s,
      aiPost({ op: "suggest", id: note.id, before: note.text, after: "案" }),
    )
  ).body.note.suggestions[0];
  const before = await list(s);
  for (const body of [
    { op: "accept", id: note.id, item: item.id },
    { op: "reject", id: note.id, item: item.id },
    { op: "create", texts: ["AI が直接貼る"] },
    { op: "edit", id: note.id, rev: note.rev, text: "AI が直接直す" },
    { op: "done", id: note.id, rev: note.rev, done: true },
    { op: "remove", id: note.id, rev: note.rev },
  ]) {
    const r = await send(s, aiPost(body));
    assert.equal(r.status, 403, body.op);
    assert.equal(r.body.error, "human_only");
  }
  for (const body of [
    { op: "suggest", id: note.id, before: note.text, after: "人が案を偽装" },
    { op: "attach", id: note.id, kind: "text", value: "人が添付を偽装" },
    { op: "propose", text: "人が提案を偽装" },
  ]) {
    const r = await send(s, humanPost(body));
    assert.equal(r.status, 403, body.op);
    assert.equal(r.body.error, "ai_only");
  }
  assert.deepEqual(await list(s), before);
});

test("ブラウザの要求で ai を名乗っても、Worker が種別を消すので人として扱われる", async () => {
  const seen: (string | null)[] = [];
  const notes = {
    fetch: async (r: Request) => {
      seen.push(r.headers.get("x-team-notes-actor"));
      return Response.json({ ok: true });
    },
  };
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  const spoof = new Request(workerRequest("POST"), {
    headers: {
      Origin: "https://board.example",
      "content-type": "application/json",
      "x-team-notes-actor": "ai",
    },
  });
  assert.equal((await worker.fetch(spoof, publicEnv(notes))).status, 200);
  assert.deepEqual(seen, [null]);
  // 種別の無い要求を DO は人として扱うので、AI の op は 403 になる（上の試験）。
  const s = store();
  const note = await oneNote(s);
  const r = await send(
    s,
    new Request("https://board.example/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "member",
        "x-team-notes-actor": "AI",
      },
      body: JSON.stringify({
        requestId: req(),
        op: "suggest",
        id: note.id,
        before: note.text,
        after: "大文字なら通るか",
      }),
    }),
  );
  assert.equal(r.status, 403);
});

test("添付は文か http/https の URL だけ。危険な URL・上限超えは拒否し、人が採用すると残り、却下すると消える", async () => {
  const s = store();
  const note = await oneNote(s);
  for (const value of [
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "ftp://files.example/a",
    "https://user:pass@docs.example/",
    "//docs.example/a",
    "https://docs.example/a b",
    "https://docs.example/\u0000",
    "https://docs.example/" + "a".repeat(2000),
  ]) {
    const r = await send(
      s,
      aiPost({ op: "attach", id: note.id, kind: "url", value }),
    );
    assert.equal(r.status, 400, value);
    assert.equal(r.body.error, "invalid_attachment_url");
  }
  const tooLong = await send(
    s,
    aiPost({
      op: "attach",
      id: note.id,
      kind: "text",
      value: "あ".repeat(ATTACHMENT_TEXT_MAX + 1),
    }),
  );
  assert.equal(tooLong.body.error, "invalid_attachment");
  const url = await send(
    s,
    aiPost({
      op: "attach",
      id: note.id,
      kind: "url",
      value: "https://docs.example/slides?id=1",
      label: "告知スライド",
    }),
  );
  assert.equal(url.status, 200);
  const text = await send(
    s,
    aiPost({
      op: "attach",
      id: note.id,
      kind: "text",
      value: "告知文の下書き\n2 行目\u0007",
    }),
  );
  const [first, second] = text.body.note.attachments;
  assert.deepEqual(
    { kind: first.kind, value: first.value, state: first.state },
    {
      kind: "url",
      value: "https://docs.example/slides?id=1",
      state: "pending",
    },
  );
  assert.equal(second.value, "告知文の下書き\n2 行目");
  // 添付を付けても付箋の rev は変わらない。
  assert.equal(text.body.note.rev, note.rev);
  const kept = await send(
    s,
    humanPost({ op: "accept", id: note.id, item: first.id }),
  );
  assert.equal(kept.body.note.attachments[0].state, "kept");
  const rejected = await send(
    s,
    humanPost({ op: "reject", id: note.id, item: second.id }),
  );
  assert.deepEqual(
    rejected.body.note.attachments.map((a: any) => a.id),
    [first.id],
  );
  // 採用済みの添付は採否の対象ではない。
  const keptAgain = await send(
    s,
    humanPost({ op: "reject", id: note.id, item: first.id }),
  );
  assert.equal(keptAgain.status, 404);
});

test("保留中の直し案・添付・提案付箋には上限がある", async () => {
  const s = store();
  const note = await oneNote(s);
  for (let i = 0; i < SUGGESTIONS_PENDING_MAX; i++)
    assert.equal(
      (
        await send(
          s,
          aiPost({
            op: "suggest",
            id: note.id,
            before: note.text,
            after: "案 " + i,
          }),
        )
      ).status,
      200,
    );
  const over = await send(
    s,
    aiPost({ op: "suggest", id: note.id, before: note.text, after: "案 X" }),
  );
  assert.equal(over.body.error, "suggestions_full");
  for (let i = 0; i < ATTACHMENTS_PENDING_MAX; i++)
    await send(
      s,
      aiPost({ op: "attach", id: note.id, kind: "text", value: "添付 " + i }),
    );
  assert.equal(
    (
      await send(
        s,
        aiPost({ op: "attach", id: note.id, kind: "text", value: "添付 X" }),
      )
    ).body.error,
    "attachments_full",
  );
  for (let i = 0; i < PROPOSALS_MAX; i++)
    await send(s, aiPost({ op: "propose", text: "提案 " + i }));
  assert.equal(
    (await send(s, aiPost({ op: "propose", text: "提案 X" }))).body.error,
    "proposals_full",
  );
  assert.equal((await list(s)).proposals.length, PROPOSALS_MAX);
  assert.equal(
    (
      await send(
        s,
        aiPost({
          op: "suggest",
          id: note.id,
          before: note.text,
          after: "あ".repeat(NOTE_TEXT_MAX + 1),
        }),
      )
    ).body.error,
    "invalid_text",
  );
});

test("提案付箋は人が採用するまで通常の一覧に入らず、採用で通常の付箋に、却下で消える", async () => {
  const s = store();
  const proposed = await send(
    s,
    aiPost({ op: "propose", text: "会場の Wi-Fi を確認" }),
  );
  assert.equal(proposed.status, 200);
  const p = proposed.body.proposal;
  let snapshot = await list(s);
  assert.equal(snapshot.notes.length, 0);
  assert.deepEqual(
    snapshot.proposals.map((n: any) => [n.text, n.proposal]),
    [["会場の Wi-Fi を確認", true]],
  );
  // 採用前の提案には人の通常操作も AI の付け足しも効かない。
  assert.equal(
    (await send(s, humanPost({ op: "done", id: p.id, rev: p.rev, done: true })))
      .status,
    404,
  );
  assert.equal(
    (
      await send(
        s,
        aiPost({ op: "suggest", id: p.id, before: p.text, after: "案" }),
      )
    ).status,
    404,
  );
  const accepted = await send(s, humanPost({ op: "accept", id: p.id }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.note.proposal, undefined);
  assert.equal(accepted.body.note.rev, p.rev + 1);
  snapshot = await list(s);
  assert.deepEqual(
    snapshot.notes.map((n: any) => n.text),
    ["会場の Wi-Fi を確認"],
  );
  assert.equal(snapshot.proposals.length, 0);
  const second = (await send(s, aiPost({ op: "propose", text: "不要な提案" })))
    .body.proposal;
  const rejected = await send(s, humanPost({ op: "reject", id: second.id }));
  assert.deepEqual(rejected.body, {
    ok: true,
    rejected: second.id,
    rev: rejected.body.rev,
  });
  snapshot = await list(s);
  assert.equal(snapshot.proposals.length, 0);
  assert.equal(snapshot.notes.length, 1);
  // 通常の付箋を提案として採否することはできない。
  assert.equal(
    (await send(s, humanPost({ op: "reject", id: snapshot.notes[0].id })))
      .status,
    404,
  );
});

test("AI の書き込みも同じ requestId の再送は二重に適用せず、本文が違えば拒否する", async () => {
  const s = store();
  const body = (text: string) =>
    new Request("https://board.example/api/team-notes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-verified-user-id": "assistant",
        "x-team-notes-actor": "ai",
      },
      body: JSON.stringify({
        requestId: "req_propose_000001",
        op: "propose",
        text,
      }),
    });
  assert.equal((await send(s, body("提案"))).status, 200);
  assert.equal((await send(s, body("提案"))).body.alreadyProcessed, true);
  assert.equal(
    (await send(s, body("別の提案"))).body.error,
    "request_id_reused",
  );
  assert.equal((await list(s)).proposals.length, 1);
});

test("保存の途中で失敗した採否は結果不明として返し、記録も変更も残さない", async () => {
  const ledger = new MemoryLedger();
  const s = store(ledger);
  const note = await oneNote(s);
  const item = (
    await send(
      s,
      aiPost({ op: "suggest", id: note.id, before: note.text, after: "案" }),
    )
  ).body.note.suggestions[0];
  const before = structuredClone([...ledger.rows]);
  ledger.transaction = async () => {
    throw new Error("storage");
  };
  const r = await send(
    s,
    humanPost({ op: "accept", id: note.id, item: item.id }),
  );
  assert.equal(r.status, 503);
  assert.deepEqual(r.body, {
    ok: false,
    error: "notes_outcome_unresolved",
    ambiguous: true,
  });
  assert.deepEqual([...ledger.rows], before);
});
