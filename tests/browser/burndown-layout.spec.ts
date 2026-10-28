import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const source = {
  ok: true,
  scope: "layout-fixture",
  milestone: 9,
  milestones: [{ number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" }],
  schedule: {
    schoolDays: [
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ],
    revision: "saved-six",
  },
  observedAt: "2026-10-27T08:00:00Z",
  current: {
    remainingHours: 5,
    estimatedHours: 8,
    estimated: 3,
    unestimated: 1,
    total: 4,
    cancelled: 0,
  },
  observations: [
    {
      at: "2026-10-27T08:00:00Z",
      day: "2026-10-27",
      remainingHours: 5,
      estimatedHours: 8,
      estimated: 3,
      unestimated: 1,
      total: 4,
      scopeIds: ["a", "b", "c", "d"],
    },
  ],
};
async function prepare(page: Page) {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  let reads = 0,
    posts = 0;
  await page.route("**/api/burndown**", (route) => {
    if (route.request().method() === "POST") posts++;
    else reads++;
    return route.fulfill({ json: source });
  });
  await page.reload();
  await expect(page.locator("#burndown-open")).toBeVisible();
  return { ...f, reads: () => reads, schedulePosts: () => posts };
}
const panel = (page: Page) => page.locator("#burndown-panel");
const toggle = (page: Page) => page.locator("#burn-settings-toggle");
const settings = (page: Page) => page.locator("#burn-settings-popover");
async function open(page: Page) {
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await expect(panel(page)).toHaveCSS("transform", "none");
}

test("chart uses 70% width with school calendar beside close, compact save, and no redundant instructions", async ({
  page,
}) => {
  const f = await prepare(page);
  const board = await page.locator("#board").boundingBox();
  expect(f.reads()).toBe(0);
  await open(page);
  const viewport = page.viewportSize()!,
    chartBox = (await panel(page).boundingBox())!,
    buttonBox = (await toggle(page).boundingBox())!,
    closeBox = (await page
      .getByRole("button", { name: "バーンダウンを閉じる", exact: true })
      .boundingBox())!;
  expect(chartBox.width).toBeCloseTo(viewport.width * 0.7, 0);
  expect(chartBox.x + chartBox.width).toBeCloseTo(viewport.width, 0);
  expect(buttonBox.y).toBeLessThan(70);
  expect(Math.abs(buttonBox.y - closeBox.y)).toBeLessThan(8);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(closeBox.x);
  expect(await page.locator("#board").boundingBox()).toEqual(board);
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(settings(page)).toBeHidden();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(settings(page)).toHaveAttribute("role", "dialog");
  await expect(settings(page)).toHaveAccessibleName("学校日程");
  await expect(page.locator(".burn-calendar-count")).toHaveText("6日選択中");
  const dayBox = (await page.locator('[data-day="2026-10-21"]').boundingBox())!,
    saveBox = (await page
      .getByRole("button", { name: "日程を保存", exact: true })
      .boundingBox())!;
  expect(dayBox.height).toBeGreaterThanOrEqual(40);
  expect(dayBox.width).toBeGreaterThanOrEqual(40);
  expect(saveBox.width).toBeLessThan(180);
  expect(saveBox.height).toBeLessThanOrEqual(40);
  expect(saveBox.y + saveBox.height).toBeLessThan(viewport.height);
  expect(await panel(page).evaluate((el) => el.scrollTop)).toBe(0);
  await expect(panel(page)).not.toContainText("日付を押すたび");
  await expect(panel(page)).not.toContainText("矢印キーで移動");
  await expect(panel(page)).not.toContainText("学校がある日を1日ずつ");
  await expect(panel(page)).not.toContainText("実消費時間ではなく");
  await expect(panel(page)).not.toContainText("過去の実線は推定");
  await expect(page.locator(".burn-ideal-label")).toContainText("理想");
  await expect(page.locator(".burn-actual-label")).toContainText("実際");
  await panel(page).screenshot({
    path: `test-results/burndown-layout-${viewport.width}.png`,
  });
  expect(f.schedulePosts()).toBe(0);
  expect(f.posts()).toBe(0);
});

test("calendar popover preserves draft with Escape/close/outside/Tab and never steals destination focus", async ({
  page,
}) => {
  const f = await prepare(page);
  await open(page);
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('#burn-school-days button[data-day][tabindex="0"]'),
  ).toBeFocused();
  const day = page.locator('[data-day="2026-10-21"]');
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(settings(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(day).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "学校日程を閉じる", exact: true })
    .click();
  await expect(toggle(page)).toBeFocused();
  await toggle(page).click();
  await page.locator(".burn-summary strong").click();
  await expect(settings(page)).toBeHidden();
  await expect(toggle(page)).not.toBeFocused();
  await toggle(page).click();
  await expect(day).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "日程を保存", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(settings(page)).toBeHidden();
  await expect(page.getByLabel("バーンダウンのスプリント")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("#burndown-open")).toBeFocused();
  expect(f.schedulePosts()).toBe(0);
  expect(f.reads()).toBe(1);
  expect(f.posts()).toBe(0);
});

test("short and narrow viewport keeps header access, hidden controls out of tab order and calendar inside panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await prepare(page);
  await open(page);
  await panel(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const button = (await toggle(page).boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(0);
  expect(button.y + button.height).toBeLessThan(100);
  await toggle(page).click();
  const popup = (await settings(page).boundingBox())!;
  expect(popup.x).toBeGreaterThanOrEqual(0);
  expect(popup.x + popup.width).toBeLessThanOrEqual(391);
  expect(popup.y + popup.height).toBeLessThanOrEqual(640);
  expect(
    (await page.locator('[data-day="2026-10-21"]').boundingBox())!.height,
  ).toBeGreaterThanOrEqual(40);
  await page.keyboard.press("Escape");
  await expect(settings(page)).toBeHidden();
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "バーンダウンを閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("バーンダウンのスプリント")).toBeFocused();
});

test("entry animation advances through real frames, replays on reopen and does not block after close", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const f = await prepare(page);
  await page.evaluate(() => {
    (window as any).burnMotion = { frames: [] as any[], done: false };
    let started: number | null = null;
    const sample = (at: number) => {
      const el = document.querySelector<HTMLDialogElement>("#burndown-panel");
      if (el?.open) {
        started ??= at;
        const style = getComputedStyle(el);
        (window as any).burnMotion.frames.push({
          at: at - started,
          x: new DOMMatrixReadOnly(style.transform).m41,
          opacity: Number(style.opacity),
          duration: style.animationDuration,
        });
        if (at - started >= 450) {
          (window as any).burnMotion.done = true;
          return;
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator("#burndown-open").click();
  await page.waitForFunction(
    () => (window as any).burnMotion.frames.length >= 2,
  );
  await page.screenshot({
    path: `test-results/burndown-enter-early-${page.viewportSize()!.width}.png`,
    animations: "allow",
  });
  await page.waitForFunction(() => (window as any).burnMotion.done);
  const frames = await page.evaluate(() => (window as any).burnMotion.frames);
  expect(frames.length).toBeGreaterThan(4);
  expect(frames.some((frame: any) => frame.x > 10 && frame.opacity < 1)).toBe(
    true,
  );
  expect(
    frames.some(
      (frame: any) => frame.at > 100 && frame.at < 330 && frame.x > 0,
    ),
  ).toBe(true);
  expect(parseFloat(frames[0].duration)).toBeGreaterThanOrEqual(0.3);
  expect(frames.at(-1).x).toBe(0);
  expect(frames.at(-1).opacity).toBe(1);
  await page.screenshot({
    path: `test-results/burndown-enter-settled-${page.viewportSize()!.width}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(page.locator("#burndown-open")).toBeFocused();
  await page.locator("#burndown-open").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#burndown-panel")
      ?.getAnimations()
      .some((a) => a.playState === "running"),
  );
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await page.waitForTimeout(450);
  expect(
    await page.evaluate(
      () => document.querySelector("#burndown-panel")!.getClientRects().length,
    ),
  ).toBe(0);
  await page.locator(".task-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  expect(f.schedulePosts()).toBe(0);
});

test("reduced motion opens settled and a cancelled edge hover does not open chart", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const f = await prepare(page);
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await page.mouse.move(600, 400);
  await page.waitForTimeout(250);
  await expect(panel(page)).toBeHidden();
  expect(f.reads()).toBe(0);
  await open(page);
  await expect(panel(page)).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(
    await page.evaluate(
      () => document.querySelector("#burndown-panel")!.getClientRects().length,
    ),
  ).toBe(0);
});
