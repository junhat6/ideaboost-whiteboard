import { test, expect } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";
const data = {
  ok: true,
  observedAt: "2026-10-27T08:00:00Z",
  milestone: 9,
  milestones: [{ number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" }],
  current: {
    remainingHours: 5,
    estimatedHours: 8,
    estimated: 3,
    unestimated: 2,
    total: 5,
    cancelled: 1,
  },
  observations: [
    {
      at: "2026-10-26T08:00:00Z",
      day: "2026-10-26",
      remainingHours: 8,
      estimatedHours: 8,
      estimated: 3,
      unestimated: 1,
      total: 4,
      scopeIds: ["a", "b", "c", "d"],
    },
    {
      at: "2026-10-27T08:00:00Z",
      day: "2026-10-27",
      remainingHours: 5,
      estimatedHours: 8,
      estimated: 3,
      unestimated: 2,
      total: 5,
      scopeIds: ["a", "b", "c", "d", "e"],
    },
  ],
};
test("バーンダウンは初回要求なし、右端hoverと明示button、Esc復帰・board寸法不変", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  let reads = 0;
  await page.route("**/api/burndown*", (r) => {
    reads++;
    return r.fulfill({ json: data });
  });
  await page.reload();
  await expect(page.locator("#burndown-open")).toBeVisible();
  expect(reads).toBe(0);
  const before = await page.locator("#board").boundingBox();
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await expect(page.locator(".burn-summary strong")).toHaveText("5 h");
  expect(reads).toBe(1);
  expect(await page.locator("#board").boundingBox()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  await page.mouse.move(600, 400);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await page.locator("#burndown-panel").screenshot({
    path: `.wrangler/burndown-${page.viewportSize()!.width}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-open")).toBeFocused();
  await page.locator(".task-title").first().click();
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await page.waitForTimeout(250);
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
});
test("時間autosaveは本文を便乗せず、小数/解除と再訪、PBI対象外", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = null;
  const patches: any[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") patches.push(r.postDataJSON());
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await expect(page.locator("#estimate-hours-editor")).toBeVisible();
  await fillEditor(page, "未保存の本文を保持");
  await page.locator("#estimate-hours").fill("1.5");
  expect(f.posts()).toBe(0);
  await page.locator("#estimate-hours").press("Enter");
  await expect.poll(() => f.posts()).toBe(1);
  expect(patches[0].estimateHours).toBe(1.5);
  expect(patches[0].expectedEstimateHours).toBe(null);
  expect(patches[0]).not.toHaveProperty("body");
  expect(patches[0]).not.toHaveProperty("title");
  await expect(page.locator(".cm-content")).toHaveText("未保存の本文を保持");
  await page.locator("#clear-estimate-hours").click();
  await expect.poll(() => f.posts()).toBe(2);
  expect(patches[1].estimateHours).toBe(null);
  page.on("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await page.locator(".pbi-title").first().click();
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
});
test("未見積のみは達成ゼロ線を描かず、失敗は空履歴にしない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  let fail = false;
  await page.route("**/api/burndown*", (r) =>
    r.fulfill(
      fail
        ? { status: 503, json: { error: "observation_unavailable" } }
        : {
            json: {
              ...data,
              current: { ...data.current, estimated: 0, unestimated: 5 },
            },
          },
    ),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-empty")).toHaveText(
    "見積時間が未設定です（5件）。",
  );
  await expect(page.locator(".burn-chart svg")).toHaveCount(0);
  await page.keyboard.press("Escape");
  fail = true;
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-content")).toContainText(
    "記録を取得できませんでした",
  );
  await expect(page.locator(".burn-chart svg")).toHaveCount(0);
});
test("時間の連続選択は単一flight、再訪後も最新値・本文draftを保持", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  f.board.tasks[0].type = "Bug";
  let release = () => {};
  const posts: any[] = [];
  await page.route("**/api/issues/100", async (r) => {
    const patch = r.request().postDataJSON();
    posts.push(patch);
    if (posts.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    Object.assign(f.board.tasks[0], patch, {
      revision: `saved-${posts.length}`,
    });
    await r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await page.locator("#estimate-hours").fill("2");
  await page.locator("#estimate-hours").press("Enter");
  await expect.poll(() => posts.length).toBe(1);
  await page.locator("#estimate-hours").fill("3");
  await page.locator("#estimate-hours").press("Enter");
  await page.locator("#close-detail").click();
  await page.locator(".task-title").first().click();
  await expect(page.locator("#estimate-hours")).toHaveValue("3");
  release();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].expectedEstimateHours).toBe(2);
  expect(posts[1].estimateHours).toBe(3);
  expect(posts[1]).not.toHaveProperty("body");
  await expect(page.locator("#estimate-hours")).toHaveValue("3");
});
test("時間field公開失効後の遅いackは編集や値を復活させない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  let release = () => {},
    sent = false;
  await page.route("**/api/issues/100", async (r) => {
    const result = { ...f.board.tasks[0], estimateHours: 2, revision: "saved" };
    sent = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await r.fulfill({ json: { ok: true, issue: result } });
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await page.locator("#estimate-hours").fill("2");
  await page.locator("#estimate-hours").press("Enter");
  await expect.poll(() => sent).toBe(true);
  (f.board.scope as any).estimateHoursField = false;
  delete (f.board.tasks[0] as any).estimateHours;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
  release();
  await page.waitForTimeout(300);
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
  await expect(page.locator("#burndown-open")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as any).Whiteboard.getSnapshot().tasks[0].estimateHours,
    ),
  ).toBeUndefined();
});
