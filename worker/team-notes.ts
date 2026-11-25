/**
 * チームの付箋（Issue ではない小さな仕事）の保存。GitHub には書かない。
 * 1 つの Durable Object に全付箋を置き、書き込みは明示 queue で 1 件ずつ処理する。
 * 付箋ごとの rev で楽観的競合を検出し、requestId の記録で同じ要求の二重適用を防ぐ。
 */
import type { Ledger } from "./coordinator";

/** 書き手の種別。ai は Worker の内部の入口（M2 の MCP）だけが付ける。 */
export type Actor = "human" | "ai";

/** 直し案（赤ペン）。before は案を出した時点の本文。 */
export interface Suggestion {
  id: string;
  before: string;
  after: string;
  by: string;
  at: number;
}
/** 添付。文か http/https の URL 1 本。pending は人の採否待ち、kept は採用済み。 */
export interface Attachment {
  id: string;
  kind: "text" | "url";
  value: string;
  label?: string;
  state: "pending" | "kept";
  by: string;
  at: number;
}
export interface TeamNote {
  id: string;
  text: string;
  done: boolean;
  rev: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  suggestions?: Suggestion[];
  attachments?: Attachment[];
  /** AI の提案付箋。人が採用するまで通常の一覧（ids）に入らない。 */
  proposal?: boolean;
  /** この付箋から作った GitHub Issue（ADR 019）。付けると済みになる。 */
  issue?: NoteIssueLink;
}
export interface NoteIssueLink {
  number: number;
  url: string;
  by: string;
  at: number;
}
/** 付箋に結び付けられる Issue の URL。このリポジトリの Issue だけ。 */
export const issueUrl = (number: number) =>
  `https://github.com/engineer-first/idea-boost/issues/${number}`;
interface Meta {
  rev: number;
  ids: string[];
  removed: string[];
  proposals?: string[];
}
interface RequestRecord {
  digest: string;
  status: number;
  body: unknown;
  at: number;
}

export const NOTE_TEXT_MAX = 200;
export const NOTES_MAX = 300;
export const CREATE_BATCH_MAX = 20;
export const SUGGESTIONS_PENDING_MAX = 5;
export const ATTACHMENTS_PENDING_MAX = 5;
export const ATTACHMENTS_KEPT_MAX = 10;
export const PROPOSALS_MAX = 20;
export const ATTACHMENT_TEXT_MAX = 2000;
export const ATTACHMENT_URL_MAX = 2000;
export const ATTACHMENT_LABEL_MAX = 100;
const REMOVED_KEEP = 50;
const REQUESTS_KEEP = 500;
const BODY_MAX = 16000;

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: string, status = 400, extra: object = {}) =>
  json({ ok: false, error, ...extra }, status);

async function sha(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/** 付箋の本文を正規化する。不正なら null。 */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!text || [...text].length > NOTE_TEXT_MAX) return null;
  return text;
}

/** 添付の文。改行とタブは残し、それ以外の制御文字は空白にする。 */
export function normalizeAttachmentText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .trim();
  if (!text || [...text].length > ATTACHMENT_TEXT_MAX) return null;
  return text;
}

/** 添付の URL。http/https だけ、利用者名・パスワード入りは拒否。正規化した文字列か null。 */
export function normalizeAttachmentUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > ATTACHMENT_URL_MAX)
    return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url.href.length > ATTACHMENT_URL_MAX ? null : url.href;
}

type Op =
  | { op: "create"; texts: string[] }
  | { op: "edit"; id: string; rev: number; text: string }
  | { op: "done"; id: string; rev: number; done: boolean }
  | { op: "remove"; id: string; rev: number }
  | { op: "restore"; id: string; rev: number }
  // 人の採否。item なしは提案付箋そのもの、s_ は直し案、a_ は添付。
  | { op: "accept" | "reject"; id: string; item?: string }
  // AI 専用: 付けるだけ。
  | { op: "suggest"; id: string; before: string; after: string }
  | {
      op: "attach";
      id: string;
      kind: "text" | "url";
      value: string;
      label?: string;
    }
  | { op: "propose"; text: string }
  // 人だけ: 付箋から作った Issue を結び付け、済みにする（ADR 019）。
  | { op: "issue"; id: string; number: number; url: string };

