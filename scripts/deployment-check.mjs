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
  "school-calendar.js",
  "toolbar-select.js",
  "page-navigation.js",
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
export async function inspectCurrentSprint(base, fetcher = fetch) {
  const url = new URL("api/current-sprint", productionBase(base));
  let response;
  try {
    response = await fetcher(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("Current sprint read failed");
  }
  if (response.status !== 200)
    throw new Error(`Current sprint read failed (HTTP ${response.status})`);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Current sprint response was not valid JSON");
  }
  const timestamp = (value) =>
      typeof value === "string" &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    midnightJst = (value) =>
      timestamp(value) && (Date.parse(value) + 9 * 3600000) % 86400000 === 0,
    current = data?.currentSprint,
    validStatus =
      data?.ok === true &&
      ["current", "none", "unavailable"].includes(data.status);
  if (
    !validStatus ||
    !timestamp(data.checkedAt) ||
    (data.status === "current"
      ? !Number.isSafeInteger(current?.number) ||
        current.number <= 0 ||
        current.title !== `Sprint ${current.number}` ||
        current.policy !== "sprint-v2-exclusive-jst" ||
        !midnightJst(current.startAt) ||
        Date.parse(current.startAt) > Date.parse(data.checkedAt) ||
        (current.endAt !== null &&
          (!midnightJst(current.endAt) ||
            Date.parse(current.endAt) <= Date.parse(current.startAt) ||
            Date.parse(current.endAt) <= Date.parse(data.checkedAt)))
      : current !== null)
  )
    throw new Error("Current sprint response contract did not match");
  // No raw response, error text, title, Issue data, URLs or credentials in output.
  return {
    status: data.status,
    milestone: current?.number ?? null,
    startAt: current?.startAt ?? null,
    endAt: current?.endAt ?? null,
    policy: current?.policy ?? null,
    checkedAt: data.checkedAt,
  };
}
// Exercise the deployed history/DO read path without pinning a historical Sprint
// or a mutable hours total. No retries, credentials, redirects or raw-data logs.
export async function inspectCurrentHistory(base, current, fetcher = fetch) {
  if (current.status !== "current")
    return { checked: false, reason: "no_current_sprint" };
  const url = new URL(`api/burndown?milestone=${current.milestone}`, productionBase(base));
  let response;
  try {
    response = await fetcher(url, {
      method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("Current history read failed");
  }
  if (!response.ok)
    throw new Error(`Current history read failed (HTTP ${response.status})`);
  const data = await response.json().catch(() => {
    throw new Error("Current history response was not valid JSON");
  });
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const summary = (value) => value &&
    ["estimated", "unestimated", "total", "cancelled", "excludedChildren"].every((key) => count(value[key])) &&
    value.estimated + value.unestimated === value.total &&
    Number.isFinite(value.estimatedHours) && Number.isFinite(value.remainingHours) &&
    value.remainingHours >= 0 && value.estimatedHours >= value.remainingHours;
  const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (data?.ok !== true || data.milestone !== current.milestone ||
      !timestamp(data.observedAt) || !summary(data.current) ||
      !["live", "historical"].includes(data.display?.mode) ||
      (data.display.summary === null
        ? data.display.mode !== "historical" || data.display.observedAt !== null
        : !summary(data.display.summary) || !timestamp(data.display.observedAt)) ||
      !Array.isArray(data.observations) ||
      data.observations.some((point) => !timestamp(point.at) || !summary(point)))
    throw new Error("Current history response contract did not match");
  return { checked: true, milestone: current.milestone, displayMode: data.display.mode, retainedPoints: data.observations.length };
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
  if (process.argv[2] === "current-sprint-smoke") {
    const current = await inspectCurrentSprint(process.env.PRODUCTION_BASE_URL);
    console.log(JSON.stringify(current));
    console.log(JSON.stringify(await inspectCurrentHistory(process.env.PRODUCTION_BASE_URL, current)));
    return;
  }
  if (process.argv[2] !== "smoke")
    throw new Error("Use guard, smoke or current-sprint-smoke");
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
        `Production health and all ${assets.length} assets match; no mutation requests sent`,
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
