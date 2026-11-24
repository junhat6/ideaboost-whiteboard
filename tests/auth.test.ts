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
