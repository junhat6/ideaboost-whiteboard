// 付箋を GitHub Issue にする契約（ADR 019）。
// 守るもの: 必須欄と本文の形・付箋 1 枚に Issue 1 件・部分保存と結果不明を自動でやり直さない・
// GitHub 書き込み停止と機能フラグ・付箋への結び付けは人だけ。
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createHandler } from "../server/github.mjs";
import {
  buildNoteIssueBody,
  validateNoteIssue,
} from "../server/note-issue.mjs";
import {
  MutationCoordinator,
  type Ledger,
  type LedgerValues,
} from "../worker/coordinator.ts";
import { createWorker } from "../worker/index.ts";
import { TeamNotesStore, issueUrl } from "../worker/team-notes.ts";
import { env } from "./github-fixture.mjs";

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

const NOTE = "n_abcdef0123456789";
const PATH = `/api/team-notes/${NOTE}/issue`;
const task = (extra: Record<string, unknown> = {}) => ({
  requestId: "note_issue_00000001",
  noteId: NOTE,
  type: "Task",
  title: "会場の電源を確認する",
  status: "未整理",
  why: "当日の電源が足りるか分からない。",
  ...extra,
});
const post = (data: unknown, path = PATH) =>
  new Request("https://board.example" + path, {
    method: "POST",
    headers: {
      "x-verified-user-id": "owner",
      "content-type": "application/json",
      origin: "https://board.example",
    },
    body: JSON.stringify(data),
  });

/** Issue 作成に関わる GitHub の最小の偽物。各段の失敗を差し込める。 */
function github({
  createFailure = null as null | "network" | 422,
  projectFailure = false,
  parentType = "PBI",
  parentState = "open" as "open" | "closed" | "missing",
  dropType = false,
} = {}) {
  const calls: { url: string; method: string; body: any }[] = [];
  let created: any = null;
  let item: any = null;
  const fetch = async (url: string, opt: any) => {
    const body = opt.body ? JSON.parse(opt.body) : null;
    calls.push({ url, method: opt.method ?? "GET", body });
    if (url.includes("/access_tokens"))
      return Response.json({
        token: "SECRET",
        expires_at: "2099-01-01T00:00:00Z",
      });
    if (url.endsWith("/repos/engineer-first/idea-boost/issues")) {
      if (createFailure === "network") throw new TypeError("network");
      if (createFailure === 422)
        return Response.json({ message: "Validation Failed" }, { status: 422 });
      created = {
        number: 42,
        node_id: "I_new",
        type: body.type,
        parent: body.parent_issue_id === 1001 ? 7 : null,
      };
      return Response.json(
        { number: 42, node_id: "I_new", html_url: "x" },
        { status: 201 },
      );
    }
    if (url.endsWith("/repos/engineer-first/idea-boost/issues/7")) {
      if (parentState === "missing")
        return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json({
        id: 1001,
        number: 7,
        html_url: "https://github.com/engineer-first/idea-boost/issues/7",
        state: parentState,
        type: { name: parentType },
      });
    }
    const q: string = body?.query ?? "";
    if (q.includes("NoteIssueContext"))
      return Response.json({
        data: {
          repository: { isPrivate: false },
          organization: {
            projectV2: {
              id: "P1",
              public: true,
              field: {
                id: "F1",
                options: [
                  { id: "O1", name: "未整理" },
                  { id: "O2", name: "作業中" },
                ],
              },
            },
          },
        },
      });
    if (q.includes("AddNoteIssue")) {
      if (projectFailure)
        return Response.json({ errors: [{ message: "nope" }] });
      item = { id: "ITEM42", status: null };
      return Response.json({
        data: { addProjectV2ItemById: { item: { id: "ITEM42" } } },
      });
    }
    if (q.includes("SetNoteIssueStatus")) {
      const option = body.variables.input.value.singleSelectOptionId;
      item.status = option === "O2" ? "作業中" : "未整理";
      return Response.json({ data: {} });
    }
    if (q.includes("NoteIssueReadback"))
      return Response.json({
        data: {
          repository: {
            issue: {
              id: created.node_id,
              issueType: dropType ? null : { name: created.type },
              parent: created.parent ? { number: created.parent } : null,
              projectItems: {
                nodes: item
                  ? [
                      {
                        isArchived: false,
                        project: { id: "P1" },
                        fieldValueByName: item.status
                          ? { name: item.status }
                          : null,
                      },
                    ]
                  : [],
              },
            },
          },
        },
      });
    throw new Error("unexpected " + url + " " + q.slice(0, 40));
  };
  return {
    calls,
    handler: createHandler({ fetch: fetch as any, crypto: webcrypto as any }),
    creates: () => calls.filter((c) => c.url.endsWith("/idea-boost/issues")),
  };
}

