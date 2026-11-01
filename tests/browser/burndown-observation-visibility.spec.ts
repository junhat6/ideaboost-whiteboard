import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const start = "2026-10-28T18:02:47.093Z";
const days = [
  "2026-10-29",
  "2026-11-02",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-09",
];
const oldDays = [
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
];
const milestones = [
  { number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" },
  { number: 10, title: "Sprint 10", dueOn: "2026-11-09T00:00:00Z" },
];
const summary = (remainingHours: number, estimatedHours = 60) => ({
  remainingHours,
  estimatedHours,
  estimated: 14,
  unestimated: 10,
  total: 24,
  cancelled: 1,
  excludedChildren: 1,
});
const point = (
  day: string,
  at: string,
  remainingHours: number,
  estimatedHours = 60,
) => ({
  ...summary(remainingHours, estimatedHours),
  day,
  at,
});
function live() {
  return {
    ok: true,
    scope: "synthetic-view16",
    milestone: 10,
    milestones,
    observedAt: start,
    current: summary(23),
    schedule: { schoolDays: [...days], revision: "saved-10" },
    observations: [
      point("2026-10-28", "2026-10-28T10:13:18.433Z", 53),
      point("2026-10-29", "2026-10-28T18:02:40.037Z", 23),
    ],
  };
}
function historical() {
  return {
    ...live(),
    milestone: 9,
    current: { ...summary(0, 0), estimated: 0, unestimated: 0, total: 0 },
    schedule: { schoolDays: [...oldDays], revision: "saved-9" },
    display: {
      mode: "historical",
      summary: summary(61, 95.5),
      observedAt: "2026-10-27T14:59:59.999Z",
      cutoff: "2026-10-27T15:00:00.000Z",
      policy: "sprint-v2-exclusive-jst",
    },
    observations: [point("2026-10-27", "2026-10-27T14:59:59.999Z", 61, 95.5)],
  };
}
function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
type Reply = { status?: number; json: any };
async function prepare(page: Page, boardMilestone = "9", at = start) {
  await page.clock.setFixedTime(new Date(at));
  const f = await setup(page);
  Object.assign(f.board.scope, {
    estimateHoursField: true,
    milestones,
    selectedMilestone: boardMilestone,
  });
  for (const issue of [...f.board.lanes, ...f.board.tasks])
    Object.assign(issue, {
      milestone: { number: Number(boardMilestone || 10) },
      estimateHours: 4,
      parentId: "lane",
    });
  const charts: Record<number, any> = { 9: historical(), 10: live() },
    reads: number[] = [],
    writes: any[] = [],
    hooks: {
      get?: (milestone: number, payload: any) => Promise<Reply | undefined>;
      post?: (milestone: number, patch: any) => Promise<Reply | undefined>;
    } = {};
  await page.route("**/api/burndown**", async (route) => {
    const milestone = Number(
      new URL(route.request().url()).searchParams.get("milestone") ||
        boardMilestone ||
        10,
    );
    if (route.request().method() === "POST") {
      const patch = route.request().postDataJSON();
      writes.push({ milestone, ...patch });
      const custom = await hooks.post?.(milestone, patch);
      if (custom) return route.fulfill(custom);
      charts[milestone].schedule = {
        schoolDays: patch.schoolDays,
        revision: `saved-${writes.length}`,
      };
      return route.fulfill({
        json: { ok: true, schedule: charts[milestone].schedule },
      });
    }
    reads.push(milestone);
    const payload = structuredClone(charts[milestone]),
      custom = await hooks.get?.(milestone, payload);
    return route.fulfill(custom ?? { json: payload });
  });
  await page.reload();
  await expect(page.locator("#burndown-open")).toBeVisible();
  await expect(page.locator("#milestone-filter")).toHaveValue(boardMilestone);
  let now = Date.parse(at);
  const wake = async (milliseconds = 45_001) => {
    now += milliseconds;
    await page.clock.setFixedTime(new Date(now));
    const before = f.reads();
    // Existing browser focus wake, not an app-internal refresh call or new timer.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => f.reads()).toBeGreaterThan(before);
    await expect(page.locator("#refresh")).toBeEnabled();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  };
  return { ...f, charts, reads, writes, hooks, wake, now: () => now };
}
async function open(page: Page, milestone = 10) {
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toBeVisible();
  const select = page.getByLabel("バーンダウンのスプリント");
  if ((await select.inputValue()) !== String(milestone))
    await select.selectOption(String(milestone));
  await expect(select).toHaveValue(String(milestone));
  await expect(page.locator(".burn-summary strong")).toHaveText(
    milestone === 9 ? "残り：61h" : "残り：23h",
  );
}
async function close(page: Page) {
  if (await page.locator("#burn-settings-popover").isVisible())
    await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).toBeHidden();
}
function replaceCurrent(chart: any, remaining: number, at: string, total = 60) {
  chart.current = summary(remaining, total);
  chart.observedAt = at;
  const day = new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 10);
  chart.observations.push(point(day, at, remaining, total));
}

