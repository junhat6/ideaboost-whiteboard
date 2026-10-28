import test from "node:test";
import assert from "node:assert/strict";
import { inspectSprintTen } from "../scripts/burndown-audit.mjs";

const base = `https://ideaboost-whiteboard.ideaboost-whiteboard.workers.dev/b/${"a".repeat(48)}/`;
function fixture() {
  const current = {
    estimatedHours: 60,
    remainingHours: 43,
    estimated: 20,
    unestimated: 10,
    total: 30,
    cancelled: 2,
    excludedChildren: 1,
    issueIds: ["must-not-log"],
    body: "must-not-log",
  };
  return {
    ok: true,
    milestone: 10,
    observedAt: "2026-10-28T16:28:11Z",
    current,
    scope: "must-not-log",
    recordingLimited: false,
    display: {
      mode: "live",
      summary: current,
      observedAt: "2026-10-28T16:28:11Z",
      cutoff: null,
    },
    schedule: {
      schoolDays: ["2026-10-29", "2026-11-09"],
      revision: "must-not-log",
    },
    milestones: [
      {
        number: 10,
        title: "must-not-log",
        assignmentWindow: {
          startAt: "2026-10-27T15:00:00Z",
          endAt: "2026-11-08T15:00:00Z",
        },
      },
    ],
    observations: [
      { day: "2026-10-29", at: "2026-10-28T16:28:11Z", ...current },
    ],
  };
}
test("Sprint10診断は固定URLへ資格情報なしGET1回、集計と日付だけ出力", async () => {
  let requests = 0;
  const output = await inspectSprintTen(base, async (url, options) => {
    requests++;
    assert.equal(String(url), base + "api/burndown?milestone=10");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers, undefined);
    assert.equal(options.credentials, undefined);
    assert.equal(options.body, undefined);
    return Response.json(fixture());
  });
  assert.equal(requests, 1);
  assert.equal(output.current.completedEstimatedHours, 17);
  assert.deepEqual(output.schoolDays, ["2026-10-29", "2026-11-09"]);
  assert.equal(output.assignment.endAt, "2026-11-08T15:00:00.000Z");
  assert.ok(!JSON.stringify(output).includes("must-not-log"));
});
test("非承認host/pathは通信前拒否", async () => {
  let requests = 0;
  for (const url of [
    "https://example.com/",
    base + "?x=1",
    base.replace("https:", "http:"),
    base.replace("/b/", "/other/"),
  ])
    await assert.rejects(() =>
      inspectSprintTen(url, async () => {
        requests++;
      }),
    );
  assert.equal(requests, 0);
});
test("403/503/通信失敗を再試行せず、例外へ生応答を含めない", async () => {
  for (const status of [403, 503, null]) {
    let requests = 0;
    await assert.rejects(
      () =>
        inspectSprintTen(base, async () => {
          requests++;
          if (status === null) throw Error("must-not-log");
          return Response.json({ error: "must-not-log" }, { status });
        }),
      (error) => !error.message.includes("must-not-log"),
    );
    assert.equal(requests, 1);
  }
});
test("不正な集計・日付・別Sprintを正常な値へ補正しない", async () => {
  for (const change of [
    (v) => {
      v.current.remainingHours = 61;
    },
    (v) => {
      v.current.unestimated = -1;
    },
    (v) => {
      v.current.total = 999;
    },
    (v) => {
      v.schedule.schoolDays = ["2026-02-30"];
    },
    (v) => {
      v.observations[0].day = "must-not-log";
    },
    (v) => {
      v.milestone = 9;
    },
  ]) {
    const data = fixture();
    change(data);
    await assert.rejects(() =>
      inspectSprintTen(base, async () => Response.json(data)),
    );
  }
});

test("JSON解析失敗は応答本文を例外へ漏らさない", async () => {
  await assert.rejects(
    () => inspectSprintTen(base, async () => new Response("must-not-log")),
    (error) => error.message === "Sprint 10 audit response is not JSON",
  );
});

test("過去表示の記録欠測と記録上限をゼロへ置換しない", async () => {
  const data = fixture();
  data.display = {
    mode: "historical",
    summary: null,
    observedAt: null,
    cutoff: "2026-11-08T15:00:00Z",
  };
  data.recordingLimited = true;
  const output = await inspectSprintTen(base, async () => Response.json(data));
  assert.equal(output.display.summary, null);
  assert.equal(output.display.observedAt, null);
  assert.equal(output.recordingLimited, true);
});
