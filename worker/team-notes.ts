/**
 * チームの付箋（Issue ではない小さな仕事）の保存。GitHub には書かない。
 * 1 つの Durable Object に全付箋を置き、書き込みは明示 queue で 1 件ずつ処理する。
 * 付箋ごとの rev で楽観的競合を検出し、requestId の記録で同じ要求の二重適用を防ぐ。
 */
import type { Ledger } from "./coordinator";

export interface TeamNote {
  id: string;
  text: string;
  done: boolean;
  rev: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}
interface Meta {
  rev: number;
  ids: string[];
  removed: string[];
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

type Op =
  | { op: "create"; texts: string[] }
  | { op: "edit"; id: string; rev: number; text: string }
  | { op: "done"; id: string; rev: number; done: boolean }
  | { op: "remove"; id: string; rev: number }
  | { op: "restore"; id: string; rev: number };

const ID = /^n_[a-z0-9]{8,32}$/;
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
    default:
      return "invalid_op";
  }
}

export class TeamNotesStore {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  constructor(
    private storage: Ledger,
    private newId: () => string = () =>
      "n_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
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
    return { ok: true, rev: meta.rev, notes: await this.notes(meta.ids) };
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

    const key = "request:" + (await sha(user + ":" + data.requestId));
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
    };

    if (op.op === "create") {
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
    } else {
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
    if (changed.length) {
      next.rev = meta.rev + 1;
      body = { ...body, rev: next.rev };
    }
    const record: RequestRecord = { digest, status, body, at };
    const order = (await this.storage.get<string[]>("requests")) ?? [];
    const keep = [key, ...order].slice(0, REQUESTS_KEEP);
    const expired = [key, ...order].slice(REQUESTS_KEEP);
    await this.storage.transaction(async (tx) => {
      for (const note of changed) await tx.put("note:" + note.id, note);
      for (const id of dropped) await tx.delete("note:" + id);
      if (changed.length || dropped.length) await tx.put("meta", next);
      await tx.put(key, record);
      await tx.put("requests", keep);
      for (const old of expired) await tx.delete(old);
    });
    return json(body, status);
  }
}