/** AI（Worker の内部の入口）だけが使える op。それ以外は人だけ。 */
export const AI_OPS = new Set(["suggest", "attach", "propose"]);

const ID = /^n_[a-z0-9]{8,32}$/;
const ITEM_ID = /^[sa]_[a-z0-9]{8,32}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{12,80}$/;

export function parseOp(data: unknown): Op | string {
  if (!data || typeof data !== "object") return "invalid_fields";
  const d = data as Record<string, unknown>;
  const rev = d.rev;
  const validRev = Number.isInteger(rev) && (rev as number) >= 1;
  const validId = typeof d.id === "string" && ID.test(d.id);
  switch (d.op) {
    case "create": {
      if (!Array.isArray(d.texts) || !d.texts.length) return "invalid_text";
      if (d.texts.length > CREATE_BATCH_MAX) return "too_many_notes";
      const texts = d.texts.map(normalizeText);
      if (texts.some((t) => t === null)) return "invalid_text";
      return { op: "create", texts: texts as string[] };
    }
    case "edit": {
      const text = normalizeText(d.text);
      if (!validId || !validRev) return "invalid_fields";
      if (text === null) return "invalid_text";
      return { op: "edit", id: d.id as string, rev: rev as number, text };
    }
    case "done":
      if (!validId || !validRev || typeof d.done !== "boolean")
        return "invalid_fields";
      return {
        op: "done",
        id: d.id as string,
        rev: rev as number,
        done: d.done,
      };
    case "remove":
    case "restore":
      if (!validId || !validRev) return "invalid_fields";
      return { op: d.op, id: d.id as string, rev: rev as number };
    case "accept":
    case "reject":
      if (!validId) return "invalid_fields";
      if (d.item === undefined) return { op: d.op, id: d.id as string };
      if (typeof d.item !== "string" || !ITEM_ID.test(d.item))
        return "invalid_fields";
      return { op: d.op, id: d.id as string, item: d.item };
    case "suggest": {
      if (!validId || typeof d.before !== "string") return "invalid_fields";
      const after = normalizeText(d.after);
      if (after === null) return "invalid_text";
      return { op: "suggest", id: d.id as string, before: d.before, after };
    }
    case "attach": {
      if (!validId) return "invalid_fields";
      let label: string | undefined;
      if (d.label !== undefined) {
        const l = normalizeText(d.label);
        if (l === null || [...l].length > ATTACHMENT_LABEL_MAX)
          return "invalid_attachment";
        label = l;
      }
      if (d.kind === "text") {
        const value = normalizeAttachmentText(d.value);
        if (value === null) return "invalid_attachment";
        return { op: "attach", id: d.id as string, kind: "text", value, label };
      }
      if (d.kind === "url") {
        const value = normalizeAttachmentUrl(d.value);
        if (value === null) return "invalid_attachment_url";
        return { op: "attach", id: d.id as string, kind: "url", value, label };
      }
      return "invalid_attachment";
    }
    case "issue":
      if (
        !validId ||
        !Number.isSafeInteger(d.number) ||
        (d.number as number) < 1 ||
        d.url !== issueUrl(d.number as number)
      )
        return "invalid_issue";
      return {
        op: "issue",
        id: d.id as string,
        number: d.number as number,
        url: d.url as string,
      };
    case "propose": {
      const text = normalizeText(d.text);
      if (text === null) return "invalid_text";
      return { op: "propose", text };
    }
    default:
      return "invalid_op";
  }
}

export class TeamNotesStore {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  constructor(
    private storage: Ledger,
    private newId: (prefix?: string) => string = (prefix = "n") =>
      prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
    private now: () => number = Date.now,
  ) {}

