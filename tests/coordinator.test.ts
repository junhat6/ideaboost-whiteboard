import test from "node:test";
import assert from "node:assert/strict";
import {
  MutationCoordinator,
  type Ledger,
  type LedgerValues,
} from "../worker/coordinator.ts";
import { createWorker } from "../worker/index.ts";
import { fixture, env, req, patch } from "./github-fixture.mjs";
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
const write = (title = "First", id = "request_0123456789") =>
  req("/api/issues/2", patch({ title, requestId: id }));
test("明示closeも同Issue DOを通り、結果不明の後続を永続fenceで停止する", async () => {
  const upstream = fixture({ closeUncertain: true }),
    ledger = new MemoryLedger(),
    coordinator = new MutationCoordinator(ledger, (r) =>
      upstream.newHandler()(r, env),
    );
  const input = patch({ close: true });
  delete (input as any).title;
  const first = await coordinator.fetch(req("/api/issues/2", input));
  assert.equal(first.status, 502);
  assert.equal(((await first.json()) as any).ambiguous, true);
  const restarted = new MutationCoordinator(ledger, (r) =>
    upstream.newHandler()(r, env),
  );
  const next = await restarted.fetch(
    req("/api/issues/2", {
      ...input,
      requestId: "close_next_123456789",
    }),
  );
  assert.equal(next.status, 409);
  assert.equal(
    ((await next.json()) as any).error,
    "mutation_outcome_unresolved",
  );
  assert.equal(upstream.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("two separate Worker handlers share issue coordinator: first succeeds, second conflicts", async () => {
  const upstream = fixture();
  const storage = new MemoryLedger();
  let inside = 0,
    maxInside = 0;
  const coordinator = new MutationCoordinator(storage, async (r) => {
    inside++;
    maxInside = Math.max(maxInside, inside);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return await upstream.newHandler()(r, env);
    } finally {
      inside--;
    }
  });
  const bindings = {
    ...env,
    APP_ORIGIN: "https://board.example",
    MUTATIONS: {
      getByName: (name: string) => {
        assert.equal(name, "engineer-first/idea-boost:2");
        return coordinator;
      },
    },
    ASSETS: {},
  } as any;
  const auth = async () => ({ id: "owner", email: "member@example.com" });
  const isolateA = createWorker(auth, () => {
    throw Error("mutation bypassed coordinator");
  });
  const isolateB = createWorker(auth, () => {
    throw Error("mutation bypassed coordinator");
  });
  const [first, second] = await Promise.all([
    isolateA.fetch(write("First"), bindings),
    isolateB.fetch(write("Second", "request_9876543210"), bindings),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(((await second.json()) as any).error, "conflict");
  assert.equal(upstream.issue.title, "First");
  assert.equal(maxInside, 1);
  assert.equal(upstream.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("durable completed request survives coordinator/handler restart and never replays", async () => {
  const upstream = fixture();
  const ledger = new MemoryLedger();
  assert.equal(
    (
      await new MutationCoordinator(ledger, (r) =>
        upstream.newHandler()(r, env),
      ).fetch(write())
    ).status,
    200,
  );
  const replay = await new MutationCoordinator(ledger, (r) =>
    upstream.newHandler()(r, env),
  ).fetch(write());
  assert.equal(replay.status, 409);
  assert.equal(
    ((await replay.json()) as any).error,
    "request_already_processed",
  );
  assert.equal(upstream.calls.filter((c) => c.method === "PATCH").length, 1);
  const stored = JSON.stringify([...ledger.rows]);
  assert.equal(stored.includes("First"), false);
  assert.equal(stored.includes("PRIVATE KEY"), false);
  assert.equal(stored.includes("original"), false);
});
test("interruption fences same and new request IDs across restart without replay", async () => {
  const ledger = new MemoryLedger();
  let writes = 0;
  const first = new MutationCoordinator(ledger, async () => {
    writes++;
    throw Error("crash after upstream write");
  });
  assert.equal((await first.fetch(write())).status, 503);
  const resumed = new MutationCoordinator(ledger, async () => {
    writes++;
    return new Response();
  });
  for (const r of [write(), write("New", "different_123456789")]) {
    const response = await resumed.fetch(r);
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as any).ambiguous, true);
  }
  assert.equal(writes, 1);
});
test("ledger commit failure after upstream write retains pending fence", async () => {
  class FailingLedger extends MemoryLedger {
    count = 0;
    async transaction<T>(f: (tx: LedgerValues) => Promise<T>) {
      if (++this.count === 2) throw Error("storage unavailable");
      return super.transaction(f);
    }
  }
  const ledger = new FailingLedger();
  let writes = 0;
  const c = new MutationCoordinator(ledger, async () => {
    writes++;
    return Response.json({ ok: true });
  });
  assert.equal((await c.fetch(write())).status, 503);
  assert.ok(await ledger.get("active"));
  assert.equal(
    (await c.fetch(write("Again", "request_new_123456789"))).status,
    409,
  );
  assert.equal(writes, 1);
});
test("known partial response is recorded without replay; fresh deliberate request remains possible", async () => {
  const ledger = new MemoryLedger();
  let calls = 0;
  const c = new MutationCoordinator(ledger, async () => {
    calls++;
    return Response.json(
      { ok: false, partial: true, ambiguous: false },
      { status: 502 },
    );
  });
  assert.equal((await c.fetch(write())).status, 502);
  assert.equal(await ledger.get("active"), undefined);
  assert.equal((await c.fetch(write())).status, 409);
  assert.equal(calls, 1);
  assert.equal(
    (await c.fetch(write("New", "new_deliberate_123456"))).status,
    502,
  );
  assert.equal(calls, 2);
});
test("binding missing fails closed; coordinator rejects unauthenticated and over-limit inputs", async () => {
  const worker = createWorker(
    async () => ({ id: "owner", email: "member@example.com" }),
    () => {
      throw Error("fallback");
    },
  );
  assert.equal(
    (
      await worker.fetch(write(), {
        APP_ORIGIN: "https://board.example",
      } as any)
    ).status,
    503,
  );
  let calls = 0;
  const c = new MutationCoordinator(new MemoryLedger(), async () => {
    calls++;
    return new Response();
  });
  assert.equal(
    (
      await c.fetch(
        new Request("https://board.example/api/issues/2", { method: "POST" }),
      )
    ).status,
    401,
  );
  assert.equal(
    (await c.fetch(req("/api/issues/2", patch({ body: "x".repeat(70001) }))))
      .status,
    413,
  );
  assert.equal(calls, 0);
});

test("ambiguous upstream response fences new IDs even after coordinator restart", async () => {
  const ledger = new MemoryLedger();
  const first = new MutationCoordinator(ledger, async () =>
    Response.json({ ok: false, ambiguous: true }, { status: 502 }),
  );
  assert.equal((await first.fetch(write())).status, 502);
  const resumed = new MutationCoordinator(ledger, async () => {
    throw Error("must not write");
  });
  const blocked = await resumed.fetch(
    write("Another", "another_request_12345"),
  );
  assert.equal(blocked.status, 409);
  assert.equal(
    ((await blocked.json()) as any).error,
    "mutation_outcome_unresolved",
  );
});

test("10,001 invalid unique requests cannot consume durable ledger or block a valid save", async () => {
  const ledger = new MemoryLedger();
  let calls = 0;
  const c = new MutationCoordinator(ledger, async () => {
    calls++;
    return Response.json({ ok: true });
  });
  for (let i = 0; i < 10001; i++) {
    const r = await c.fetch(
      req("/api/issues/2", { requestId: "invalid_request_" + i, rogue: true }),
    );
    assert.equal(r.status, 400);
  }
  assert.equal(ledger.rows.size, 0);
  assert.equal(calls, 0);
  assert.equal((await c.fetch(write())).status, 200);
  assert.equal(calls, 1);
  assert.equal(await ledger.get("count"), 1);
});
test("comments use same Issue coordinator, bind route/body, replay receipt without another POST and fence unknown outcome", async () => {
  const upstream = fixture(),
    storage = new MemoryLedger();
  const coordinator = new MutationCoordinator(storage, (r) =>
    upstream.handler(r, env),
  );
  const data = { body: "comment", requestId: "comment_0123456789" };
  const r = await coordinator.fetch(req("/api/issues/2/comments", data));
  assert.equal(r.status, 201);
  const duplicate = await coordinator.fetch(
    req("/api/issues/2/comments", data),
  );
  assert.equal((await duplicate.json()).commentReceipt.id, 99);
  assert.equal(
    upstream.calls.filter(
      (c) => c.url.includes("/comments") && c.method === "POST",
    ).length,
    1,
  );
  assert.equal(
    (
      await coordinator.fetch(
        req("/api/issues/2/comments", { ...data, body: "different" }),
      )
    ).status,
    409,
  );
  const uncertain = fixture({ commentFailure: true });
  const fence = new MemoryLedger();
  const c = new MutationCoordinator(fence, (r) => uncertain.handler(r, env));
  assert.equal(
    (await (await c.fetch(req("/api/issues/2/comments", data))).json())
      .ambiguous,
    true,
  );
  assert.equal(
    (
      await c.fetch(
        req("/api/issues/2/comments", {
          ...data,
          requestId: "comment_9876543210",
        }),
      )
    ).status,
    409,
  );
  assert.equal((await c.fetch(write())).status, 409);
  assert.equal(
    uncertain.calls.filter(
      (c) => c.url.includes("/comments") && c.method === "POST",
    ).length,
    1,
  );
  const invalid = new MemoryLedger();
  let calls = 0;
  const safe = new MutationCoordinator(invalid, async () => {
    calls++;
    return Response.json({});
  });
  assert.equal(
    (
      await safe.fetch(
        req("/api/issues/2/comments", {
          body: "",
          requestId: "comment_0123456789",
        }),
      )
    ).status,
    400,
  );
  assert.equal(invalid.rows.size, 0);
  assert.equal(calls, 0);
});
test("Worker comment POST routes to the same Issue DO and rejects cross-origin", async () => {
  const f = fixture(),
    storage = new MemoryLedger(),
    coordinator = new MutationCoordinator(storage, (r) => f.handler(r, env));
  const worker = createWorker(
    async () => ({ id: "owner", email: "member@example.com" }),
    () => {
      throw Error("DO bypass");
    },
  );
  const bindings = {
    ...env,
    APP_ORIGIN: "https://board.example",
    MUTATIONS: {
      getByName: (name: string) => {
        assert.equal(name, "engineer-first/idea-boost:2");
        return coordinator;
      },
    },
    ASSETS: {},
  } as any;
  const data = { body: "comment", requestId: "comment_0123456789" };
  assert.equal(
    (
      await worker.fetch(
        req("/api/issues/2/comments", data, { origin: "https://evil.example" }),
        bindings,
      )
    ).status,
    403,
  );
  assert.equal(
    (await worker.fetch(req("/api/issues/2/comments", data), bindings)).status,
    201,
  );
  assert.equal(
    f.calls.filter((c) => c.url.includes("/comments") && c.method === "POST")
      .length,
    1,
  );
});
test("transport failure after coordinator dispatch is ambiguous for comments and Issue writes", async () => {
  let dispatches = 0;
  const worker = createWorker(async () => ({
    id: "owner",
    email: "owner@example.com",
  }));
  const bindings = {
    ...env,
    APP_ORIGIN: "https://board.example",
    MUTATIONS: {
      getByName: () => ({
        fetch: async () => {
          dispatches++;
          throw Error("response lost after remote commit");
        },
      }),
    },
    ASSETS: {},
  } as any;
  for (const [path, data] of [
    [
      "/api/issues/2/comments",
      { body: "comment", requestId: "comment_0123456789" },
    ],
    ["/api/issues/2", patch()],
  ] as const) {
    const r = await worker.fetch(req(path, data), bindings);
    assert.equal(r.status, 503);
    const b = await r.json();
    assert.equal(b.ambiguous, true);
    assert.equal(b.error, "mutation_outcome_unresolved");
  }
  assert.equal(dispatches, 2);
});
