import { validateComment } from "../server/comments.mjs";
import { validateMutation } from "../server/github.mjs";
import { validateNoteIssue } from "../server/note-issue.mjs";
/** 付箋の Issue 化（ADR 019）。この DO は付箋ごとに 1 つ（名前に付箋 ID を含む）。 */
const NOTE_ISSUE_PATH = /^\/api\/team-notes\/(n_[a-z0-9]{8,32})\/issue$/;
interface IssueReceipt {
  number: number;
  url: string;
}
/** Persist only request digests and outcomes, never GitHub Issue content or credentials. */
interface RecordEntry {
  digest: string;
  phase: "pending" | "completed";
  status?: number;
  startedAt: number;
  commentReceipt?: { id: number; url: string };
  issueReceipt?: IssueReceipt;
  /** 部分保存だったときの理由と、済んでいない段（Issue の内容は含まない）。 */
  issueOutcome?: { error: string; failed: string[] };
}
export interface LedgerValues {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}
export interface Ledger extends LedgerValues {
  transaction<T>(callback: (tx: LedgerValues) => Promise<T>): Promise<T>;
}
const json = (error: string, status = 409, ambiguous = false) =>
  Response.json({ ok: false, error, ambiguous }, { status });
async function digest(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 70000) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(all);
}
export class MutationCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  constructor(
    private storage: Ledger,
    private api: (request: Request) => Promise<Response | null>,
  ) {}
  /** この付箋から作った Issue の受領（ADR 019）。付箋へ結び付ける前に Worker が照合する。 */
  async issued(): Promise<IssueReceipt | null> {
    return (await this.storage.get<IssueReceipt>("issued")) ?? null;
  }
  fetch(request: Request): Promise<Response> {
    if (this.waiting >= 32)
      return Promise.resolve(json("mutation_queue_full", 429));
    this.waiting++;
    // Explicit serialization spans all awaited GitHub work. DO single-threaded alone is insufficient.
    const result = this.tail.then(() => this.execute(request));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result
      .catch(() => json("mutation_outcome_unresolved", 503, true))
      .finally(() => {
        this.waiting--;
      });
  }
  private async execute(request: Request): Promise<Response> {
    const user = request.headers.get("x-verified-user-id");
    if (!user) return json("sign_in_required", 401);
    const path = new URL(request.url).pathname;
    const noteIssue = NOTE_ISSUE_PATH.exec(path);
    if (
      new URL(request.url).search ||
      request.method !== "POST" ||
      (!noteIssue && !/^\/api\/issues\/[1-9]\d{0,8}(?:\/comments)?$/.test(path))
    )
      return json("not_found", 404);
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return json("origin_mismatch", 403);
    if (
      !/^application\/json(?:;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    )
      return json("json_required", 415);
    if (Number(request.headers.get("content-length")) > 70000)
      return json("body_too_large", 413);
    const body = await boundedBody(request);
    if (body === null) return json("body_too_large", 413);
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return json("invalid_json", 400);
    }
    try {
      if (noteIssue) {
        if (validateNoteIssue(data).noteId !== noteIssue[1])
          throw new Error("invalid_note");
      } else if (path.endsWith("/comments")) validateComment(data);
      else validateMutation(data);
    } catch (error) {
      return json(
        error instanceof Error ? error.message : "invalid_fields",
        400,
      );
    }
    const key = "request:" + (await digest(user + ":" + data.requestId));
    const hash = await digest(new URL(request.url).pathname + ":" + body);
    const prior = await this.storage.get<RecordEntry>(key);
    if (prior) {
      if (prior.digest !== hash) return json("request_id_reused");
      if (prior.phase === "completed" && prior.commentReceipt) {
        // Receipt still needs current scope/visibility, but never another POST.
        const allowed = await this.api(
          new Request(request.url, { method: "GET", headers: request.headers }),
        );
        if (!allowed?.ok) return allowed ?? json("scope_unavailable", 503);
        return Response.json({
          ok: true,
          alreadyProcessed: true,
          commentReceipt: prior.commentReceipt,
        });
      }
      if (prior.phase === "completed" && prior.issueReceipt) {
        // 部分保存だった要求の再送は、部分保存だったことを落とさずに返す（未完了の段は GitHub で確かめる）。
        const partial = prior.status !== 200;
        return Response.json(
          {
            ok: !partial,
            alreadyProcessed: true,
            issue: prior.issueReceipt,
            ...(partial
              ? {
                  error: prior.issueOutcome?.error ?? "partial_issue",
                  failed: prior.issueOutcome?.failed ?? [],
                  partial: true,
                  ambiguous: false,
                }
              : {}),
          },
          { status: prior.status ?? 200 },
        );
      }
      return json(
        prior.phase === "pending"
          ? "mutation_outcome_unresolved"
          : "request_already_processed",
        409,
        prior.phase === "pending",
      );
    }
    // A crash after writing intent cannot be distinguished from a successful remote write.
    // Fence subsequent mutations until an operator reconciles it; never expire/replay it automatically.
    // 1 枚の付箋から Issue は 1 件だけ。別の requestId で押し直しても二重に作らず、前の Issue を返す。
    if (noteIssue) {
      const issued = await this.storage.get<IssueReceipt>("issued");
      if (issued)
        return Response.json(
          { ok: false, error: "note_already_issued", issue: issued },
          { status: 409 },
        );
    }
    if (await this.storage.get<string>("active"))
      return json("mutation_outcome_unresolved", 409, true);
    const count = (await this.storage.get<number>("count")) ?? 0;
    if (count >= 10000) return json("mutation_ledger_capacity", 503);
    const record: RecordEntry = {
      digest: hash,
      phase: "pending",
      startedAt: Date.now(),
    };
    await this.storage.transaction(async (tx) => {
      await tx.put(key, record);
      await tx.put("active", key);
      await tx.put("count", count + 1);
    });
    const response = await this.api(new Request(request, { body }));
    if (!response) throw new Error("missing mutation response");
    const outcome = (await response.clone().json()) as {
      ambiguous?: boolean;
      comment?: { id: number; url: string };
      issue?: IssueReceipt;
      error?: string;
      failed?: unknown;
    };
    // An upstream timeout can still complete after our readback. Keep the fence on uncertainty.
    if (outcome.ambiguous) return response;
    const issued =
      noteIssue &&
      Number.isSafeInteger(outcome.issue?.number) &&
      typeof outcome.issue?.url === "string"
        ? // Issue の内容（タイトルなど）は残さない。番号と URL だけ。
          { number: outcome.issue!.number, url: outcome.issue!.url }
        : null;
    await this.storage.transaction(async (tx) => {
      await tx.put(key, {
        ...record,
        phase: "completed",
        status: response.status,
        ...(response.ok && outcome.comment
          ? {
              commentReceipt: {
                id: outcome.comment.id,
                url: outcome.comment.url,
              },
            }
          : {}),
        ...(noteIssue && issued ? { issueReceipt: issued } : {}),
        ...(noteIssue && issued && !response.ok
          ? {
              issueOutcome: {
                error: String(outcome.error ?? "partial_issue").slice(0, 64),
                failed: Array.isArray(outcome.failed)
                  ? outcome.failed
                      .filter((x): x is string => typeof x === "string")
                      .slice(0, 8)
                  : [],
              },
            }
          : {}),
      });
      // 部分保存（Project への追加の失敗など）でも Issue はできているので、受領を残す。
      if (issued) await tx.put("issued", issued);
      await tx.delete("active");
    });
    return response;
  }
}