  fetch(request: Request): Promise<Response> {
    if (request.method === "GET" || request.method === "HEAD")
      return this.list();
    if (request.method !== "POST")
      return Promise.resolve(fail("method_not_allowed", 405));
    if (this.waiting >= 32)
      return Promise.resolve(fail("notes_queue_full", 429));
    this.waiting++;
    // await をまたいでも 1 件ずつ処理する（DO の単一スレッドだけに頼らない）。
    const result = this.tail.then(() => this.write(request));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result
      .catch(() => fail("notes_outcome_unresolved", 503, { ambiguous: true }))
      .finally(() => {
        this.waiting--;
      });
  }

  private async meta(): Promise<Meta> {
    return (
      (await this.storage.get<Meta>("meta")) ?? { rev: 0, ids: [], removed: [] }
    );
  }

  private async notes(ids: string[]) {
    const out: TeamNote[] = [];
    for (const id of ids) {
      const note = await this.storage.get<TeamNote>("note:" + id);
      if (note) out.push(note);
    }
    return out;
  }

  private async snapshot() {
    const meta = await this.meta();
    return {
      ok: true,
      rev: meta.rev,
      notes: await this.notes(meta.ids),
      proposals: await this.notes(meta.proposals ?? []),
    };
  }

  private async list() {
    return json(await this.snapshot());
  }

