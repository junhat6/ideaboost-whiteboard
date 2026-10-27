import { authenticate, AccessError, type AuthConfig } from "./auth";
import { handleApi } from "../server/github.mjs";
export interface Env extends AuthConfig {
  ASSETS: Fetcher;
  AUTH_MODE?: string;
  PUBLIC_PATH?: string;
  PUBLIC_LIMITER?: RateLimit;
  MUTATIONS?: DurableObjectNamespace;
  HISTORY?: DurableObjectNamespace;
  ESTIMATE_HOURS_READ_ENABLED?: string;
  ESTIMATE_HOURS_FIELD_ID?: string;
  ESTIMATE_HOURS_NODE_ID?: string;
  ESTIMATE_HOURS_PROJECT_FIELD_ID?: string;
  STORY_POINTS_READ_ENABLED?: string;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}
function secure(response: Response) {
  const r = new Response(response.body, response);
  r.headers.set("Cache-Control", "private, no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  r.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com https://github.com/user-attachments/ https://user-images.githubusercontent.com https://github-production-user-asset-6210df.s3.amazonaws.com; media-src https://github.com/user-attachments/ https://user-images.githubusercontent.com https://github-production-user-asset-6210df.s3.amazonaws.com; connect-src 'self'; worker-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return r;
}
export function createWorker(auth = authenticate, api = handleApi) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        let user;
        if (env.AUTH_MODE === "public-temporary") {
          const url = new URL(request.url);
          if (
            !env.APP_ORIGIN ||
            !env.PUBLIC_PATH ||
            !/^\/b\/[a-f0-9]{48}$/.test(env.PUBLIC_PATH)
          )
            throw new AccessError(503, "public_mode_not_configured");
          if (url.origin !== env.APP_ORIGIN)
            throw new AccessError(403, "hostname_not_allowed");
          if (url.pathname === env.PUBLIC_PATH && request.method === "GET")
            return secure(
              Response.redirect(url.origin + env.PUBLIC_PATH + "/", 308),
            );
          if (!url.pathname.startsWith(env.PUBLIC_PATH + "/"))
            throw new AccessError(404, "not_found");
          url.pathname = url.pathname.slice(env.PUBLIC_PATH.length);
          request = new Request(url, request);
          if (url.pathname.startsWith("/api/")) {
            if (!env.PUBLIC_LIMITER)
              throw new AccessError(503, "rate_limit_not_configured");
            // Approximate per-location limit; shared key prevents easy evasion by client identity spoofing.
            if (
              !(
                await env.PUBLIC_LIMITER.limit({
                  key:
                    request.method === "POST" ? "public-write" : "public-read",
                })
              ).success
            )
              throw new AccessError(429, "rate_limited");
          }
          // Public is deliberately anonymous. This is a routing principal, never a verified person.
          user = { id: "public-anonymous", email: "" };
        } else {
          user = await auth(request, env);
        }
        if (!["GET", "HEAD", "POST"].includes(request.method))
          return secure(new Response(null, { status: 405 }));
        if (
          request.method === "POST" &&
          (request.headers.get("Origin") !== env.APP_ORIGIN ||
            request.headers.get("Sec-Fetch-Site") === "cross-site")
        ) {
          throw new AccessError(403, "origin_mismatch");
        }
        // Remove client identity headers. Public mode uses one explicit anonymous principal.
        const headers = new Headers(request.headers);
        headers.delete("oai-authenticated-user-id");
        headers.set("x-verified-user-id", user.id);
        const internal = new Request(request, { headers });
        if (new URL(request.url).pathname === "/api/burndown") {
          if (request.method !== "GET")
            throw new AccessError(405, "method_not_allowed");
          const params = new URL(request.url).searchParams;
          let invalidKey = false;
          params.forEach((_, key) => {
            if (key !== "milestone") invalidKey = true;
          });
          if (invalidKey || params.getAll("milestone").length > 1)
            throw new AccessError(400, "invalid_query");
          if (!env.HISTORY || env.ESTIMATE_HOURS_READ_ENABLED !== "true")
            throw new AccessError(503, "estimate_hours_unavailable");
          return secure(
            await env.HISTORY.getByName(
              "engineer-first/idea-boost:observations-v1",
            ).fetch(internal),
          );
        }
        const issue = new URL(request.url).pathname.match(
          /^\/api\/issues\/([1-9]\d{0,8})(?:\/comments)?$/,
        );
        if (request.method === "POST" && issue) {
          if (!env.MUTATIONS)
            throw new AccessError(503, "mutation_coordinator_not_configured");
          const coordinator = env.MUTATIONS.getByName(
            `engineer-first/idea-boost:${issue[1]}`,
          );
          try {
            return secure(await coordinator.fetch(internal));
          } catch {
            // Dispatch may have committed remotely before transport failed. Never imply a safe retry.
            return secure(
              Response.json(
                {
                  ok: false,
                  error: "mutation_outcome_unresolved",
                  ambiguous: true,
                },
                { status: 503 },
              ),
            );
          }
        }
        if (
          request.method === "GET" &&
          new URL(request.url).pathname === "/api/board" &&
          env.MUTATIONS
        ) {
          return secure(
            await env.MUTATIONS.getByName(
              "engineer-first/idea-boost:board-reader",
            ).fetch(internal),
          );
        }
        const result = await api(internal, env);
        if (result) return secure(result);
        if (request.method === "POST")
          return secure(new Response(null, { status: 405 }));
        return secure(await env.ASSETS.fetch(request));
      } catch (error) {
        const status = error instanceof AccessError ? error.status : 503;
        const code =
          error instanceof AccessError ? error.code : "service_unavailable";
        return secure(Response.json({ ok: false, error: code }, { status }));
      }
    },
  };
}
export default createWorker();
