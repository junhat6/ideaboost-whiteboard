import { authenticate, AccessError, type AuthConfig } from "./auth";
import { handleApi } from "../server/github.mjs";
export interface Env extends AuthConfig {
  ASSETS: Fetcher;
  MUTATIONS?: DurableObjectNamespace;
  GITHUB_APP_ID?: string;
  GITHUB_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
}
function secure(response: Response) {
  const r = new Response(response.body, response);
  r.headers.set("Cache-Control", "private, no-store");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  r.headers.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  return r;
}
export function createWorker(auth = authenticate, api = handleApi) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      try {
        const user = await auth(request, env);
        if (!["GET", "HEAD", "POST"].includes(request.method))
          return secure(new Response(null, { status: 405 }));
        if (
          request.method === "POST" &&
          (request.headers.get("Origin") !== env.APP_ORIGIN ||
            request.headers.get("Sec-Fetch-Site") === "cross-site")
        ) {
          throw new AccessError(403, "origin_mismatch");
        }
        // Remove client identity headers; the API receives only the cryptographically verified subject.
        const headers = new Headers(request.headers);
        headers.delete("oai-authenticated-user-id");
        headers.set("x-verified-user-id", user.id);
        const internal = new Request(request, { headers });
        const issue = new URL(request.url).pathname.match(
          /^\/api\/issues\/([1-9]\d{0,8})$/,
        );
        if (request.method === "POST" && issue) {
          if (!env.MUTATIONS)
            throw new AccessError(503, "mutation_coordinator_not_configured");
          const coordinator = env.MUTATIONS.getByName(
            `engineer-first/idea-boost:${issue[1]}`,
          );
          return secure(await coordinator.fetch(internal));
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