test("開始前の履歴を描画から除外し、学校6日と元日時を変更しない", async ({
  page,
}) => {
  const f = await prepare(page);
  await open(page);
  await expect(page.locator(".burn-point")).toHaveCount(1);
  await expect(page.locator(".burn-point title").first()).toContainText(
    "2026-10-29: 23h",
  );
  await expect(page.locator(".burn-summary")).toContainText("未見積 10件");
  await expect(page.locator(".burn-point").first()).toHaveAttribute("cx", "60");
  await expect(page.locator(".burn-ideal")).toHaveAttribute(
    "d",
    "M 60 50 L 680 310",
  );
  await expect(page.locator(".burn-chart svg")).not.toContainText("10/28");
  await expect(page.locator(".burn-chart text[aria-label]")).toHaveCount(6);
  await page.locator("#burn-settings-toggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".burn-calendar-count")).toHaveText("6日選択中");
  await expect(
    page.locator('#burn-school-days [data-day="2026-10-28"]'),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.locator('#burn-school-days [data-day="2026-10-29"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#burn-settings-toggle")).toBeFocused();
  expect(f.charts[10].schedule.schoolDays).toEqual(days);
  await expect(page.locator("#burn-settings-popover")).toBeHidden();
  await expect(page.locator("#burndown-panel")).toHaveCSS("transform", "none");
  // Static chart evidence only; this is not a motion/animation assertion.
  await page.locator("#burndown-panel").screenshot({
    path: `test-results/burndown-observation-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  expect(f.writes).toHaveLength(0);
  expect(f.posts()).toBe(0);
});

for (const change of [
  { name: "close", remaining: 16, total: 60 },
  { name: "追加", remaining: 28, total: 65 },
  { name: "再見積", remaining: 20, total: 57 },
])
  test(`board9不変でもchart10の${change.name}を45秒可視wakeで再検証`, async ({
    page,
  }) => {
    const f = await prepare(page);
    await open(page);
    const before = f.reads.length,
      board = structuredClone(f.board);
    replaceCurrent(
      f.charts[10],
      change.remaining,
      new Date(f.now() + 45000).toISOString(),
      change.total,
    );
    await f.wake();
    await expect.poll(() => f.reads.length).toBe(before + 1);
    await expect(page.locator(".burn-summary strong")).toHaveText(
      `残り：${change.remaining}h`,
    );
    await expect(page.locator("#milestone-filter")).toHaveValue("9");
    expect(f.board).toEqual(board);
    expect(f.writes).toHaveLength(0);
    expect(f.posts()).toBe(0);
  });

for (const scope of ["10", ""])
  test(`board監視範囲${scope || "全Sprint"}のtitle/body同期は0追加GET、集計差分だけ即再取得`, async ({
    page,
  }) => {
    const f = await prepare(page, scope);
    await open(page);
    const before = f.reads.length;
    f.board.tasks[0].title = "無関係な題名の更新";
    f.board.tasks[0].body = "集計と無関係な本文の更新";
    await f.wake();
    expect(f.reads).toHaveLength(before);
    (f.board.tasks[0] as any).estimateHours = 7;
    replaceCurrent(
      f.charts[10],
      26,
      new Date(f.now() + 6000).toISOString(),
      63,
    );
    await f.wake(6000);
    await expect.poll(() => f.reads.length).toBe(before + 1);
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：26h");
    expect(f.posts()).toBe(0);
  });

test("閉じたchartは複数45秒wakeでも追加GETしない", async ({ page }) => {
  const f = await prepare(page);
  await open(page);
  await close(page);
  const before = f.reads.length;
  for (let index = 0; index < 3; index++) await f.wake();
  expect(f.reads).toHaveLength(before);
  expect(f.writes).toHaveLength(0);
  expect(f.posts()).toBe(0);
});

test("範囲外wake GETを単一flightにし、Sprint切替後に旧応答を描画しない", async ({
  page,
}) => {
  const f = await prepare(page),
    gate = deferred();
  await open(page);
  const before = f.reads.length;
  let held = false;
  f.hooks.get = async (milestone, payload) => {
    if (milestone === 10 && !held) {
      held = true;
      await gate.wait;
      return { json: { ...payload, current: summary(999) } };
    }
  };
  try {
    await f.wake();
    await expect.poll(() => f.reads.length).toBe(before + 1);
    await f.wake(6000);
    await f.wake(6000);
    expect(f.reads).toHaveLength(before + 1);
    await page.getByLabel("バーンダウンのスプリント").selectOption("9");
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：61h");
    gate.release();
    await expect.poll(() => f.reads.length).toBe(before + 2);
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：61h");
    await expect(page.locator(".burn-observed")).toHaveText(
      "最終記録: 2026/10/27 23:59:59 JST",
    );
    expect(f.reads.slice(before)).toEqual([10, 9]);
    expect(f.posts()).toBe(0);
  } finally {
    gate.release();
  }
});

test("503は前回値と元観測時刻を残し、次wakeで回復する", async ({ page }) => {
  const f = await prepare(page);
  await open(page);
  const observed = await page.locator(".burn-observed").textContent(),
    before = f.reads.length;
  f.hooks.get = async () => ({
    status: 503,
    json: { error: "observation_unavailable" },
  });
  await f.wake();
  await expect(page.locator(".burn-notice")).toContainText(
    "更新できませんでした",
  );
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：23h");
  await expect(page.locator(".burn-observed")).toHaveText(observed!);
  await expect(page.locator(".burn-point")).toHaveCount(1);
  f.hooks.get = undefined;
  replaceCurrent(f.charts[10], 18, new Date(f.now() + 45000).toISOString());
  await f.wake();
  await expect.poll(() => f.reads.length).toBe(before + 2);
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：18h");
  await expect(page.locator(".burn-notice")).toBeHidden();
  expect(f.posts()).toBe(0);
});

test("同SprintでもJST日跨ぎは45秒未満で再検証し開始日から実観測を描く", async ({
  page,
}) => {
  const beforeMidnight = "2026-10-28T14:59:50Z",
    f = await prepare(page, "10", beforeMidnight);
  f.charts[10].observedAt = beforeMidnight;
  f.charts[10].current = summary(53);
  f.charts[10].observations = [point("2026-10-28", beforeMidnight, 53)];
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：53h");
  const before = f.reads.length;
  replaceCurrent(f.charts[10], 23, "2026-10-28T15:00:01Z");
  await f.wake(11000);
  await expect.poll(() => f.reads.length).toBe(before + 1);
  await expect(page.locator(".burn-observed")).toHaveText(
    "観測: 2026/10/29 0:00:01 JST",
  );
  await expect(page.locator(".burn-point")).toHaveCount(1);
  await expect(page.locator(".burn-point title").first()).toContainText(
    "2026-10-29: 23h",
  );
  expect(f.posts()).toBe(0);
});

for (const error of ["scope_not_public", "estimate_hours_not_public"])
  test(`旧wake GETの${error}も切替先より優先してcacheを消去`, async ({
    page,
  }) => {
    const f = await prepare(page),
      gate = deferred();
    await open(page);
    let held = false;
    f.hooks.get = async (milestone) => {
      if (milestone === 10 && !held) {
        held = true;
        await gate.wait;
        return { status: 403, json: { error } };
      }
    };
    try {
      await f.wake();
      await expect.poll(() => held).toBe(true);
      await page.getByLabel("バーンダウンのスプリント").selectOption("9");
      await expect(page.locator(".burn-summary strong")).toHaveText(
        "残り：61h",
      );
      gate.release();
      await expect(page.locator("#burndown-panel")).toBeHidden();
      await expect(page.locator("#burndown-open")).toBeHidden();
      await expect(page.locator(".burn-summary, .burn-point")).toHaveCount(0);
      expect(f.posts()).toBe(0);
    } finally {
      gate.release();
    }
  });

test("日程保存ACKと範囲外wakeは追加読取1回へ集約し未保存追記を保持", async ({
  page,
}) => {
  const f = await prepare(page),
    gate = deferred();
  await open(page);
  f.hooks.post = async () => {
    await gate.wait;
    return undefined;
  };
  await page.locator("#burn-settings-toggle").click();
  await page.locator('#burn-school-days [data-day="2026-10-30"]').focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  const before = f.reads.length;
  try {
    await page.locator('#burn-school-days [data-day="2026-10-31"]').click();
    await f.wake();
    expect(f.reads).toHaveLength(before);
    gate.release();
    await expect.poll(() => f.reads.length).toBe(before + 1);
    await expect(page.locator(".burn-calendar-count")).toHaveText("8日選択中");
    await expect(
      page.locator('#burn-school-days [data-day="2026-10-31"]'),
    ).toHaveAttribute("aria-pressed", "true");
    expect(f.writes).toHaveLength(1);
    expect(f.posts()).toBe(0);
    expect(f.charts[10].schedule.schoolDays).not.toContain("2026-10-31");
  } finally {
    gate.release();
  }
});

test("S10のclose・追加・再見積後もS9の61h・元時刻・10/28学校日を保持", async ({
  page,
}) => {
  const f = await prepare(page);
  await open(page, 9);
  const before = structuredClone(f.charts[9]),
    path = await page.locator(".burn-actual").getAttribute("d");
  await page.getByLabel("バーンダウンのスプリント").selectOption("10");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：23h");
  replaceCurrent(f.charts[10], 0, new Date(f.now() + 45000).toISOString(), 80);
  await f.wake();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：0h");
  await page.getByLabel("バーンダウンのスプリント").selectOption("9");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：61h");
  await expect(page.locator(".burn-observed")).toHaveText(
    "最終記録: 2026/10/27 23:59:59 JST",
  );
  await expect(page.locator(".burn-actual")).toHaveAttribute("d", path!);
  await expect(page.locator(".burn-chart svg")).toContainText("10/28");
  expect(f.charts[9]).toEqual(before);
  expect(f.posts()).toBe(0);
});

test("board GET中にhiddenになったら後段wakeはchartを読まず、復帰時だけ更新する", async ({
  page,
}) => {
  const f = await prepare(page),
    gate = deferred();
  await open(page);
  const before = f.reads.length;
  let boards = 0;
  await page.route("**/api/board**", async (route) => {
    boards++;
    await gate.wait;
    return route.fulfill({ json: f.board });
  });
  try {
    await page.clock.setFixedTime(new Date(Date.parse(start) + 45001));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => boards).toBe(1);
    // Synthetic platform visibility transition; never mutate application state.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    gate.release();
    await expect(page.locator("#refresh")).toBeEnabled();
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    );
    expect(f.reads).toHaveLength(before);
    replaceCurrent(
      f.charts[10],
      18,
      new Date(Date.parse(start) + 51001).toISOString(),
    );
    await page.clock.setFixedTime(new Date(Date.parse(start) + 51001));
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      Reflect.deleteProperty(document, "visibilityState");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => f.reads.length).toBe(before + 1);
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：18h");
    expect(f.posts()).toBe(0);
  } finally {
    gate.release();
    await page.evaluate(() => {
      Reflect.deleteProperty(document, "hidden");
      Reflect.deleteProperty(document, "visibilityState");
    });
  }
});

test("JST跨ぎで完了した前日開始GETは当日のwake再読を一度だけ残す", async ({
  page,
}) => {
  const beforeMidnight = "2026-10-28T14:59:50Z",
    f = await prepare(page, "10", beforeMidnight),
    gate = deferred();
  f.charts[10].observedAt = beforeMidnight;
  f.charts[10].current = summary(53);
  f.charts[10].observations = [point("2026-10-28", beforeMidnight, 53)];
  let held = false;
  f.hooks.get = async (_milestone, payload) => {
    if (!held) {
      held = true;
      await gate.wait;
      return { json: payload };
    }
  };
  try {
    await page.locator("#burndown-open").click();
    await expect.poll(() => held).toBe(true);
    await f.wake(11000);
    expect(f.reads).toEqual([10]);
    replaceCurrent(f.charts[10], 23, "2026-10-28T15:00:01Z");
    gate.release();
    await expect.poll(() => f.reads.length).toBe(2);
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：23h");
    await expect(page.locator(".burn-observed")).toHaveText(
      "観測: 2026/10/29 0:00:01 JST",
    );
    await expect(page.locator(".burn-point")).toHaveCount(1);
    expect(f.reads).toEqual([10, 10]);
    expect(f.posts()).toBe(0);
  } finally {
    gate.release();
  }
});

test("同日45秒を跨いだ進行GETは受動wakeで破棄せず成功後の重複再読を省く", async ({
  page,
}) => {
  const f = await prepare(page),
    gate = deferred();
  await open(page, 9);
  let held = false;
  f.hooks.get = async (milestone, payload) => {
    if (milestone === 10 && !held) {
      held = true;
      await gate.wait;
      return { json: payload };
    }
  };
  try {
    await page.getByLabel("バーンダウンのスプリント").selectOption("10");
    await expect.poll(() => held).toBe(true);
    const before = f.reads.length;
    await f.wake();
    await f.wake(6000);
    expect(f.reads).toHaveLength(before);
    gate.release();
    await expect(page.locator(".burn-summary strong")).toHaveText("残り：23h");
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(f.reads).toHaveLength(before);
    expect(f.posts()).toBe(0);
  } finally {
    gate.release();
  }
});

for (const status of [403, 200])
  test(`旧source日程POST${status}はadapter交換後の新chart・公開状態・日程を変更しない`, async ({
    page,
  }) => {
    const f = await prepare(page),
      gate = deferred();
    await open(page);
    f.hooks.post = async (_milestone, patch) => {
      await gate.wait;
      return status === 403
        ? { status, json: { error: "scope_not_public" } }
        : {
            json: {
              ok: true,
              schedule: {
                schoolDays: patch.schoolDays,
                revision: "old-source-ack",
              },
            },
          };
    };
    await page.locator("#burn-settings-toggle").click();
    await page.locator('#burn-school-days [data-day="2026-10-30"]').click();
    await page.getByRole("button", { name: "日程を保存", exact: true }).click();
    await expect.poll(() => f.writes.length).toBe(1);
    try {
      const next = structuredClone(f.board);
      Object.assign(next.scope, {
        selectedMilestone: "10",
        viewFilter: "type:PBI new-source",
      });
      next.lanes[0].title = "新しい接続のPBI";
      f.charts[10].scope = "synthetic-new-source";
      replaceCurrent(f.charts[10], 11, new Date(f.now() + 1000).toISOString());
      // Public adapter boundary, as used by the existing comment ownership fixtures.
      await page.evaluate(async (snapshot) => {
        await (window as any).Whiteboard.setAdapter({
          load: async () => structuredClone(snapshot),
          saveIssue: async () => {
            throw Error("fixture forbids Issue writes");
          },
        });
      }, next);
      await expect(page.locator("#burndown-panel")).toBeHidden();
      await expect(page.locator(".pbi-title").first()).toHaveText(
        "新しい接続のPBI",
      );
      await page.locator("#burndown-open").click();
      await expect(page.locator(".burn-summary strong")).toHaveText(
        "残り：11h",
      );
      const before = f.reads.length,
        response = page.waitForResponse(
          (reply) =>
            reply.request().method() === "POST" &&
            new URL(reply.url()).pathname.endsWith("/api/burndown/schedule"),
        );
      gate.release();
      await (await response).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(page.locator("#burndown-panel")).toBeVisible();
      await expect(page.locator("#burndown-open")).toBeVisible();
      await expect(page.locator(".burn-summary strong")).toHaveText(
        "残り：11h",
      );
      await expect(page.locator(".pbi-title")).toHaveCount(6);
      await page.locator("#burn-settings-toggle").click();
      await expect(page.locator(".burn-calendar-count")).toHaveText(
        "6日選択中",
      );
      await expect(
        page.locator('#burn-school-days [data-day="2026-10-30"]'),
      ).toHaveAttribute("aria-pressed", "false");
      expect(f.reads).toHaveLength(before);
      expect(f.writes).toHaveLength(1);
      expect(f.posts()).toBe(0);
    } finally {
      gate.release();
    }
  });
