import test from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../worker/index.ts";
import { AccessError } from "../worker/auth.ts";
import { createHandler } from "../server/github.mjs";
import { fixture, env as githubEnv } from "./github-fixture.mjs";

const path = "/b/" + "a".repeat(48);
const origin = "https://board.example";
const bindings = {
  AUTH_MODE: "public-temporary",
  APP_ORIGIN: origin,
  PUBLIC_PATH: path,
  PUBLIC_LIMITER: { limit: async () => ({ success: true }) },
  ASSETS: {
    fetch: async () => {
      throw Error("must not use assets");
    },
  },
  MUTATIONS: {
    getByName: () => {
      throw Error("must not enter mutation or board coordinator");
    },
  },
  HISTORY: {
    getByName: () => {
      throw Error("must not observe history");
    },
  },
} as any;
const request = (url = origin + path + "/api/current-sprint") =>
  new Request(url, {
    headers: {
      "x-verified-user-id": "spoofed",
      "oai-authenticated-user-id": "spoofed",
    },
  });

test("current-sprint uses existing public routing, read limiter, anonymous identity and no-store", async () => {
  let calls = 0;
  const limits: string[] = [];
  const worker = createWorker(
    async () => {
      throw Error("must not authenticate public mode");
    },
    async (r) => {
      calls++;
      assert.equal(new URL(r.url).pathname, "/api/current-sprint");
      assert.equal(r.headers.get("x-verified-user-id"), "public-anonymous");
      assert.equal(r.headers.get("oai-authenticated-user-id"), null);
      return Response.json({ ok: true, currentSprint: null, status: "none" });
    },
  );
  const response = await worker.fetch(request(), {
    ...bindings,
    PUBLIC_LIMITER: {
      limit: async ({ key }: { key: string }) => {
        limits.push(key);
        return { success: true };
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(limits, ["public-read"]);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("X-Robots-Tag")!, /noindex/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("current-sprint host/path/rate gates reject before API dispatch", async () => {
  let calls = 0;
  const worker = createWorker(undefined, async () => {
    calls++;
    return Response.json({ ok: true });
  });
  for (const [url, config, expected] of [
    [origin + "/api/current-sprint", bindings, 404],
    ["https://wrong.example" + path + "/api/current-sprint", bindings, 403],
    [
      origin + path + "/api/current-sprint",
      { ...bindings, PUBLIC_LIMITER: undefined },
      503,
    ],
    [
      origin + path + "/api/current-sprint",
      {
        ...bindings,
        PUBLIC_LIMITER: { limit: async () => ({ success: false }) },
      },
      429,
    ],
    [
      origin + path + "/api/current-sprint",
      { ...bindings, PUBLIC_PATH: "/b/invalid" },
      503,
    ],
  ] as const)
    assert.equal((await worker.fetch(request(url), config)).status, expected);
  assert.equal(calls, 0);
});

for (const [status, code] of [
  [401, "sign_in_required"],
  [403, "member_not_allowed"],
] as const)
  test(`current-sprint team access remains fail closed: ${code}`, async () => {
    let calls = 0;
    const worker = createWorker(
      async () => {
        throw new AccessError(status, code);
      },
      async () => {
        calls++;
        return Response.json({ ok: true });
      },
    );
    const response = await worker.fetch(
      request(origin + "/api/current-sprint"),
      { ...bindings, AUTH_MODE: "team" },
    );
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { ok: false, error: code });
    assert.equal(calls, 0);
  });

test("team current-sprint replaces spoofed identity with the verified member", async () => {
  const worker = createWorker(
    async () => ({ id: "verified-member", email: "member@example.test" }),
    async (r) => {
      assert.equal(r.headers.get("x-verified-user-id"), "verified-member");
      assert.equal(r.headers.get("oai-authenticated-user-id"), null);
      return Response.json({ ok: true, currentSprint: null, status: "none" });
    },
  );
  assert.equal(
    (
      await worker.fetch(request(origin + "/api/current-sprint"), {
        ...bindings,
        AUTH_MODE: "team",
      })
    ).status,
    200,
  );
});

test("actual current catalog endpoint keeps late public revocation fail closed through Worker", async () => {
  const upstream = fixture({
    milestones: [
      {
        number: 10,
        title: "Sprint 10",
        state: "OPEN",
        description:
          '<!-- idea-boost-sprint:v2 {"schema_version":2,"timezone":"Asia/Tokyo","assignment_start_date":"2026-10-28"} -->',
        dueOn: "2026-11-04T00:00:00Z",
        closedAt: null,
      },
    ],
  });
  let catalogRead = false;
  const handler = createHandler({
    now: () => Date.parse("2026-10-28T00:00:00Z"),
    fetch: async (url: any, options: any) => {
      const input = options.body ? JSON.parse(options.body) : {};
      const response = await upstream.fetch(url, options);
      const body = await response.json();
      if (input.query?.includes("ObservationMilestones")) catalogRead = true;
      if (input.query?.includes("PublicScope") && catalogRead)
        body.data.organization.projectV2.public = false;
      return Response.json(body, { status: response.status });
    },
  });
  const worker = createWorker(undefined, handler);
  const response = await worker.fetch(request(), { ...bindings, ...githubEnv });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "scope_not_public",
  });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(catalogRead, true);
});
