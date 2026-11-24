import test from "node:test";
import assert from "node:assert/strict";
import type { Ledger, LedgerValues } from "../worker/coordinator.ts";
import {
  TeamNotesStore,
  NOTE_TEXT_MAX,
  CREATE_BATCH_MAX,
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
  new TeamNotesStore(ledger, () => "n_test" + String(++seq).padStart(4, "0"));
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