test("本文は Issue 記述ルールの形にする: PBI は冒頭ストーリー → Why、空の任意欄は見出しごと出さない", () => {
  const pbi = validateNoteIssue(
    task({
      type: "PBI",
      title: "付箋の連続入力：続けて案を書ける",
      story: "参加者として、続けて書きたい。なぜなら忘れるからだ。",
      why: "入力先を探して流れが止まる。",
      experience: "",
      notes: "対象外: 共有画面",
    }),
  );
  assert.equal(
    buildNoteIssueBody(pbi),
    "参加者として、続けて書きたい。なぜなら忘れるからだ。\n\n## Why\n\n入力先を探して流れが止まる。\n\n## 補足\n\n対象外: 共有画面",
  );
  const t = validateNoteIssue(task({ how: "仮: 既存処理を使う\r\n2 行目" }));
  assert.equal(
    buildNoteIssueBody(t),
    "## Why\n\n当日の電源が足りるか分からない。\n\n## How\n\n仮: 既存処理を使う\n2 行目",
  );
});

test("必須欄・種類に無い欄・親 PBI・Status を検証し、黙って捨てない", () => {
  const code = (v: unknown) => {
    try {
      validateNoteIssue(v);
      return "ok";
    } catch (e: any) {
      return e.code;
    }
  };
  assert.equal(code(task()), "ok");
  assert.equal(code(task({ why: "  " })), "required_why");
  assert.equal(
    code(task({ type: "PBI", why: "w", story: undefined })),
    "required_story",
  );
  assert.equal(code(task({ title: " " })), "invalid_title");
  // Task に PBI の欄（story）を送ったら拒否（本文から黙って落とさない）。
  assert.equal(code(task({ story: "x" })), "invalid_fields");
  assert.equal(
    code(task({ type: "PBI", story: "s", parent: 7 })),
    "parent_task_only",
  );
  assert.equal(code(task({ parent: 0 })), "invalid_parent");
  assert.equal(code(task({ status: "完了" })), "invalid_status");
  assert.equal(code(task({ type: "Bug" })), "invalid_type");
  assert.equal(code(task({ noteId: "x" })), "invalid_note");
  assert.equal(code(task({ why: "a".repeat(10001) })), "field_too_long");
});

test("作成は種類と親 PBI を同時に指定し、Project へ追加して Status を付け、読み直して確かめる", async () => {
  const g = github();
  const r = await g.handler(post(task({ parent: 7, status: "作業中" })), env);
  assert.equal(r!.status, 200);
  const data = (await r!.json()) as any;
  assert.deepEqual(data.issue, {
    number: 42,
    url: "https://github.com/engineer-first/idea-boost/issues/42",
    title: "会場の電源を確認する",
    type: "Task",
  });
  const create = g.creates();
  assert.equal(create.length, 1);
  assert.deepEqual(create[0].body, {
    title: "会場の電源を確認する",
    body: "## Why\n\n当日の電源が足りるか分からない。",
    type: "Task",
    parent_issue_id: 1001,
  });
});

test("親が PBI でない・無い・閉じているなら、理由を 400 で返して GitHub に作らない", async () => {
  for (const [options, error] of [
    [{ parentType: "Task" }, "parent_not_pbi"],
    [{ parentState: "missing" }, "parent_not_pbi"],
    [{ parentState: "closed" }, "parent_closed"],
  ] as const) {
    const g = github(options);
    const r = await g.handler(post(task({ parent: 7 })), env);
    assert.equal(r!.status, 400, error);
    assert.equal(((await r!.json()) as any).error, error);
    assert.equal(g.creates().length, 0);
  }
});

test("作成後の段の失敗は部分保存として Issue 番号と未完了の段を返し、自動でやり直さない", async () => {
  const g = github({ projectFailure: true });
  const r = await g.handler(post(task()), env);
  assert.equal(r!.status, 502);
  const data = (await r!.json()) as any;
  assert.equal(data.error, "partial_issue");
  assert.equal(data.ambiguous, false);
  assert.equal(data.issue.number, 42);
  assert.deepEqual(data.failed, ["project", "status"]);
  assert.equal(g.creates().length, 1);
  assert.equal(
    g.calls.filter((c) => c.body?.query?.includes("AddNoteIssue")).length,
    1,
  );
  // 種類が黙って落とされた（権限不足など）ことも読み直しで見つける。
  const dropped = github({ dropType: true });
  const d = (await (await dropped.handler(post(task()), env))!.json()) as any;
  assert.deepEqual(d.failed, ["type"]);
});

