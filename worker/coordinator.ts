import { validateMutation } from "../server/github.mjs";
/** Persist only request digests and outcomes, never GitHub Issue content or credentials. */
interface RecordEntry {
  digest: string;
  phase: "pending" | "completed";
  status?: number;
  startedAt: number;
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
    if (
      new URL(request.url).search ||
      request.method !== "POST" ||
      !/^\/api\/issues\/[1-9]\d{0,8}$/.test(new URL(request.url).pathname)
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
      validateMutation(data);
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
    const outcome = (await response.clone().json()) as { ambiguous?: boolean };
    // An upstream timeout can still complete after our readback. Keep the fence on uncertainty.
    if (outcome.ambiguous) return response;
    await this.storage.transaction(async (tx) => {
      await tx.put(key, {
        ...record,
        phase: "completed",
        status: response.status,
      });
      await tx.delete("active");
    });
    return response;
  }
}
