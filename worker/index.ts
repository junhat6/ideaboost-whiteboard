import { authenticate, AccessError, type AuthConfig } from "./auth";
import { handleApi, githubWritesDisabled } from "../server/github.mjs";
import { handleMcp, MCP_BODY_MAX } from "./mcp";
export interface Env extends AuthConfig {
  ASSETS: Fetcher;
  AUTH_MODE?: string;
  PUBLIC_PATH?: string;
  /**
   * チームモードへの移行期間だけ置く、旧 public-temporary の path（`/b/<48桁の16進>`）。
   * 置かれていれば、その下への GET/HEAD をルートの同じ相対位置へ 308 で転送する（runbook 5 章）。
   * POST は転送しない（本文ごとの自動再送をしない）。移行が終わったら外す。
   */
  LEGACY_PUBLIC_PATH?: string;
  PUBLIC_LIMITER?: RateLimit;
  MUTATIONS?: DurableObjectNamespace;
  HISTORY?: DurableObjectNamespace;
  TEAM_NOTES?: DurableObjectNamespace;
  /** "true" のときだけ /api/team-notes を開く。未設定・それ以外は存在しない経路として 404。 */
  TEAM_NOTES_ENABLED?: string;
  /** "true" かつ付箋も有効、かつチームモード（ログイン必須）のときだけ /mcp（リモート MCP）を開く。 */
  TEAM_NOTES_MCP_ENABLED?: string;
  /** MCP 経由の書き込みの、利用者ごとのレート制限。無ければ MCP の書き込みは閉じる。 */
  MCP_LIMITER?: RateLimit;
  /** 付箋からの Issue 作成の上限（ADR 019）。無ければ作成は閉じる（503）。 */
  NOTE_ISSUE_LIMITER?: RateLimit;
  /** 未設定（本番）だけ GitHub へ書ける。dev は "disabled"。"enabled" 以外の値は全て書き込みを止める。 */
  GITHUB_WRITES?: string;
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
/**
 * application/json と text/event-stream の両方を明示した、という MCP の Accept。
 * `*\/*` だけの要求は通さない（SDK も 406 にする。Worker で先に同じ 406 を返し、拒否の形をそろえる）。
 */
function acceptsMcp(accept: string) {
  const types = accept
    .toLowerCase()
    .split(",")
    .map((t) => t.split(";")[0].trim());
  return (
    types.includes("application/json") && types.includes("text/event-stream")
  );
}
/**
 * リモート MCP（ADR 016 の M2）。認証（チームモードの Access の JWT）を通った要求だけが来る。
 * MCP クライアントはボードの Origin を送らないので、POST の Origin 一致の代わりに、
 * ブラウザの単純リクエストでは作れないヘッダー（JSON の Content-Type・MCP の Accept）を必須にし、
 * CORS を一切許可しない。他サイトの Origin が付いた要求は、MCP 仕様（DNS rebinding 対策）どおり 403。
 */
async function routeMcp(request: Request, env: Env, user: { id: string }) {
  // 匿名の MCP は作らない。付箋か MCP のどちらかが無効なら、存在しない経路と同じ 404。
  if (
    env.AUTH_MODE === "public-temporary" ||
    env.TEAM_NOTES_ENABLED !== "true" ||
    env.TEAM_NOTES_MCP_ENABLED !== "true"
  )
    throw new AccessError(404, "not_found");
  if (request.method !== "POST")
    // 状態なしの MCP なので GET（SSE の待ち受け）・DELETE も使わない。OPTIONS にも CORS の許可を返さない。
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const origin = request.headers.get("Origin");
  if (
    (origin !== null && origin !== env.APP_ORIGIN) ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  )
    throw new AccessError(403, "origin_mismatch");
  if (
    !/^application\/json(?:;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new AccessError(415, "json_required");
  if (!acceptsMcp(request.headers.get("accept") ?? ""))
    throw new AccessError(406, "mcp_accept_required");
  if (new URL(request.url).search) throw new AccessError(400, "invalid_query");
  if (Number(request.headers.get("content-length") ?? 0) > MCP_BODY_MAX)
    throw new AccessError(413, "body_too_large");
  if (!env.TEAM_NOTES) throw new AccessError(503, "team_notes_not_configured");
  // JSON-RPC の batch（配列の本文）は受け付けない。2025-06-18 以降の MCP 仕様に batch は無く、
  // 2025 版の経路（SDK の legacy）で受けると、1 回の要求で道具を何十回も呼べてしまう
  // （制限の無い notes_list を並べれば DO の全件読みが重なる）。1 要求 1 メッセージに限る。
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MCP_BODY_MAX)
    throw new AccessError(413, "body_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 構文の誤りは SDK が JSON-RPC の parse error として返す。
  }
  if (Array.isArray(parsed))
    throw new AccessError(400, "mcp_batch_not_supported");
  const notes = env.TEAM_NOTES.getByName(
    "engineer-first/idea-boost:team-notes",
  );
  const response = await handleMcp(new Request(request, { body }), {
    notes,
    limiter: env.MCP_LIMITER,
    user,
  });
  // SDK が何を付けても、CORS の許可はブラウザへ返さない。
  const headers = new Headers(response.headers);
  const cors: string[] = [];
  headers.forEach((_, key) => {
    if (key.toLowerCase().startsWith("access-control-")) cors.push(key);
  });
  for (const key of cors) headers.delete(key);
  return new Response(response.body, { status: response.status, headers });
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
          // 無効な付箋の経路は DO も GitHub も呼ばず 404 で終わる。画面が読み込みごとに
          // 1 回確かめるだけなので、共有の public-read 枠を使わせない。
          const disabledTeamNotes =
            url.pathname === "/api/team-notes" &&
            env.TEAM_NOTES_ENABLED !== "true";
          if (url.pathname.startsWith("/api/") && !disabledTeamNotes) {
            if (!env.PUBLIC_LIMITER)
              throw new AccessError(503, "rate_limit_not_configured");
            // Approximate per-location limit; shared key prevents easy evasion by client identity spoofing.
            if (
              !(
                await env.PUBLIC_LIMITER.limit({
                  // 付箋は棚が 30 秒ごとに読み直すため、ボードの読み書きと別の共有 key にする。
                  // 同じ key だと、数人が棚を開いているだけでボードの読み取りが 429 になる。
                  // 付箋の Issue 化（/api/team-notes/<id>/issue）は GitHub への書き込みなので、
                  // 付箋の枠ではなく Issue の編集と同じ public-write の枠を使う。
                  key:
                    (url.pathname === "/api/team-notes"
                      ? "public-notes-"
                      : "public-") +
                    (request.method === "POST" ? "write" : "read"),
                })
              ).success
            )
              throw new AccessError(429, "rate_limited");
          }
          // Public is deliberately anonymous. This is a routing principal, never a verified person.
          user = { id: "public-anonymous", email: "" };
        } else {
          user = await auth(request, env);
          const url = new URL(request.url);
          // 旧 public path の転送（移行期間だけ）。認証の後に行うので、転送が認証を迂回する入口にならない。
          // 転送先は同じ origin のルート配下の同じ相対 path に限る（open redirect を作らない）。
          const legacy = env.LEGACY_PUBLIC_PATH;
          if (
            legacy &&
            /^\/b\/[a-f0-9]{48}$/.test(legacy) &&
            (url.pathname === legacy || url.pathname.startsWith(legacy + "/"))
          ) {
            if (request.method !== "GET" && request.method !== "HEAD")
              throw new AccessError(404, "not_found");
            const rest = url.pathname.slice(legacy.length) || "/";
            return secure(
              Response.redirect(url.origin + rest + url.search, 308),
            );
          }
          // CI の service token は読み取り専用。スモークが読む経路と静的ファイルの GET/HEAD だけ。
          // 漏れても実 Issue・付箋・MCP には書けない（runbook 4.3）。
          if ("service" in user && user.service) {
            const readable =
              ["/api/health", "/api/current-sprint", "/api/burndown"].includes(
                url.pathname,
              ) ||
              (!url.pathname.startsWith("/api/") && url.pathname !== "/mcp");
            if (
              !readable ||
              (request.method !== "GET" && request.method !== "HEAD")
            )
              throw new AccessError(403, "service_token_read_only");
          }
        }
        if (new URL(request.url).pathname === "/mcp")
          return secure(await routeMcp(request, env, user));
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
        // 付箋の書き手の種別（ai）は Worker の内部の入口（M2 の MCP）だけが付ける。
        // ブラウザから届いた同名ヘッダーは消し、AI を名乗っても権限が増えないようにする。
        headers.delete("x-team-notes-actor");
        headers.set("x-verified-user-id", user.id);
        const internal = new Request(request, { headers });
        if (
          ["/api/burndown", "/api/burndown/schedule"].includes(
            new URL(request.url).pathname,
          )
        ) {
          const settings = new URL(request.url).pathname.endsWith("/schedule");
          if (request.method !== (settings ? "POST" : "GET"))
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
          // dev から実チームの Issue へ書かせない。DO の queue・記録にも入れずに止める。
          if (githubWritesDisabled(env))
            throw new AccessError(403, "github_writes_disabled");
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
        const noteIssue = new URL(request.url).pathname.match(
          /^\/api\/team-notes\/(n_[a-z0-9]{8,32})\/issue$/,
        );
        if (noteIssue) {
          // 付箋の Issue 化（ADR 019）。付箋が無効なら存在しない経路と同じ 404。
          if (env.TEAM_NOTES_ENABLED !== "true")
            throw new AccessError(404, "not_found");
          if (request.method !== "POST")
            throw new AccessError(405, "method_not_allowed");
          if (githubWritesDisabled(env))
            throw new AccessError(403, "github_writes_disabled");
          if (!env.MUTATIONS)
            throw new AccessError(503, "mutation_coordinator_not_configured");
          // 実 Issue は画面から消せないので、編集の枠とは別の低い枠で数える。public-temporary では
          // 匿名全体を 1 つの key にまとめる（利用者を名乗り替えて枠を増やせないように）。
          if (!env.NOTE_ISSUE_LIMITER)
            throw new AccessError(503, "rate_limit_not_configured");
          if (
            !(
              await env.NOTE_ISSUE_LIMITER.limit({
                key:
                  env.AUTH_MODE === "public-temporary"
                    ? "public-note-issue"
                    : "note-issue:" + user.id,
              })
            ).success
          )
            throw new AccessError(429, "rate_limited");
          // 付箋ごとの DO で直列化し、requestId と「この付箋の Issue」を記録する。
          const coordinator = env.MUTATIONS.getByName(
            `engineer-first/idea-boost:note-issue:${noteIssue[1]}`,
          );
          try {
            return secure(await coordinator.fetch(internal));
          } catch {
            // 転送で失敗しても Issue はできているかもしれない。再送を促さない。
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
        if (new URL(request.url).pathname === "/api/team-notes") {
          // ログイン必須化（#10）までは本番で匿名に書かせない。無効時は DO へ転送せず、
          // 問い合わせ文字列の検査より先に、存在しない経路と同じ 404 を返す。
          if (env.TEAM_NOTES_ENABLED !== "true")
            throw new AccessError(404, "not_found");
          if (new URL(request.url).search)
            throw new AccessError(400, "invalid_query");
          if (!env.TEAM_NOTES)
            throw new AccessError(503, "team_notes_not_configured");
          const notes = env.TEAM_NOTES.getByName(
            "engineer-first/idea-boost:team-notes",
          );
          let forward = internal;
          if (request.method === "POST") {
            // 付箋に Issue を結び付ける op は、その付箋から実際に作った Issue（付箋ごとの DO の受領）だけ通す。
            // 任意の番号を結び付けて、その付箋から二度と作れなくすることを防ぐ（ADR 019）。
            const text = await internal.text();
            let data: { op?: unknown; id?: unknown; number?: unknown } | null =
              null;
            try {
              data = text.length <= 16000 ? JSON.parse(text) : null;
            } catch {
              /* 形の誤りは DO が 400 で返す */
            }
            if (data?.op === "issue") {
              if (
                typeof data.id !== "string" ||
                !/^n_[a-z0-9]{8,32}$/.test(data.id)
              )
                throw new AccessError(400, "invalid_issue");
              if (!env.MUTATIONS)
                throw new AccessError(
                  503,
                  "mutation_coordinator_not_configured",
                );
              const receipt = await env.MUTATIONS.getByName(
                `engineer-first/idea-boost:note-issue:${data.id}`,
              ).fetch(new Request("https://internal/internal/note-issued"));
              const issued = receipt.ok
                ? ((await receipt.json()) as { issued?: { number?: number } })
                    .issued
                : null;
              if (!issued || issued.number !== data.number)
                throw new AccessError(409, "issue_not_from_note");
            }
            forward = new Request(internal, { body: text });
            // 読み直した本文の長さは元の Content-Length と違うことがある。転送では付け直させる。
            forward.headers.delete("content-length");
          }
          try {
            return secure(await notes.fetch(forward));
          } catch {
            // 転送で失敗しても、DO 側で書き込みが済んでいる可能性がある。再送を促さない。
            return secure(
              Response.json(
                {
                  ok: false,
                  error:
                    request.method === "POST"
                      ? "notes_outcome_unresolved"
                      : "service_unavailable",
                  ambiguous: request.method === "POST",
                },
                { status: 503 },
              ),
            );
          }
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
