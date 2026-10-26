import test from "node:test";
import assert from "node:assert/strict";
import { BoardReader } from "../worker/reader.ts";
const guard = () => Response.json({ scopeKey: JSON.stringify([null, []]) });
const request = (snapshot = false, suffix = "") =>
  new Request("https://board.test/api/board" + suffix, {
    headers: snapshot ? { "X-Board-Snapshot": "1" } : {},
  });
function fixture() {
  let time = 100000,
    calls = 0,
    guards = 0,
    status = 200;
  const reader = new BoardReader(
    async () => {
      calls++;
      return Response.json({
        lanes: [],
        tasks: [],
        fetchedAt: new Date(time).toISOString(),
      });
    },
    async () => {
      guards++;
      return Response.json(
        { ok: status === 200, scopeKey: JSON.stringify([null, []]) },
        { status },
      );
    },
    () => time,
  );
  return {
    reader,
    calls: () => calls,
    guards: () => guards,
    tick: (n: number) => (time += n),
    private: () => (status = 403),
  };
}
test("cold read is fresh; warm snapshot preserves timestamp and checks live visibility twice", async () => {
  const f = fixture();
  const cold = (await (await f.reader.fetch(request(true))).json()) as any;
  assert.equal(cold.readState, undefined);
  f.tick(15000);
  const warm = (await (await f.reader.fetch(request(true))).json()) as any;
  assert.equal(warm.fetchedAt, cold.fetchedAt);
  assert.deepEqual(warm.readState, { kind: "snapshot", ageMs: 15000 });
  assert.equal(f.calls(), 1);
  assert.equal(f.guards(), 2);
  await f.reader.fetch(request());
  assert.equal(f.calls(), 2);
});
test("expired snapshots and milestone reads always fetch fresh", async () => {
  const f = fixture();
  await f.reader.fetch(request());
  f.tick(60001);
  assert.equal(
    ((await (await f.reader.fetch(request(true))).json()) as any).readState,
    undefined,
  );
  await f.reader.fetch(request(true, "?milestone=2"));
  assert.equal(f.calls(), 3);
  assert.equal((await f.reader.fetch(request(true, "?x=1"))).status, 400);
});
test("private transition denies and purges snapshot; second guard also fails closed", async () => {
  for (const failAt of [1, 2]) {
    let guards = 0,
      reads = 0;
    const reader = new BoardReader(
      async () => {
        reads++;
        return Response.json({ fetchedAt: new Date().toISOString() });
      },
      async () =>
        Response.json(
          { scopeKey: JSON.stringify([null, []]) },
          { status: ++guards === failAt ? 403 : 200 },
        ),
    );
    await reader.fetch(request());
    assert.equal((await reader.fetch(request(true))).status, 403);
    await reader.fetch(request(true));
    assert.equal(reads, 2);
  }
});
test("overlapping fresh readers share one fetch; invalidation prevents joining or caching prewrite read", async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const reader = new BoardReader(
    async () => {
      const number = ++calls;
      await new Promise<void>((r) => releases.push(r));
      return Response.json({ number, fetchedAt: new Date().toISOString() });
    },
    async () => guard(),
  );
  const a = reader.fetch(request()),
    b = reader.fetch(request());
  assert.equal(calls, 1);
  reader.invalidate("write", true);
  const c = reader.fetch(request());
  assert.equal(calls, 2);
  releases[0]();
  assert.equal(((await (await a).json()) as any).number, 1);
  await b;
  releases[1]();
  await c;
  reader.invalidate("write", false);
  const d = reader.fetch(request(true));
  assert.equal(calls, 3);
  releases[2]();
  await d;
  const cached = (await (await reader.fetch(request(true))).json()) as any;
  assert.equal(cached.number, 3);
  assert.equal(cached.readState.kind, "snapshot");
});
test("invalidation during visibility guard prevents stale cache publication", async () => {
  let release!: () => void,
    calls = 0;
  const reader = new BoardReader(
    async () =>
      Response.json({ number: ++calls, fetchedAt: new Date().toISOString() }),
    async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return guard();
    },
  );
  await reader.fetch(request());
  const pending = reader.fetch(request(true));
  reader.invalidate("write", true);
  release();
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal(((await (await pending).json()) as any).number, 2);
});
test("upstream errors purge snapshots and never cache error responses", async () => {
  let fail = false,
    calls = 0;
  const reader = new BoardReader(
    async () => {
      calls++;
      return fail
        ? new Response('{"error":"bad_credentials"}', { status: 503 })
        : Response.json({ fetchedAt: new Date().toISOString() });
    },
    async () => guard(),
  );
  await reader.fetch(request());
  fail = true;
  assert.equal((await reader.fetch(request())).status, 503);
  assert.equal((await reader.fetch(request(true))).status, 503);
  assert.equal(calls, 3);
});

