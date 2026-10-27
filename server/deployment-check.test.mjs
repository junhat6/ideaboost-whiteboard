import test from "node:test";
import assert from "node:assert/strict";
import {
  productionBase,
  trustedPush,
  currentMain,
  verifyDeployment,
  inspectSprintRollover,
} from "../scripts/deployment-check.mjs";

const base = `https://ideaboost-whiteboard.ideaboost-whiteboard.workers.dev/b/${"a".repeat(48)}/`;
const sha = "b".repeat(40);
const env = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "junhat6/ideaboost-whiteboard",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  CLOUDFLARE_ACCOUNT_ID: "29a0469ba7d11f29ac94e3ed41f388a8",
  PRODUCTION_BASE_URL: base,
};
test("配信guardは同じmain push SHAと固定account/host/path以外を拒否", () => {
  assert.doesNotThrow(() => trustedPush(env, sha));
  for (const [key, value] of [
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_EVENT_NAME", "workflow_run"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_REPOSITORY", "other/repo"],
    ["CLOUDFLARE_ACCOUNT_ID", "other"],
  ])
    assert.throws(() => trustedPush({ ...env, [key]: value }, sha));
  assert.throws(() => trustedPush(env, "c".repeat(40)));
  for (const value of [
    "",
    base.replace("https:", "http:"),
    base.replace("workers.dev", "example.com"),
    base + "?token=never-log-input",
    base.replace("https://", "https://user:password@"),
  ])
    assert.throws(() => productionBase(value));
});
test("mainが先へ進んだ場合は古いCI成功commitを配信しない", async () => {
  let reads = 0;
  await currentMain(sha, "fixture-token", async (_url, options) => {
    reads++;
    assert.equal(options.redirect, "error");
    return Response.json({ object: { sha } });
  });
  assert.equal(reads, 1);
  await assert.rejects(
    () =>
      currentMain(sha, "fixture-token", async () =>
        Response.json({ object: { sha: "c".repeat(40) } }),
      ),
    /main changed/,
  );
  await assert.rejects(() => currentMain(sha, ""), /missing/);
});
test("配信smokeはGETだけでhealthとasset完全一致を確認し旧版や設定消失を拒否", async () => {
  const health = {
    configured: true,
    mode: "github",
    accessMode: "public-temporary",
    storyPoints: true,
  };
  const calls = [];
  let stale = false;
  const fetcher = async (url, options) => {
    calls.push(options.method);
    assert.equal(options.redirect, "error");
    return url.pathname.endsWith("api/health")
      ? Response.json(health)
      : new Response(stale ? "old" : "new");
  };
  await verifyDeployment(base, [["app.js", Buffer.from("new")]], fetcher);
  assert.deepEqual(calls, ["GET", "GET"]);
  stale = true;
  await assert.rejects(
    () => verifyDeployment(base, [["app.js", Buffer.from("new")]], fetcher),
    /asset does not match/,
  );
  health.storyPoints = false;
  await assert.rejects(
    () => verifyDeployment(base, [], fetcher),
    /runtime settings/,
  );
});

test("rollover smoke performs one guarded public GET and reports only minimal summary metadata", async () => {
  const body = {
    ok: true,
    milestone: 9,
    scope: "not-logged",
    current: { remainingHours: 0 },
    display: {
      mode: "historical",
      policy: "sprint-v2-exclusive-jst",
      cutoff: "2026-10-27T15:00:00.000Z",
      observedAt: "2026-10-27T08:00:00Z",
      summary: { remainingHours: 5, scopeIds: ["not-logged"] },
    },
    observations: [{ at: "2026-10-27T08:00:00Z", scopeIds: ["not-logged"] }],
  };
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push([String(url), options]);
    return Response.json(body);
  };
  const result = await inspectSprintRollover(base, fetcher);
  assert.deepEqual(result, {
    milestone: 9,
    displayMode: "historical",
    cutoff: body.display.cutoff,
    finalRecordedAt: body.display.observedAt,
    recordedRemainingHours: 5,
    currentScopeRemainingHours: 0,
    retainedPoints: 1,
  });
  assert.equal(JSON.stringify(result).includes("not-logged"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], base + "api/burndown?milestone=9");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].headers, undefined);
  body.display.summary = null;
  body.display.observedAt = null;
  body.observations = [];
  assert.equal(
    (await inspectSprintRollover(base, fetcher)).recordedRemainingHours,
    null,
  );
  body.display.mode = "live";
  await assert.rejects(
    () => inspectSprintRollover(base, fetcher),
    /display contract/,
  );
});

test("rollover smoke does not bypass denied reads or accept a post-cutoff point", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      inspectSprintRollover(base, async () => {
        calls++;
        return Response.json({ error: "scope_not_public" }, { status: 403 });
      }),
    /HTTP 403/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      inspectSprintRollover(base, async () =>
        Response.json({
          ok: true,
          milestone: 9,
          current: { remainingHours: 0 },
          display: {
            mode: "historical",
            policy: "sprint-v2-exclusive-jst",
            cutoff: "2026-10-27T15:00:00.000Z",
            observedAt: "2026-10-27T15:00:00Z",
            summary: { remainingHours: 0 },
          },
          observations: [{ at: "2026-10-27T15:00:00Z" }],
        }),
      ),
    /display contract/,
  );
});
