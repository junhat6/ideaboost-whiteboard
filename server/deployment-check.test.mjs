import test from "node:test";
import assert from "node:assert/strict";
import {
  productionBase,
  trustedPush,
  currentMain,
  verifyDeployment,
  inspectCurrentSprint,
  inspectCurrentHistory,
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


test("current history smoke uses the discovered Sprint and only logs projected metadata", async () => {
  const summary = { estimated: 1, unestimated: 2, total: 3, cancelled: 0, excludedChildren: 0, estimatedHours: 4, remainingHours: 2 };
  const data = { ok: true, milestone: 42, observedAt: "2026-10-31T00:00:00Z", current: summary, display: { mode: "live", summary, observedAt: "2026-10-31T00:00:00Z" }, observations: [{ ...summary, at: "2026-10-31T00:00:00Z", privateExtra: "not-logged" }] };
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url.href, base + "api/burndown?milestone=42");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    return Response.json(data);
  };
  const current = { status: "current", milestone: 42 };
  assert.deepEqual(await inspectCurrentHistory(base, current, fetcher), { checked: true, milestone: 42, displayMode: "live", retainedPoints: 1 });
  assert.equal(calls, 1);
  data.observations = [];
  data.display.mode = "historical";
  data.display.summary = null;
  data.display.observedAt = null;
  assert.equal((await inspectCurrentHistory(base, current, fetcher)).retainedPoints, 0);
  data.current.remainingHours = -1;
  await assert.rejects(() => inspectCurrentHistory(base, current, fetcher), /contract/);
  for (const status of [403, 503]) {
    let reads = 0;
    await assert.rejects(() => inspectCurrentHistory(base, current, async () => { reads++; return new Response("", { status }); }), /read failed/);
    assert.equal(reads, 1);
  }
  for (const status of ["none", "unavailable"])
    assert.deepEqual(await inspectCurrentHistory(base, { status }, () => { throw new Error("unexpected read"); }), { checked: false, reason: "no_current_sprint" });
});


test("current history smoke rejects malformed data and sanitizes transport failures", async () => {
  const current = { status: "current", milestone: 42 };
  const zero = { estimated: 0, unestimated: 0, total: 0, cancelled: 0, excludedChildren: 0, estimatedHours: 0, remainingHours: 0 };
  const valid = { ok: true, milestone: 42, observedAt: "2026-10-31T00:00:00Z", current: zero, display: { mode: "historical", summary: null, observedAt: null }, observations: [] };
  assert.equal((await inspectCurrentHistory(base, current, async () => Response.json(valid))).checked, true);
  const unknown = { ...zero, unestimated: 2, total: 2 };
  assert.equal((await inspectCurrentHistory(base, current, async () => Response.json({ ...valid, current: unknown }))).checked, true);
  for (const data of [
    { ...valid, milestone: 9 },
    { ...valid, display: { mode: "live", summary: null, observedAt: null } },
    { ...valid, current: {} },
    { ...valid, observations: [{}] },
    { ...valid, display: { mode: "historical", summary: null, observedAt: valid.observedAt } },
    { ...valid, display: { mode: "live", summary: zero, observedAt: null } },
  ]) await assert.rejects(() => inspectCurrentHistory(base, current, async () => Response.json(data)), /contract/);
  await assert.rejects(() => inspectCurrentHistory(base, current, async () => { throw new Error("private-url"); }), { message: "Current history read failed" });
  await assert.rejects(() => inspectCurrentHistory(base, current, async () => new Response("private-body")), { message: "Current history response was not valid JSON" });
  let reads = 0;
  await assert.rejects(() => inspectCurrentHistory("https://example.com/", current, async () => { reads++; }), /production/i);
  assert.equal(reads, 0);
});
