import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";
const stamp = "2026-10-28T02:00:00.000Z";
const current = (number = 10) => ({
  ok: true,
  status: "current",
  checkedAt: stamp,
  currentSprint: {
    number,
    title: `Sprint ${number}`,
    startAt: "2026-10-27T15:00:00.000Z",
    endAt: "2026-11-08T15:00:00.000Z",
    policy: "sprint-v2-exclusive-jst",
  },
});
async function refresh(page: Page) {
  if (
    !(await page.locator("#chrome").getAttribute("class"))?.includes(
      "controls-open",
    )
  )
    await page.locator("#operations").click();
  await page.locator("#refresh").click();
}

test("現在Sprintはboardを待たせず独立後読取、chart選択と無関係で通常refreshはcache共有", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let release!: () => void,
    reads = 0,
    chartReads = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/current-sprint", async (r) => {
    reads++;
    await gate;
    return r.fulfill({ json: current() });
  });
  await page.route("**/api/burndown**", (r) => {
    chartReads++;
    return r.fulfill({ status: 404, json: { error: "unused" } });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect.poll(() => reads).toBe(1);
  await page.locator("#operations").click();
  await expect(page.locator("#current-sprint")).toHaveAttribute(
    "data-state",
    "loading",
  );
  release();
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  await expect(page.locator("#current-sprint-dates")).toContainText(
    "00:00未満 JST",
  );
  await expect(page.locator("#current-sprint-dates")).toContainText(
    "2026/10/28",
  );
  await page.clock.fastForward(46000);
  await expect.poll(f.reads).toBeGreaterThan(1);
  expect(reads).toBe(1);
  expect(chartReads).toBe(0);
  expect(f.posts()).toBe(0);
});

test("期間なし・曖昧・通信失敗は現在Sprintを推測せず、手動refreshで再確認", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let response: any = current(),
    code = 200,
    reads = 0;
  await page.route("**/api/current-sprint", (r) => {
    reads++;
    return r.fulfill({ status: code, json: response });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await expect(page.locator("#current-sprint")).toHaveAttribute(
    "data-state",
    "current",
  );
  response = {
    ok: true,
    status: "none",
    currentSprint: null,
    checkedAt: stamp,
  };
  await refresh(page);
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在のSprintなし",
  );
  await expect(page.locator("#current-sprint-dates")).toBeEmpty();
  response = {
    ok: true,
    status: "unavailable",
    currentSprint: null,
    checkedAt: stamp,
  };
  await refresh(page);
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在のSprintを確認できません",
  );
  code = 503;
  response = {
    ok: false,
    status: "unavailable",
    currentSprint: null,
    checkedAt: stamp,
    error: "observation_incomplete",
  };
  await refresh(page);
  await expect.poll(() => reads).toBe(4);
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在のSprintを確認できません",
  );
  await expect(page.locator("#current-sprint-dates")).toBeEmpty();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  expect(f.posts()).toBe(0);
});

test("scope切替前の遅いcurrent応答は再投入せず、新scope結果を一度だけ読み取る", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let release!: () => void,
    reads = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/current-sprint", async (r) => {
    const count = ++reads;
    if (count === 1) {
      await gate;
      return r.fulfill({ json: current(9) });
    }
    return r.fulfill({
      json: { ok: true, status: "none", currentSprint: null, checkedAt: stamp },
    });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await expect.poll(() => reads).toBe(1);
  f.board.scope.viewNumber = 17;
  await refresh(page);
  await expect(page.locator("#current-sprint-label")).not.toContainText(
    "Sprint 9",
  );
  release();
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在のSprintなし",
  );
  expect(reads).toBe(2);
  expect(f.posts()).toBe(0);
});

test("JSTの排他的境界を跨ぐ既存pollは5分cacheを使わず現在Sprintを更新", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-27T14:59:30.000Z") });
  let reads = 0;
  await page.route("**/api/current-sprint", (r) => {
    reads++;
    return r.fulfill({
      json:
        reads === 1
          ? {
              ...current(9),
              checkedAt: "2026-10-27T14:59:30.000Z",
              currentSprint: {
                ...current(9).currentSprint,
                startAt: "2026-10-19T15:00:00.000Z",
                endAt: "2026-10-27T15:00:00.000Z",
              },
            }
          : { ...current(), checkedAt: "2026-10-27T15:00:16.000Z" },
    });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 9",
  );
  await page.clock.fastForward(46000);
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  expect(reads).toBe(2);
  expect(f.posts()).toBe(0);
});

