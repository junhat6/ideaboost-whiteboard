import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

export interface AuthConfig {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  APP_ORIGIN?: string;
  /**
   * ローカルの `wrangler dev` 専用。Access の公開鍵の代わりに使う JWKS（JSON）。
   * 試験用の鍵で署名した JWT で、認証そのもの（署名・issuer・audience・許可一覧）を通して確かめるため。
   * APP_ORIGIN が http://localhost か http://127.0.0.1 のときだけ使え、それ以外で置かれていたら全ルート 503。
   */
  ACCESS_DEV_JWKS?: string;
}
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d{1,5}$/;
const keySets = new Map<string, JWTVerifyGetKey>();
export class AccessError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function authenticate(
  request: Request,
  env: AuthConfig,
  getKey?: JWTVerifyGetKey,
) {
  const domain = env.ACCESS_TEAM_DOMAIN;
  const allowed = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    !domain ||
    !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) ||
    !env.ACCESS_AUD ||
    !env.APP_ORIGIN ||
    !allowed.length
  ) {
    throw new AccessError(503, "access_not_configured");
  }
  // 開発用の鍵は本番・dev（https の workers.dev）では使えない。誤って置かれたら全ルートを閉じる。
  if (env.ACCESS_DEV_JWKS !== undefined && !LOCAL_ORIGIN.test(env.APP_ORIGIN))
    throw new AccessError(503, "dev_keys_not_allowed");
  if (new URL(request.url).origin !== env.APP_ORIGIN)
    throw new AccessError(403, "hostname_not_allowed");
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.length > 16000)
    throw new AccessError(401, "sign_in_required");
  const issuer = `https://${domain}`;
  if (!getKey && env.ACCESS_DEV_JWKS !== undefined) {
    try {
      getKey = createLocalJWKSet(
        JSON.parse(env.ACCESS_DEV_JWKS) as JSONWebKeySet,
      );
    } catch {
      throw new AccessError(503, "access_not_configured");
    }
  }
  if (!getKey) {
    if (!keySets.has(issuer))
      keySets.set(
        issuer,
        createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
      );
    getKey = keySets.get(issuer)!;
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, getKey, {
      issuer,
      audience: env.ACCESS_AUD,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "email", "iat", "exp"],
      clockTolerance: 5,
    }));
  } catch {
    throw new AccessError(401, "invalid_access_token");
  }
  if (
    typeof payload.email !== "string" ||
    typeof payload.sub !== "string" ||
    !allowed.includes(payload.email.toLowerCase())
  ) {
    throw new AccessError(403, "member_not_allowed");
  }
  return { id: payload.sub, email: payload.email.toLowerCase() };
}