test("付箋ごとの DO: 結果不明は fence で止め、作れたら別の requestId でも二重に作らず同じ Issue を返す", async () => {
  // 作成の送信が通信エラー: 結果不明。同じ付箋からの次の作成は GitHub に送らない。
  const lost = github({ createFailure: "network" });
  const fenced = new MutationCoordinator(new MemoryLedger(), (r) =>
    lost.handler(r, env),
  );
  const first = await fenced.fetch(post(task()));
  assert.equal(((await first.json()) as any).ambiguous, true);
  const again = await fenced.fetch(
    post(task({ requestId: "note_issue_00000002" })),
  );
  assert.equal(
    ((await again.json()) as any).error,
    "mutation_outcome_unresolved",
  );
  assert.equal(lost.creates().length, 1);

  // 作れた（部分保存を含む）後は、受領を返し続ける。
  const g = github({ projectFailure: true });
  const ledger = new MemoryLedger();
  const coordinator = new MutationCoordinator(ledger, (r) => g.handler(r, env));
  assert.equal((await coordinator.fetch(post(task()))).status, 502);
  const same = (await (await coordinator.fetch(post(task()))).json()) as any;
  assert.equal(same.alreadyProcessed, true);
  assert.equal(same.issue.number, 42);
  // 部分保存だった要求の再送は、部分保存だったことを落とさない。
  assert.equal(same.partial, true);
  assert.deepEqual(same.failed, ["project", "status"]);
  // 受領に Issue の内容（タイトルなど）は残さない。
  assert.deepEqual(await ledger.get("issued"), {
    number: 42,
    url: "https://github.com/engineer-first/idea-boost/issues/42",
  });
  assert.deepEqual((await coordinator.issued())?.number, 42);
  const other = await coordinator.fetch(
    post(task({ requestId: "note_issue_00000003", title: "別の題" })),
  );
  assert.equal(other.status, 409);
  const body = (await other.json()) as any;
  assert.equal(body.error, "note_already_issued");
  assert.equal(body.issue.number, 42);
  assert.equal(g.creates().length, 1);

  // 既知の失敗（422）は記録を閉じ、内容を直して作り直せる。
  const rejected = github({ createFailure: 422 });
  const retry = new MutationCoordinator(new MemoryLedger(), (r) =>
    rejected.handler(r, env),
  );
  assert.equal(
    ((await (await retry.fetch(post(task()))).json()) as any).ambiguous,
    false,
  );
  const second = await retry.fetch(
    post(task({ requestId: "note_issue_00000004" })),
  );
  assert.notEqual(
    ((await second.json()) as any).error,
    "mutation_outcome_unresolved",
  );
  // 経路の付箋 ID と本文の付箋 ID が違えば DO で拒否する。
  const mismatch = await retry.fetch(
    post(task({ requestId: "note_issue_00000005", noteId: "n_other00000000" })),
  );
  assert.equal(mismatch.status, 400);
});

const publicPath = "/b/" + "a".repeat(48);
const workerEnv = (extra: Record<string, unknown> = {}) =>
  ({
    TEAM_NOTES_ENABLED: "true",
    AUTH_MODE: "public-temporary",
    APP_ORIGIN: "https://board.example",
    PUBLIC_PATH: publicPath,
    ASSETS: { fetch: async () => new Response("asset") },
    PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
    NOTE_ISSUE_LIMITER: { limit: async () => ({ success: true }) },
    ...extra,
  }) as any;

