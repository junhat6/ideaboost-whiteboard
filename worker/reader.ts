/** A bounded, volatile read snapshot. Never used for mutation preflight/readback. */
type Result = { body: string; status: number; headers: [string, string][] };
const copy = (r: Result) =>
  new Response(r.body, { status: r.status, headers: r.headers });
export class BoardReader {
  private snapshot: {
    result: Result;
    fetchedAt: number;
    epoch: number;
  } | null = null;
  private epoch = 0;
  private writers = new Set<string>();
  private inflight = new Map<string, Promise<Result>>();
  private active = 0;
  constructor(
    private api: (request: Request) => Promise<Response | null>,
    private scope: (request: Request) => Promise<Response>,
    private now = () => Date.now(),
  ) {}
  invalidate(id: string, begin: boolean) {
    this.epoch++;
    this.snapshot = null;
    this.inflight.clear();
    if (begin && this.writers.size >= 1024) return false;
    if (begin) this.writers.add(id);
    else this.writers.delete(id);
    return true;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/board")
      return Response.json({ error: "not_found" }, { status: 404 });
    let invalidKey = false;
    url.searchParams.forEach((_, key) => {
      if (key !== "milestone") invalidKey = true;
    });
    if (
      invalidKey ||
      url.searchParams.getAll("milestone").length > 1 ||
      (url.searchParams.has("milestone") &&
        !/^[1-9]\d{0,8}$/.test(url.searchParams.get("milestone")!))
    )
      return Response.json({ error: "invalid_query" }, { status: 400 });
    const reuse =
      request.headers.get("X-Board-Snapshot") === "1" &&
      !url.searchParams.has("milestone");
    const clean = new Request(url, request);
    const cached = this.snapshot;
    if (
      reuse &&
      cached &&
      !this.writers.size &&
      this.now() - cached.fetchedAt <= 60000
    ) {
      // Both guards are live upstream checks; no cached policy or CDN response.
      for (let i = 0; i < 2; i++) {
        const checked = await this.scope(clean);
        if (!checked.ok) {
          this.snapshot = null;
          this.epoch++;
          this.inflight.clear();
          return checked;
        }
        let scopeKey;
        try {
          scopeKey = ((await checked.json()) as { scopeKey?: string }).scopeKey;
        } catch {
          this.snapshot = null;
          return Response.json({ error: "scope_unavailable" }, { status: 502 });
        }
        const data = JSON.parse(cached.result.body);
        if (
          scopeKey !==
          JSON.stringify([
            data.scope?.viewFilter ?? null,
            data.scope?.statusOptions ?? [],
          ])
        ) {
          this.snapshot = null;
          this.epoch++;
          break;
        }
      }
      if (
        cached.epoch === this.epoch &&
        !this.writers.size &&
        this.now() - cached.fetchedAt <= 60000
      ) {
        const body = JSON.parse(cached.result.body);
        body.readState = {
          kind: "snapshot",
          ageMs: Math.max(0, this.now() - cached.fetchedAt),
        };
        return Response.json(body, {
          headers: {
            "Cache-Control": "no-store",
            "Server-Timing": 'snapshot;desc="guarded-memory"',
          },
        });
      }
    }
    const key = url.search;
    let pending = this.inflight.get(key);
    if (!pending) {
      if (this.active >= 8)
        return Response.json({ error: "read_capacity" }, { status: 429 });
      const epoch = this.epoch;
      this.active++;
      pending = (async () => {
        try {
          const response = await this.api(clean);
          if (!response) throw new Error("missing response");
          const body = await response.text();
          const headers: [string, string][] = [];
          response.headers.forEach((value, key) => headers.push([key, value]));
          const result: Result = {
            body,
            status: response.status,
            headers,
          };
          if (!response.ok) {
            this.snapshot = null;
            this.epoch++;
            this.inflight.clear();
          } else if (
            !key &&
            body.length <= 2000000 &&
            epoch === this.epoch &&
            !this.writers.size
          ) {
            const fetchedAt = Date.parse(JSON.parse(body).fetchedAt);
            if (
              Number.isFinite(fetchedAt) &&
              fetchedAt <= this.now() &&
              this.now() - fetchedAt <= 60000
            )
              this.snapshot = { result, fetchedAt, epoch };
          }
          return result;
        } catch {
          this.snapshot = null;
          return {
            body: '{"error":"github_unavailable"}',
            status: 502,
            headers: [],
          };
        } finally {
          this.active--;
        }
      })();
      this.inflight.set(key, pending);
      const current = pending;
      void pending.finally(() => {
        if (this.inflight.get(key) === current) this.inflight.delete(key);
      });
    }
    return copy(await pending);
  }
}

/** Cache bookkeeping must never turn a confirmed GitHub save into a reported failure. */
export async function withReadInvalidation(
  operation: () => Promise<Response>,
  invalidate: (begin: boolean) => Promise<Response>,
): Promise<Response> {
  try {
    if (!(await invalidate(true)).ok)
      return Response.json(
        { error: "read_invalidation_failed" },
        { status: 503 },
      );
  } catch {
    return Response.json(
      { error: "read_invalidation_failed" },
      { status: 503 },
    );
  }
  // If operation throws or has an uncertain outcome, keep the reader reuse fence.
  const result = await operation();
  let uncertain = result.status >= 500;
  try {
    const body = (await result.clone().json()) as {
      ambiguous?: boolean;
      partial?: boolean;
    };
    uncertain ||= !!body.ambiguous || !!body.partial;
  } catch {
    uncertain = true;
  }
  if (!uncertain) {
    try {
      await invalidate(false);
    } catch {
      /* Reader remains fenced; preserve confirmed result. */
    }
  }
  return result;
}