test("後読取の公開scope403はboardとcurrent表示を消し、古い日程を残さない", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let privateScope = false;
  await page.route("**/api/current-sprint", (r) =>
    r.fulfill(
      privateScope
        ? { status: 403, json: { error: "scope_not_public" } }
        : { json: current() },
    ),
  );
  const f = await setup(page, { customCurrentSprint: true });
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  privateScope = true;
  await refresh(page);
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  await expect(page.locator("#current-sprint-label")).not.toContainText(
    "Sprint 10",
  );
  await expect(page.locator("#current-sprint-dates")).toBeEmpty();
  expect(f.posts()).toBe(0);
});

test("正式な期日未定Sprintは開始日と終了未定を表示する", async ({ page }) => {
  await page.clock.install({ time: new Date(stamp) });
  await page.route("**/api/current-sprint", (r) =>
    r.fulfill({
      json: {
        ...current(),
        currentSprint: { ...current().currentSprint, endAt: null },
      },
    }),
  );
  const f = await setup(page, { customCurrentSprint: true });
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  await expect(page.locator("#current-sprint-dates")).toContainText(
    "終了未定 JST",
  );
  expect(f.posts()).toBe(0);
});

test("公開失効前の遅いboard成功はcurrent403の後に付箋を復活させない", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let releaseCurrent!: () => void,
    releaseBoard!: () => void,
    boardPending = false;
  const currentGate = new Promise<void>((r) => {
    releaseCurrent = r;
  });
  const boardGate = new Promise<void>((r) => {
    releaseBoard = r;
  });
  await page.route("**/api/current-sprint", async (r) => {
    await currentGate;
    return r.fulfill({ status: 403, json: { error: "scope_not_public" } });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await page.route("**/api/board", async (r) => {
    boardPending = true;
    await boardGate;
    return r.fulfill({ json: f.board });
  });
  await refresh(page);
  await expect.poll(() => boardPending).toBe(true);
  releaseCurrent();
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  releaseBoard();
  await expect(page.locator("#refresh")).toBeEnabled();
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  await expect(page.locator("#current-sprint-label")).toBeEmpty();
  await expect(page.locator("#current-sprint-dates")).toBeEmpty();
  expect(f.posts()).toBe(0);
});

test("board403後の遅いcurrent成功も古い期間を復活させない", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/current-sprint", async (r) => {
    await gate;
    return r.fulfill({ json: current() });
  });
  const f = await setup(page, { customCurrentSprint: true });
  await page.route("**/api/board", (r) =>
    r.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await refresh(page);
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  release();
  await page.clock.fastForward(100);
  await expect(page.locator("#current-sprint-label")).toBeEmpty();
  await expect(page.locator("#current-sprint-dates")).toBeEmpty();
  expect(f.posts()).toBe(0);
});

test("過去Sprint9をchartで選んでも操作バーの現在Sprint10は独立する", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(stamp) });
  let reads = 0;
  await page.route("**/api/current-sprint", (r) => {
    reads++;
    return r.fulfill({ json: current() });
  });
  const f = await setup(page, { customCurrentSprint: true });
  (f.board.scope as any).estimateHoursField = true;
  await page.route("**/api/burndown**", (r) => {
    const milestone = Number(
      new URL(r.request().url()).searchParams.get("milestone") || 10,
    );
    return r.fulfill({
      json: {
        ok: true,
        scope: "view16",
        milestone,
        milestones: [
          { number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" },
          { number: 10, title: "Sprint 10", dueOn: "2026-11-09T00:00:00Z" },
        ],
        observedAt: stamp,
        schedule: { schoolDays: [], revision: "1" },
        current: {
          remainingHours: 5,
          estimatedHours: 8,
          estimated: 2,
          unestimated: 0,
          total: 2,
          cancelled: 0,
          excludedChildren: 0,
        },
        observations: [],
      },
    });
  });
  await refresh(page);
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  const before = reads;
  await page.locator("#burndown-open").click();
  await expect(
    page.getByRole("combobox", { name: "バーンダウンのスプリント" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "バーンダウンのスプリント" })
    .selectOption("9");
  await expect(
    page.getByRole("combobox", { name: "バーンダウンのスプリント" }),
  ).toHaveValue("9");
  await page.keyboard.press("Escape");
  await expect(page.locator("#current-sprint-label")).toHaveText(
    "現在：Sprint 10",
  );
  expect(reads).toBe(before);
  expect(f.posts()).toBe(0);
});