test("Worker: 付箋ごとの DO へ転送し、付箋が無効・書き込み停止・他 Origin では DO に届かない", async () => {
  const names: string[] = [];
  const keys: string[] = [];
  const mutations = {
    getByName: (name: string) => {
      names.push(name);
      return { fetch: async () => Response.json({ ok: true }) };
    },
  };
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: true };
    },
  };
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  const send = (e: any, origin = "https://board.example") =>
    worker.fetch(
      new Request("https://board.example" + publicPath + PATH, {
        method: "POST",
        headers: { Origin: origin, "content-type": "application/json" },
        body: "{}",
      }),
      e,
    );
  assert.equal(
    (
      await send(
        workerEnv({
          MUTATIONS: mutations,
          PUBLIC_LIMITER: limiter,
          NOTE_ISSUE_LIMITER: limiter,
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(names, [`engineer-first/idea-boost:note-issue:${NOTE}`]);
  // 公開の入口の枠（public-write）に加えて、匿名全体で 1 つの Issue 作成専用の低い枠でも数える。
  assert.deepEqual(keys, ["public-write", "public-note-issue"]);
  const full = { limit: async () => ({ success: false }) };
  assert.equal(
    (await send(workerEnv({ MUTATIONS: mutations, NOTE_ISSUE_LIMITER: full })))
      .status,
    429,
  );
  // 作成の枠が無い構成では閉じる（fail closed）。
  assert.equal(
    (
      await send(
        workerEnv({ MUTATIONS: mutations, NOTE_ISSUE_LIMITER: undefined }),
      )
    ).status,
    503,
  );
  assert.equal(
    (
      await send(
        workerEnv({ MUTATIONS: mutations, TEAM_NOTES_ENABLED: "false" }),
      )
    ).status,
    404,
  );
  assert.equal(
    (await send(workerEnv({ MUTATIONS: mutations, GITHUB_WRITES: "disabled" })))
      .status,
    403,
  );
  assert.equal(
    (await send(workerEnv({ MUTATIONS: mutations }), "https://evil.example"))
      .status,
    403,
  );
  assert.equal(names.length, 1);
  // DO への転送が落ちたら、作れたかもしれないので結果不明。
  const broken = {
    getByName: () => ({
      fetch: async () => {
        throw new Error("transport");
      },
    }),
  };
  const r = await send(workerEnv({ MUTATIONS: broken }));
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as any).ambiguous, true);
});

const notePost = (data: unknown, ai = false) =>
  new Request("https://board.example/api/team-notes", {
    method: "POST",
    headers: {
      "x-verified-user-id": "owner",
      "content-type": "application/json",
      ...(ai ? { "x-team-notes-actor": "ai" } : {}),
    },
    body: JSON.stringify(data),
  });

test("付箋に Issue を結び付けると済みになる。同じ Issue は何度でも、別の Issue は拒否、AI は結び付けられない", async () => {
  const store = new TeamNotesStore(new MemoryLedger(), () => NOTE);
  await store.fetch(
    notePost({ requestId: "create_000000001", op: "create", texts: ["電源"] }),
  );
  const link = (
    number: number,
    requestId: string,
    ai = false,
    url = issueUrl(number),
  ) =>
    store.fetch(
      notePost({ requestId, op: "issue", id: NOTE, number, url }, ai),
    );
  assert.equal((await link(42, "issue_from_ai_01", true)).status, 403);
  assert.equal(
    (await link(42, "issue_bad_url_01", false, "https://evil.example/42"))
      .status,
    400,
  );
  const first = (await (await link(42, "issue_link_00001")).json()) as any;
  assert.equal(first.note.done, true);
  assert.deepEqual(
    { number: first.note.issue.number, url: first.note.issue.url },
    {
      number: 42,
      url: "https://github.com/engineer-first/idea-boost/issues/42",
    },
  );
  assert.equal((await link(42, "issue_link_00002")).status, 200);
  const other = await link(43, "issue_link_00003");
  assert.equal(other.status, 409);
  assert.equal(((await other.json()) as any).error, "note_already_issued");
});

test("Worker: 付箋への結び付けは、その付箋の DO に残った受領と同じ番号だけ通す", async () => {
  let receipt: unknown = null;
  const forwarded: unknown[] = [];
  const env = workerEnv({
    MUTATIONS: {
      getByName: (name: string) => {
        assert.equal(name, `engineer-first/idea-boost:note-issue:${NOTE}`);
        return {
          fetch: async (r: Request) => {
            assert.equal(new URL(r.url).pathname, "/internal/note-issued");
            return Response.json({ issued: receipt });
          },
        };
      },
    },
    TEAM_NOTES: {
      getByName: () => ({
        fetch: async (r: Request) => {
          forwarded.push(await r.json());
          return Response.json({ ok: true });
        },
      }),
    },
  });
  const worker = createWorker(async () => {
    throw Error("must not require Access");
  });
  const link = (number: number) =>
    worker.fetch(
      new Request("https://board.example" + publicPath + "/api/team-notes", {
        method: "POST",
        headers: {
          Origin: "https://board.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          requestId: "issue_link_00001",
          op: "issue",
          id: NOTE,
          number,
          url: issueUrl(number),
        }),
      }),
      env,
    );
  // まだ作っていない付箋には、任意の番号を結び付けられない。
  assert.equal((await link(42)).status, 409);
  receipt = { number: 42, url: issueUrl(42) };
  assert.equal((await link(41)).status, 409);
  assert.equal(forwarded.length, 0);
  assert.equal((await link(42)).status, 200);
  assert.equal((forwarded[0] as any).number, 42);
});
