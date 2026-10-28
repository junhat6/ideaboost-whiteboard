import test from "node:test";
import assert from "node:assert/strict";
import {
  productionBase,
  trustedPush,
  currentMain,
  verifyDeployment,
  inspectSprintRollover,
  inspectCurrentSprint,
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

const currentSprintBody = () => ({
  ok: true,
  status: "current",
  checkedAt: "2026-10-28T00:00:00.000Z",
  currentSprint: {
    number: 10,
    title: "Sprint 10",
    policy: "sprint-v2-exclusive-jst",
    startAt: "2026-10-27T15:00:00.000Z",
    endAt: "2026-11-03T15:00:00.000Z",
    privateExtra: "not-logged",
  },
  issueData: "not-logged",
});
test("current sprint smoke performs one credential-free guarded GET and emits only metadata", async () => {
  const calls = [],
    body = currentSprintBody();
  const result = await inspectCurrentSprint(base, async (url, options) => {
    calls.push([String(url), options]);
    return Response.json(body);
  });
  assert.deepEqual(result, {
    status: "current",
    milestone: 10,
    startAt: body.currentSprint.startAt,
    endAt: body.currentSprint.endAt,
    policy: body.currentSprint.policy,
    checkedAt: body.checkedAt,
  });
  assert.equal(JSON.stringify(result).includes("not-logged"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], base + "api/current-sprint");
  assert.equal(calls[0][1].method, "GET");
  assert.equal(calls[0][1].cache, "no-store");
  assert.equal(calls[0][1].redirect, "error");
  assert.equal(calls[0][1].headers, undefined);
  assert.equal(calls[0][1].body, undefined);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
});
test("current sprint smoke follows metadata, not a fixed Sprint 10, and preserves open ends", async () => {
  const body = currentSprintBody();
  body.currentSprint.number = 11;
  body.currentSprint.title = "Sprint 11";
  body.currentSprint.endAt = null;
  const result = await inspectCurrentSprint(base, async () =>
    Response.json(body),
  );
  assert.equal(result.milestone, 11);
  assert.equal(result.endAt, null);
  assert.equal(result.status, "current");
});
for (const status of ["none", "unavailable"])
  test(`current sprint smoke reports valid ${status} without inventing current metadata`, async () => {
    const body = {
      ok: true,
      status,
      currentSprint: null,
      checkedAt: "2026-10-28T00:00:00.000Z",
      details: "not-logged",
    };
    const result = await inspectCurrentSprint(base, async () =>
      Response.json(body),
    );
    assert.deepEqual(result, {
      status,
      milestone: null,
      startAt: null,
      endAt: null,
      policy: null,
      checkedAt: body.checkedAt,
    });
  });
for (const [name, change] of [
  [
    "missing ok",
    (v) => {
      delete v.ok;
    },
  ],
  [
    "failed read",
    (v) => {
      v.ok = false;
    },
  ],
  [
    "unknown status",
    (v) => {
      v.status = "future";
    },
  ],
  [
    "missing checkedAt",
    (v) => {
      delete v.checkedAt;
    },
  ],
  [
    "invalid checkedAt",
    (v) => {
      v.checkedAt = "2026-02-30T00:00:00.000Z";
    },
  ],
  [
    "missing current",
    (v) => {
      v.currentSprint = null;
    },
  ],
  [
    "zero number",
    (v) => {
      v.currentSprint.number = 0;
    },
  ],
  [
    "fractional number",
    (v) => {
      v.currentSprint.number = 1.5;
    },
  ],
  [
    "wrong title",
    (v) => {
      v.currentSprint.title = "Sprint 11";
    },
  ],
  [
    "unknown policy",
    (v) => {
      v.currentSprint.policy = "sprint-v3";
    },
  ],
  [
    "invalid start",
    (v) => {
      v.currentSprint.startAt = "2026-02-30T15:00:00.000Z";
    },
  ],
  [
    "nonmidnight start",
    (v) => {
      v.currentSprint.startAt = "2026-10-27T16:00:00.000Z";
    },
  ],
  [
    "future start",
    (v) => {
      v.currentSprint.startAt = "2026-10-28T15:00:00.000Z";
    },
  ],
  [
    "missing end",
    (v) => {
      delete v.currentSprint.endAt;
    },
  ],
  [
    "invalid end",
    (v) => {
      v.currentSprint.endAt = "2026-02-30T15:00:00.000Z";
    },
  ],
  [
    "nonmidnight end",
    (v) => {
      v.currentSprint.endAt = "2026-11-03T16:00:00.000Z";
    },
  ],
  [
    "reversed interval",
    (v) => {
      v.currentSprint.endAt = "2026-10-26T15:00:00.000Z";
    },
  ],
  [
    "exclusive end reached",
    (v) => {
      v.checkedAt = v.currentSprint.endAt;
    },
  ],
  [
    "noncurrent with metadata",
    (v) => {
      v.status = "none";
    },
  ],
])
  test(`current sprint smoke rejects invalid contract: ${name}`, async () => {
    const body = currentSprintBody();
    change(body);
    await assert.rejects(
      () => inspectCurrentSprint(base, async () => Response.json(body)),
      /response contract/,
    );
  });
test("current sprint smoke never retries or hides denied, failed, redirected, or invalid reads", async () => {
  for (const status of [301, 403, 429, 503]) {
    let calls = 0;
    await assert.rejects(
      () =>
        inspectCurrentSprint(base, async () => {
          calls++;
          return Response.json(
            {
              ok: false,
              status: "unavailable",
              currentSprint: null,
              checkedAt: "2026-10-28T00:00:00.000Z",
              error: "not-logged",
            },
            { status },
          );
        }),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(calls, 1);
  }
  let networkCalls = 0;
  await assert.rejects(
    () =>
      inspectCurrentSprint(base, async () => {
        networkCalls++;
        throw Error("sensitive-details-not-logged");
      }),
    /^Error: Current sprint read failed$/,
  );
  assert.equal(networkCalls, 1);
  await assert.rejects(
    () =>
      inspectCurrentSprint(
        base,
        async () => new Response("sensitive-details-not-logged"),
      ),
    /^Error: Current sprint response was not valid JSON$/,
  );
  await assert.rejects(
    () => inspectCurrentSprint(base, async () => Response.json(null)),
    /response contract/,
  );
});
test("current sprint smoke refuses an unapproved destination before issuing a request", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json(currentSprintBody());
  };
  for (const invalid of [
    base.replace("workers.dev", "example.com"),
    base + "?token=not-logged",
    base.replace("/b/", "/other/"),
    "https://user:secret@example.com/",
  ])
    await assert.rejects(
      () => inspectCurrentSprint(invalid, fetcher),
      /Production URL/,
    );
  assert.equal(calls, 0);
});
