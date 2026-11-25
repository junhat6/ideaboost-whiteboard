import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from "jose";
import { authenticate } from "../worker/auth.ts";
import { createWorker } from "../worker/index.ts";
const keys = await generateKeyPair("RS256");
const jwks = createLocalJWKSet({
  keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" }],
});
const env = {
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "board",
  APP_ORIGIN: "https://board.example",
  ALLOWED_EMAILS: "member@example.com",
};
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ email: "member@example.com", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("member")
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("board")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}
const req = (path = "/", jwt?: string) =>
  new Request("https://board.example" + path, {
    headers: jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {},
  });
test("valid member JWT; spoofed email/header alone rejected", async () => {
  assert.equal(
    (await authenticate(req("/", await token()), env, jwks)).email,
    "member@example.com",
  );
  await assert.rejects(
    authenticate(
      new Request("https://board.example", {
        headers: {
          "Cf-Access-Authenticated-User-Email": "member@example.com",
          "x-verified-user-id": "fake",
        },
      }),
      env,
      jwks,
    ),
    { status: 401 },
  );
});
test("nonmember, wrong audience, expired, forged, unconfigured denied", async () => {
  await assert.rejects(
    authenticate(
      req("/", await token({ email: "outsider@example.com" })),
      env,
      jwks,
    ),
    { status: 403 },
  );
  await assert.rejects(
    authenticate(
      req("/", await token()),
      { ...env, ACCESS_AUD: "other" },
      jwks,
    ),
    { status: 401 },
  );
  const expired = await new SignJWT({ email: "member@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("member")
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("board")
    .setIssuedAt(1)
    .setExpirationTime(2)
    .sign(keys.privateKey);
  await assert.rejects(authenticate(req("/", expired), env, jwks), {
    status: 401,
  });
  await assert.rejects(authenticate(req("/", "fake.fake.fake"), env, jwks), {
    status: 401,
  });
  await assert.rejects(authenticate(req(), {}, jwks), { status: 503 });
});
test("all HTML, static and API routes are gated, including nonmember", async () => {
  const worker = createWorker((r, e) => authenticate(r, e, jwks));
  let assets = 0;
  const bindings = {
    ...env,
    ASSETS: {
      fetch: async () => {
        assets++;
        return new Response("private");
      },
    },
  } as any;
  for (const path of [
    "/",
    "/app.js",
    "/styles.css",
    "/api/board",
    "/api/health",
    "/mcp",
  ]) {
    assert.equal((await worker.fetch(req(path), bindings)).status, 401);
    assert.equal(
      (
        await worker.fetch(
          req(path, await token({ email: "outsider@example.com" })),
          bindings,
        )
      ).status,
      403,
    );
  }
  assert.equal(assets, 0);
  assert.equal(
    (await worker.fetch(req("/", await token()), bindings)).status,
    200,
  );
  assert.equal(assets, 1);
});
test("cross-origin writes and alternate host denied before API invocation", async () => {
  let calls = 0;
  const w = createWorker(
    (r, e) => authenticate(r, e, jwks),
    async () => {
      calls++;
      return new Response("ok");
    },
  );
  const jwt = await token();
  const bindings = { ...env, ASSETS: {} } as any;
  const request = new Request("https://board.example/api/issues/1", {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": jwt, Origin: "https://evil.example" },
  });
  assert.equal((await w.fetch(request, bindings)).status, 403);
  assert.equal(
    (
      await w.fetch(
        new Request("https://preview.example/", {
          headers: { "Cf-Access-Jwt-Assertion": jwt },
        }),
        bindings,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("worker replaces spoofed identity and sets security headers", async () => {
  const w = createWorker(
    (r, e) => authenticate(r, e, jwks),
    async (r) => {
      assert.equal(r.headers.get("x-verified-user-id"), "member");
      assert.equal(r.headers.get("oai-authenticated-user-id"), null);
      return new Response("ok");
    },
  );
  const r = await w.fetch(
    new Request("https://board.example/api/board", {
      headers: {
        "Cf-Access-Jwt-Assertion": await token(),
        "x-verified-user-id": "attacker",
        "oai-authenticated-user-id": "owner",
      },
    }),
    { ...env, ASSETS: {} } as any,
  );
  assert.equal(r.status, 200);
  assert.match(
    r.headers.get("Content-Security-Policy")!,
    /frame-ancestors 'none'/,
  );
  assert.equal(r.headers.get("Cache-Control"), "private, no-store");
});
test("リモート MCP も Access の JWT が無い・不正なら閉じ（許可外は上の経路一覧で確かめる）、ローカル専用の鍵は https の本番・dev では全ルート 503", async () => {
  const worker = createWorker();
  const mcpEnv = {
    ...env,
    TEAM_NOTES_ENABLED: "true",
    TEAM_NOTES_MCP_ENABLED: "true",
    TEAM_NOTES: {
      getByName: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
    ASSETS: { fetch: async () => new Response("private") },
  } as any;
  const post = (jwt?: string, base = "https://board.example") =>
    new Request(base + "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
  const devKeys = JSON.stringify({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" }],
  });
  // https の APP_ORIGIN（本番・dev の workers.dev）に開発用の鍵が置かれていたら、署名が正しくても閉じる。
  for (const jwt of [undefined, await token()]) {
    const response = await worker.fetch(post(jwt), {
      ...mcpEnv,
      ACCESS_DEV_JWKS: devKeys,
    });
    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as any).error,
      "dev_keys_not_allowed",
    );
  }
  // localhost の wrangler dev だけ、試験用の鍵で署名した JWT を同じ検証（issuer・audience・許可一覧）に通す。
  const local = {
    ...mcpEnv,
    APP_ORIGIN: "http://localhost:8787",
    ACCESS_DEV_JWKS: devKeys,
  };
  const at = "http://localhost:8787";
  assert.equal((await worker.fetch(post(undefined, at), local)).status, 401);
  assert.equal(
    (await worker.fetch(post("fake.fake.fake", at), local)).status,
    401,
  );
  assert.equal(
    (await worker.fetch(post(await token(), at), local)).status,
    200,
  );
  // 別の鍵で署名した JWT は、開発用の鍵があっても通らない。
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ email: env.ALLOWED_EMAILS })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("member")
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("board")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(other.privateKey);
  assert.equal((await worker.fetch(post(forged, at), local)).status, 401);
});

// CI の本番スモーク用の Access service token（runbook 4.3）。漏れても読み取りしかできないことが契約。
async function serviceToken(commonName: string) {
  return new SignJWT({ common_name: commonName })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("")
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("board")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}
const serviceEnv = { ...env, ACCESS_SERVICE_TOKEN_CLIENT_ID: "ci.access" };
test("service token は登録済みの Client ID だけ通り、email も common_name も無い JWT は 401", async () => {
  const principal = await authenticate(
    req("/", await serviceToken("ci.access")),
    serviceEnv,
    jwks,
  );
  assert.equal(principal.id, "service:ci-smoke");
  await assert.rejects(
    authenticate(req("/", await serviceToken("other.access")), serviceEnv, jwks),
    { status: 403 },
  );
  // Client ID の登録が無ければ、どの service token も通さない。
  await assert.rejects(
    authenticate(req("/", await serviceToken("ci.access")), env, jwks),
    { status: 403 },
  );
  const bare = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject("member")
    .setIssuer("https://team.cloudflareaccess.com")
    .setAudience("board")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);
  await assert.rejects(authenticate(req("/", bare), serviceEnv, jwks), {
    status: 401,
  });
  // 署名・audience の検証は人と同じ。
  await assert.rejects(
    authenticate(
      req("/", await serviceToken("ci.access")),
      { ...serviceEnv, ACCESS_AUD: "other" },
      jwks,
    ),
    { status: 401 },
  );
});

test("service token の主体はスモークが読む経路と静的ファイルの GET だけ。書き込み・付箋・MCP は 403", async () => {
  let apiCalls = 0;
  const worker = createWorker(
    async () => ({ id: "service:ci-smoke", email: "", service: true as const }),
    async (request: Request) => {
      if (!new URL(request.url).pathname.startsWith("/api/")) return null;
      apiCalls++;
      return Response.json({ ok: true });
    },
  );
  const workerEnv = {
    ...serviceEnv,
    TEAM_NOTES_ENABLED: "true",
    TEAM_NOTES_MCP_ENABLED: "true",
    ASSETS: { fetch: async () => new Response("asset") },
  } as any;
  const call = (path: string, method = "GET") =>
    worker.fetch(
      new Request("https://board.example" + path, {
        method,
        headers: { Origin: "https://board.example", "content-type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      }),
      workerEnv,
    );
  for (const path of ["/api/health", "/api/current-sprint", "/", "/app.js"])
    assert.equal((await call(path)).status, 200, path);
  for (const [path, method] of [
    ["/api/board", "GET"],
    ["/api/team-notes", "GET"],
    ["/api/team-notes", "POST"],
    ["/api/issues/2", "POST"],
    ["/api/burndown/schedule", "POST"],
    ["/mcp", "POST"],
  ]) {
    const response = await call(path, method);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.equal(((await response.json()) as any).error, "service_token_read_only");
  }
  assert.equal(apiCalls, 2);
});

test("チームモードの旧 public path は、認証の後に GET だけルートへ 308 で転送し、POST は 404", async () => {
  const legacy = "/b/" + "c".repeat(48);
  let authCalls = 0;
  const worker = createWorker(async () => {
    authCalls++;
    return { id: "member", email: "member@example.com" };
  });
  const workerEnv = {
    ...env,
    LEGACY_PUBLIC_PATH: legacy,
    ASSETS: { fetch: async () => new Response("asset") },
  } as any;
  const get = await worker.fetch(
    new Request("https://board.example" + legacy + "/app.js?v=1"),
    workerEnv,
  );
  assert.equal(get.status, 308);
  assert.equal(get.headers.get("location"), "https://board.example/app.js?v=1");
  const bare = await worker.fetch(
    new Request("https://board.example" + legacy),
    workerEnv,
  );
  assert.equal(bare.headers.get("location"), "https://board.example/");
  const post = await worker.fetch(
    new Request("https://board.example" + legacy + "/api/issues/2", {
      method: "POST",
      headers: { Origin: "https://board.example" },
      body: "{}",
    }),
    workerEnv,
  );
  assert.equal(post.status, 404);
  assert.equal(authCalls, 3);
  // 未認証なら転送より先に認証で止まる（転送が認証を迂回しない）。
  const guarded = createWorker(async () => {
    throw new (await import("../worker/auth.ts")).AccessError(401, "sign_in_required");
  });
  assert.equal(
    (await guarded.fetch(new Request("https://board.example" + legacy + "/"), workerEnv)).status,
    401,
  );
});