test("changed saved view/status schema invalidates snapshot before exposure", async () => {
  let reads = 0;
  const reader = new BoardReader(
    async () =>
      Response.json({
        number: ++reads,
        fetchedAt: new Date().toISOString(),
        scope: { viewFilter: "old", statusOptions: [] },
      }),
    async () => Response.json({ scopeKey: JSON.stringify(["new", []]) }),
  );
  await reader.fetch(request());
  const next = (await (await reader.fetch(request(true))).json()) as any;
  assert.equal(next.number, 2);
  assert.equal(next.readState, undefined);
});

import { withReadInvalidation } from "../worker/reader.ts";
test("cache invalidation failure does not mask confirmed save, uncertain outcome keeps fence", async () => {
  let operations = 0;
  const stages: boolean[] = [];
  const success = () => {
    operations++;
    return Promise.resolve(Response.json({ ok: true, issue: { id: "i" } }));
  };
  const denied = await withReadInvalidation(success, async () => {
    throw Error("network");
  });
  assert.equal(denied.status, 503);
  assert.equal(operations, 0);
  const saved = await withReadInvalidation(success, async (begin) => {
    stages.push(begin);
    if (!begin) throw Error("lost ack");
    return new Response(null, { status: 204 });
  });
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as any).ok, true);
  assert.deepEqual(stages, [true, false]);
  stages.length = 0;
  const uncertain = await withReadInvalidation(
    async () => Response.json({ ambiguous: true }, { status: 502 }),
    async (begin) => {
      stages.push(begin);
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(uncertain.status, 502);
  assert.deepEqual(stages, [true]);
});

import {
  fixture as githubFixture,
  env as githubEnv,
  req,
} from "./github-fixture.mjs";
test("shared reader integrates canonical GitHub scope metadata and complete board handler", async () => {
  const f = githubFixture({ viewFilter: "type:PBI" });
  const env = { ...githubEnv, AUTH_MODE: "public-temporary" };
  const reader = new BoardReader(
    (r) => f.handler(r, env),
    async () => (await f.handler(req("/api/scope"), env))!,
  );
  const first = await reader.fetch(req());
  assert.equal(first.status, 200);
  const next = (await (
    await reader.fetch(req("/api/board", null, { "X-Board-Snapshot": "1" }))
  ).json()) as any;
  assert.equal(next.readState.kind, "snapshot");
  assert.ok(next.tasks[0].body);
  assert.ok(next.tasks[0].fingerprint);
  assert.equal(
    f.calls.filter((c: any) => c.parsed?.query?.includes("ReadScope")).length,
    2,
  );
});

for (const changed of ["view", "status"] as const) {
  test(`${changed} mismatch detaches old inflight read and fences its late completion`, async () => {
    let scope = { viewFilter: "old", statusOptions: ["作業中"] };
    let calls = 0;
    const releases = new Map<number, () => void>();
    const reader = new BoardReader(
      async () => {
        const number = ++calls;
        const captured = structuredClone(scope);
        if (number > 1) await new Promise<void>((r) => releases.set(number, r));
        return Response.json({
          number,
          scope: captured,
          fetchedAt: new Date().toISOString(),
        });
      },
      async () =>
        Response.json({
          scopeKey: JSON.stringify([scope.viewFilter, scope.statusOptions]),
        }),
    );
    await reader.fetch(request());
    const old = reader.fetch(request());
    assert.equal(calls, 2);
    scope =
      changed === "view"
        ? { ...scope, viewFilter: "new" }
        : { ...scope, statusOptions: ["作業中", "レビュー中"] };
    const next = reader.fetch(request(true));
    await new Promise((r) => setImmediate(r));
    try {
      assert.equal(calls, 3, "known metadata change must start a new read");
      releases.get(2)!();
      assert.equal(((await (await old).json()) as any).number, 2);
      const joined = reader.fetch(request());
      assert.equal(
        calls,
        3,
        "old finally must not delete the new inflight entry",
      );
      releases.get(3)!();
      const current = (await (await next).json()) as any;
      assert.deepEqual(current.scope, scope);
      assert.equal(current.readState, undefined);
      assert.equal(((await (await joined).json()) as any).number, 3);
      const cached = (await (await reader.fetch(request(true))).json()) as any;
      assert.equal(cached.number, 3);
      assert.deepEqual(cached.scope, scope);
      assert.equal(cached.readState.kind, "snapshot");
    } finally {
      releases.forEach((release) => release());
      await old;
      await next;
    }
  });
}
