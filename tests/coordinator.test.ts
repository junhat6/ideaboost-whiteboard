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
