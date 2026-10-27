import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const repository = "junhat6/ideaboost-whiteboard";
const account = "29a0469ba7d11f29ac94e3ed41f388a8";
const host = "ideaboost-whiteboard.ideaboost-whiteboard.workers.dev";
const assets = [
  "index.html",
  "app.js",
  "api-adapter.js",
  "burndown.js",
  "styles.css",
  "editor-bundle.js",
  "diagram-worker.js",
  "icons.js",
  "ui-tools.js",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export function productionBase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Production URL is not configured");
  }
  if (
    url.protocol !== "https:" ||
    url.host !== host ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/b\/[a-f0-9]{48}\/$/.test(url.pathname)
  )
    throw new Error("Production URL does not match the approved Worker path");
  return url;
}
export function trustedPush(env, checkoutSha) {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "") ||
    checkoutSha !== env.GITHUB_SHA
  )
    throw new Error("Only the checked main push commit can be deployed");
  if (env.CLOUDFLARE_ACCOUNT_ID !== account)
    throw new Error("Cloudflare account does not match the approved account");
  productionBase(env.PRODUCTION_BASE_URL);
}
export async function currentMain(sha, token, fetcher = fetch) {
  if (!token) throw new Error("GitHub read-only job token is missing");
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/git/ref/heads/main`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok || (await response.json()).object?.sha !== sha)
    throw new Error(
      "main changed or could not be verified; deployment stopped",
    );
}
export async function verifyDeployment(base, expectedAssets, fetcher = fetch) {
  const get = (path) =>
    fetcher(new URL(path, productionBase(base)), {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  const response = await get("api/health");
  if (!response.ok) throw new Error("Production health request failed");
  const health = await response.json();
  if (
    health.configured !== true ||
    health.mode !== "github" ||
    health.accessMode !== "public-temporary" ||
    health.storyPoints !== true
  )
    throw new Error(
      "Production runtime settings are not the approved settings",
    );
  for (const [name, expected] of expectedAssets) {
    const remote = await get(name === "index.html" ? "" : name);
    if (
      !remote.ok ||
      sha256(Buffer.from(await remote.arrayBuffer())) !== sha256(expected)
    )
      throw new Error(`Production asset does not match this commit: ${name}`);
  }
}
async function main() {
  if (process.argv[2] === "guard") {
    trustedPush(
      process.env,
      execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    );
    await currentMain(process.env.GITHUB_SHA, process.env.GITHUB_TOKEN);
    console.log(
      "Checked main commit and approved production destination verified",
    );
    return;
  }
  if (process.argv[2] !== "smoke") throw new Error("Use guard or smoke");
  const base = productionBase(process.env.PRODUCTION_BASE_URL).href;
  const expected = await Promise.all(
    assets.map(async (name) => [
      name,
      await readFile(new URL(`../web/${name}`, import.meta.url)),
    ]),
  );
  const deadline = Date.now() + 180000;
  while (true) {
    try {
      await verifyDeployment(base, expected);
      console.log(
        "Production health and all 9 assets match; no mutation requests sent",
      );
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(10000);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
