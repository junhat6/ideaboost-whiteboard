// dev 環境（ADR 017）の契約: 本番と別 Worker・付箋有効・実 Issue へ書かない・匿名で開かない。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorker } from "../worker/index.ts";
import { AccessError } from "../worker/auth.ts";

/** コメントと末尾カンマを外して JSONC を読む（文字列中の // は残す）。 */
function readJsonc(path: string) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8");
  let out = "";
  for (let i = 0, inString = false; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") out += src[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}
const config = readJsonc("../wrangler.jsonc");
const dev = config.env.dev;

test("dev は本番と別の Worker で、付箋を開き、GitHub の資格・公開モードを持たない", () => {
  assert.notEqual(dev.name, config.name);
  assert.equal(dev.vars.TEAM_NOTES_ENABLED, "true");
  assert.equal(dev.vars.GITHUB_WRITES, "disabled");
  // 本番の GitHub App・公開 path を写さない。読み取りもしない（GitHub 未設定で 503）。
  for (const key of [
    "GITHUB_APP_ID",
    "GITHUB_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "AUTH_MODE",
    "PUBLIC_PATH",
  ])
    assert.equal(key in dev.vars, false, key);
  // 匿名公開の rate limit を持たない → public-temporary にしても API は閉じる。
  assert.equal(dev.ratelimits, undefined);
  assert.equal(dev.routes ?? dev.route, undefined);
  // 付箋の DO も dev 側に宣言する（env へは継承されない）。
  assert.ok(
    dev.durable_objects.bindings.some(
      (b: { name: string }) => b.name === "TEAM_NOTES",
    ),
  );
  // 本番は従来どおり。付箋無効・GitHub へ書ける。
  assert.equal(config.vars.TEAM_NOTES_ENABLED, "false");
  assert.equal("GITHUB_WRITES" in config.vars, false);
});

const origin = "https://dev.example";
const devEnv = (extra: object = {}) =>
  ({
    ...dev.vars,
    APP_ORIGIN: origin,
    ASSETS: { fetch: async () => new Response("asset") },
    ...extra,
  }) as any;
const request = (path: string, method = "GET") =>
  new Request(origin + path, {
    method,
    headers: { Origin: origin, "content-type": "application/json" },
    body: method === "POST" ? "{}" : undefined,
  });
const member = async () => ({ id: "member-sub", email: "" });

test("dev の Worker は付箋を通し、Issue の変更は DO にも入れずに 403 で止める", async () => {
  const forwarded: string[] = [];
  const ns = (label: string) => ({
    getByName: () => ({
      fetch: async () => {
        forwarded.push(label);
        return Response.json({ ok: true, notes: [] });
      },
    }),
  });
  const env = devEnv({
    TEAM_NOTES: ns("notes"),
    MUTATIONS: ns("mutations"),
  });
  const worker = createWorker(member);
  assert.equal(
    (await worker.fetch(request("/api/team-notes"), env)).status,
    200,
  );
  for (const path of ["/api/issues/2", "/api/issues/2/comments"]) {
    const r = await worker.fetch(request(path, "POST"), env);
    assert.equal(r.status, 403, path);
    assert.equal(((await r.json()) as any).error, "github_writes_disabled");
  }
  assert.deepEqual(forwarded, ["notes"]);
});

test("Access 未設定の dev は全ルートで閉じ、public-temporary にしても匿名で書けない", async () => {
  let forwarded = 0;
  const notes = {
    getByName: () => ({
      fetch: async () => {
        forwarded++;
        return Response.json({ ok: true });
      },
    }),
  };
  // 実際の authenticate を使う。ACCESS_* が無いので 503 access_not_configured。
  const worker = createWorker();
  for (const [path, method] of [
    ["/", "GET"],
    ["/api/team-notes", "GET"],
    ["/api/team-notes", "POST"],
  ]) {
    const r = await worker.fetch(
      request(path, method),
      devEnv({ TEAM_NOTES: notes }),
    );
    assert.equal(r.status, 503, path);
    assert.equal(((await r.json()) as any).error, "access_not_configured");
  }
  // 誤って public-temporary にしても、dev には PUBLIC_LIMITER が無いので API は 503。
  const publicPath = "/b/" + "c".repeat(48);
  const r = await createWorker(async () => {
    throw new AccessError(500, "must_not_authenticate");
  }).fetch(
    request(publicPath + "/api/team-notes", "POST"),
    devEnv({
      TEAM_NOTES: notes,
      AUTH_MODE: "public-temporary",
      PUBLIC_PATH: publicPath,
    }),
  );
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as any).error, "rate_limit_not_configured");
  assert.equal(forwarded, 0);
});