  private async write(request: Request): Promise<Response> {
    const user = request.headers.get("x-verified-user-id");
    if (!user) return fail("sign_in_required", 401);
    if (
      !/^application\/json(?:;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return fail("json_required", 415);
    const raw = await request.text();
    if (raw.length > BODY_MAX) return fail("body_too_large", 413);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail("invalid_json");
    }
    if (typeof data?.requestId !== "string" || !REQUEST_ID.test(data.requestId))
      return fail("invalid_request_id");
    const op = parseOp(data);
    if (typeof op === "string") return fail(op);
    // 種別は Worker が付ける内部ヘッダーだけで決まる。ブラウザからの同名ヘッダーは Worker が消す。
    const actor: Actor =
      request.headers.get("x-team-notes-actor") === "ai" ? "ai" : "human";
    // AI は付けるだけ。採否・確定・済み・剥がすは人だけ（M2 の MCP でも同じ）。
    if (AI_OPS.has(op.op) !== (actor === "ai"))
      return fail(actor === "ai" ? "human_only" : "ai_only", 403);

    const key =
      "request:" +
      (await sha((actor === "ai" ? "ai:" : "") + user + ":" + data.requestId));
    const digest = await sha(raw);
    const prior = await this.storage.get<RequestRecord>(key);
    if (prior) {
      if (prior.digest !== digest) return fail("request_id_reused", 409);
      // 同じ要求の再送は、前回の結果をそのまま返し、二重に適用しない。
      return json(
        { ...(prior.body as object), alreadyProcessed: true },
        prior.status,
      );
    }

    const meta = await this.meta();
    const at = this.now();
    let status = 200;
    let body: Record<string, unknown> = {};
    const changed: TeamNote[] = [];
    const next: Meta = {
      rev: meta.rev,
      ids: [...meta.ids],
      removed: [...meta.removed],
      proposals: [...(meta.proposals ?? [])],
    };
    const deleted: string[] = [];

    if (op.op === "propose") {
      if (next.proposals!.length >= PROPOSALS_MAX) {
        status = 409;
        body = { ok: false, error: "proposals_full" };
      } else {
        const note: TeamNote = {
          id: this.newId(),
          text: op.text,
          done: false,
          rev: 1,
          createdBy: user,
          createdAt: at,
          updatedAt: at,
          proposal: true,
        };
        changed.push(note);
        next.proposals!.unshift(note.id);
        body = { ok: true, proposal: note };
      }
    } else if (
      (op.op === "accept" || op.op === "reject") &&
      op.item === undefined
    ) {
      const current = await this.storage.get<TeamNote>("note:" + op.id);
      if (!current?.proposal || !next.proposals!.includes(op.id)) {
        status = 404;
        body = { ok: false, error: "note_not_found" };
      } else if (op.op === "reject") {
        // 却下した提案は残さない（requestId の記録が結果を返すので再送は安全）。
        next.proposals = next.proposals!.filter((id) => id !== op.id);
        deleted.push(op.id);
        body = { ok: true, rejected: op.id };
      } else if (meta.ids.length >= NOTES_MAX) {
        status = 409;
        body = { ok: false, error: "notes_full" };
      } else {
        const note: TeamNote = {
          ...current,
          rev: current.rev + 1,
          updatedAt: at,
        };
        delete note.proposal;
        next.proposals = next.proposals!.filter((id) => id !== op.id);
        next.ids.unshift(op.id);
        changed.push(note);
        body = { ok: true, note };
      }
    } else if (
      op.op === "accept" ||
      op.op === "reject" ||
      op.op === "suggest" ||
      op.op === "attach"
    ) {
      const current = await this.storage.get<TeamNote>("note:" + op.id);
      if (!current || !meta.ids.includes(op.id)) {
        status = 404;
        body = { ok: false, error: "note_not_found" };
      } else {
        const suggestions = [...(current.suggestions ?? [])];
        const attachments = [...(current.attachments ?? [])];
        const note: TeamNote = { ...current, suggestions, attachments };
        let textChanged = false;
        if (op.op === "suggest") {
          if (current.done) {
            // 済みの付箋には直し案を出さない（画面にも出ず、人が採否できないため）。
            // 添付は済みの後の成果物（作った資料の URL など）もあるので受け付ける。
            status = 409;
            body = { ok: false, error: "note_done", note: current };
          } else if (op.before !== current.text) {
            status = 409;
            body = { ok: false, error: "note_conflict", note: current };
          } else if (op.after === current.text) {
            status = 400;
            body = { ok: false, error: "suggestion_unchanged" };
          } else if (suggestions.length >= SUGGESTIONS_PENDING_MAX) {
            status = 409;
            body = { ok: false, error: "suggestions_full" };
          } else {
            suggestions.push({
              id: this.newId("s"),
              before: op.before,
              after: op.after,
              by: user,
              at,
            });
          }
        } else if (op.op === "attach") {
          const pending = attachments.filter((a) => a.state === "pending");
          if (pending.length >= ATTACHMENTS_PENDING_MAX) {
            status = 409;
            body = { ok: false, error: "attachments_full" };
          } else {
            attachments.push({
              id: this.newId("a"),
              kind: op.kind,
              value: op.value,
              ...(op.label ? { label: op.label } : {}),
              state: "pending",
              by: user,
              at,
            });
          }
        } else if (op.item!.startsWith("s_")) {
          const index = suggestions.findIndex((x) => x.id === op.item);
          if (index < 0) {
            status = 404;
            body = { ok: false, error: "item_not_found", note: current };
          } else if (op.op === "accept") {
            const suggestion = suggestions[index];
            // 案を出した後に本文が変わっていたら採用しない。現在の付箋を返す。
            if (suggestion.before !== current.text) {
              status = 409;
              body = { ok: false, error: "note_conflict", note: current };
            } else {
              suggestions.splice(index, 1);
              note.text = suggestion.after;
              textChanged = true;
            }
          } else suggestions.splice(index, 1);
        } else {
          const index = attachments.findIndex(
            (x) => x.id === op.item && x.state === "pending",
          );
          if (index < 0) {
            status = 404;
            body = { ok: false, error: "item_not_found", note: current };
          } else if (op.op === "reject") attachments.splice(index, 1);
          else if (
            attachments.filter((a) => a.state === "kept").length >=
            ATTACHMENTS_KEPT_MAX
          ) {
            status = 409;
            body = { ok: false, error: "attachments_full" };
          } else attachments[index] = { ...attachments[index], state: "kept" };
        }
        if (status === 200) {
          // 直し案や添付を付けても本文と状態は変わらないので rev は上げない
          // （人の編集が AI の書き込みで競合にならない）。本文が変わる採用だけ上げる。
          if (textChanged) note.rev = current.rev + 1;
          note.updatedAt = at;
          changed.push(note);
          body = { ok: true, note };
        }
      }
    } else if (op.op === "issue") {
      const current = await this.storage.get<TeamNote>("note:" + op.id);
      if (!current || !meta.ids.includes(op.id)) {
        status = 404;
        body = { ok: false, error: "note_not_found" };
      } else if (current.issue && current.issue.number !== op.number) {
        // 1 枚の付箋に結び付く Issue は 1 件だけ。
        status = 409;
        body = { ok: false, error: "note_already_issued", note: current };
      } else if (current.issue) {
        // 同じ Issue をもう一度結び付ける（別の画面からの押し直し）は何も変えない。
        body = { ok: true, note: current };
      } else {
        const note: TeamNote = {
          ...current,
          done: true,
          issue: { number: op.number, url: op.url, by: user, at },
          rev: current.rev + 1,
          updatedAt: at,
        };
        changed.push(note);
        body = { ok: true, note };
      }
    } else if (op.op === "create") {
      if (meta.ids.length + op.texts.length > NOTES_MAX) {
        status = 409;
        body = { ok: false, error: "notes_full" };
      } else {
        for (const text of op.texts) {
          const note: TeamNote = {
            id: this.newId(),
            text,
            done: false,
            rev: 1,
            createdBy: user,
            createdAt: at,
            updatedAt: at,
          };
          changed.push(note);
          next.ids.unshift(note.id);
        }
        body = { ok: true, notes: changed };
      }
    } else if (
      op.op === "edit" ||
      op.op === "done" ||
      op.op === "remove" ||
      op.op === "restore"
    ) {
      const current = await this.storage.get<TeamNote>("note:" + op.id);
      const isRemoved = meta.removed.includes(op.id);
      const live = meta.ids.includes(op.id);
      if (!current || (op.op === "restore" ? !isRemoved : !live)) {
        status = 404;
        body = { ok: false, error: "note_not_found" };
      } else if (current.rev !== op.rev) {
        status = 409;
        body = { ok: false, error: "note_conflict", note: current };
      } else {
        const note: TeamNote = {
          ...current,
          rev: current.rev + 1,
          updatedAt: at,
        };
        if (op.op === "edit") note.text = op.text;
        if (op.op === "done") note.done = op.done;
        if (op.op === "remove") {
          next.ids = next.ids.filter((id) => id !== op.id);
          next.removed = [op.id, ...next.removed];
        }
        if (op.op === "restore") {
          if (meta.ids.length >= NOTES_MAX) {
            status = 409;
            body = { ok: false, error: "notes_full" };
          } else {
            next.removed = next.removed.filter((id) => id !== op.id);
            next.ids = [op.id, ...next.ids];
          }
        }
        if (status === 200) {
          changed.push(note);
          body = { ok: true, note };
        }
      }
    }

    const dropped = next.removed.slice(REMOVED_KEEP);
    next.removed = next.removed.slice(0, REMOVED_KEEP);
    if (changed.length || deleted.length) {
      next.rev = meta.rev + 1;
      body = { ...body, rev: next.rev };
    }
    const record: RequestRecord = { digest, status, body, at };
    const order = (await this.storage.get<string[]>("requests")) ?? [];
    const keep = [key, ...order].slice(0, REQUESTS_KEEP);
    const expired = [key, ...order].slice(REQUESTS_KEEP);
    await this.storage.transaction(async (tx) => {
      for (const note of changed) await tx.put("note:" + note.id, note);
      for (const id of [...dropped, ...deleted]) await tx.delete("note:" + id);
      if (changed.length || dropped.length || deleted.length)
        await tx.put("meta", next);
      await tx.put(key, record);
      await tx.put("requests", keep);
      for (const old of expired) await tx.delete(old);
    });
    return json(body, status);
  }
}
