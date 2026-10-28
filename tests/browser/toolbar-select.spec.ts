import { test, expect, type Page } from "@playwright/test";
import { setup, chooseToolbarOption } from "./fixtures";

async function ready(page: Page) {
  const avatarReads: string[] = [];
  await page.route("https://avatars.githubusercontent.com/**", (r) => {
    avatarReads.push(r.request().url());
    return r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#3159c9"/></svg>',
    });
  });
  const f = await setup(page);
  const extra = {
    login: "user-choice",
    name: "追加担当者",
    avatarUrl: "https://avatars.githubusercontent.com/u/999",
  };
  f.board.assigneeOptions.push(extra);
  f.board.tasks[0].assignees = [extra];
  f.board.assigneeOptions.push({
    login: "unused-choice",
    name: "候補だけの担当者",
    avatarUrl: "https://avatars.githubusercontent.com/u/998",
  });
  Object.assign(f.board.scope, {
    estimateHoursField: true,
    milestones: [
      { number: 9, title: "Sprint 9" },
      { number: 10, title: "Sprint 10" },
    ],
  });
  for (const task of f.board.tasks)
    Object.assign(task, {
      estimateHours: null,
      parentId: task.lane,
      subIssueCount: 0,
    });
  await page.reload();
  await expect(page.locator("#assignee-filter-trigger")).toHaveText(
    /担当者：全員/,
  );
  await expect.poll(f.sprintReads).toBeGreaterThanOrEqual(2);
  await page.locator("#operations").click();
  return { ...f, avatarReads };
}

for (const theme of ["light", "dark"]) {
  test(`担当者はavatarと選択checkを持つrich dropdownで絞り込み、紙面/toolbar寸法を保つ ${theme}`, async ({
    page,
  }) => {
    const f = await ready(page);
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    expect(f.avatarReads.some((u) => u.includes("/u/998"))).toBe(false);
    const before = f.reads(),
      posts = f.posts();
    await page.locator("#assignee-filter-trigger").click();
    const options = page.locator("#assignee-filter-options");
    await expect(options).toBeVisible();
    await expect(options.getByRole("option")).toHaveCount(4);
    await expect(options.getByRole("option").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      options.getByRole("option").nth(2).locator("img"),
    ).toBeVisible();
    await expect
      .poll(() => f.avatarReads.some((u) => u.includes("/u/998")))
      .toBe(true);
    await page.screenshot({
      path: `test-results/toolbar-rich-${page.viewportSize()!.width}-${theme}.png`,
    });
    const box = await page.locator(".control-panel").boundingBox();
    expect(box!.height).toBeLessThanOrEqual(64.0001);
    const popup = await page
      .locator(".toolbar-select-panel:visible")
      .boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0);
    expect(popup!.x + popup!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    await options.getByRole("option").nth(2).click();
    await expect(page.locator(".task")).toHaveCount(1);
    await expect(page.locator("#assignee-filter-trigger")).toContainText(
      "追加担当者",
    );
    await chooseToolbarOption(page, "assignee-filter", "");
    await expect(page.locator(".task")).toHaveCount(102);
    expect(f.posts()).toBe(posts);
    expect(f.reads()).toBe(before);
  });
}

test("キーボード候補focusが見え、Escape取消/Enter確定/Tab移動とU・F入力分離を保つ", async ({
  page,
}) => {
  const f = await ready(page);
  const trigger = page.locator("#assignee-filter-trigger");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await expect(trigger).toHaveAttribute(
    "aria-activedescendant",
    "assignee-filter-options-3",
  );
  await expect(page.locator("#assignee-filter-options-3")).toHaveCSS(
    "background-color",
    "rgb(237, 243, 252)",
  );
  await expect(page.locator("#assignee-filter")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await page.keyboard.press("u");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#assignee-filter")).toHaveValue("user-choice");
  await expect(page.locator(".task")).toHaveCount(1);
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#milestone-filter-trigger")).toBeFocused();
  expect(f.posts()).toBe(0);
});

test("同時popupは1つ、外clickでtoolbarも閉じ、公開失効で候補/選択の旧情報を消す", async ({
  page,
}) => {
  await ready(page);
  await page.locator("#assignee-filter-trigger").click();
  await page.locator("#fit-mode-trigger").click();
  await expect(page.locator(".toolbar-select-panel:visible")).toHaveCount(1);
  await expect(page.locator("#assignee-filter-trigger")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.locator(".board-row").nth(2).locator(".cell").last().click();
  await expect(page.locator(".toolbar-select-panel:visible")).toHaveCount(0);
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.route("**/api/board", (r) =>
    r.fulfill({ status: 403, json: { error: "project_not_public" } }),
  );
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(page.locator(".task")).toHaveCount(0);
  await expect(page.locator("#assignee-filter-trigger")).toBeDisabled();
  await expect(page.locator("#assignee-filter-options")).not.toContainText(
    "追加担当者",
  );
  await expect(page.locator("#milestone-filter-options")).not.toContainText(
    "Sprint 9",
  );
});

test("選択後の再描画と画像失敗でも担当者名を維持し余分なAPIを読まない", async ({
  page,
}) => {
  const f = await ready(page);
  await page.route("https://avatars.githubusercontent.com/**", (r) =>
    r.abort(),
  );
  await chooseToolbarOption(page, "assignee-filter", "unused-choice");
  await expect(page.locator("#assignee-filter-trigger")).toContainText(
    "候補だけの担当者",
  );
  await expect(page.locator("#assignee-filter-trigger img")).toHaveCount(0);
  await page.locator("#search").fill("存在しない検索");
  await expect(page.locator("#assignee-filter-trigger")).toContainText(
    "候補だけの担当者",
  );
  await expect(page.locator("#assignee-filter")).toHaveValue("unused-choice");
  expect(f.posts()).toBe(0);
});

test("候補更新中はpopupを安全に閉じ、古いindexのEnterで別担当者へ変えない", async ({
  page,
}) => {
  await ready(page);
  const trigger = page.locator("#assignee-filter-trigger");
  await trigger.click();
  await page.keyboard.press("End");
  await page
    .locator("#assignee-filter")
    .evaluate((select: HTMLSelectElement) => {
      select.insertBefore(select.options[3], select.options[1]);
    });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#assignee-filter")).toHaveValue("");
  await page.keyboard.press("Escape");
});

test("閉時End/Homeと無効候補skip、dark候補focusの視認性を保つ", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page
    .locator("#assignee-filter")
    .evaluate((select: HTMLSelectElement) => {
      select.options[1].disabled = true;
    });
  const trigger = page.locator("#assignee-filter-trigger");
  await trigger.focus();
  await page.keyboard.press("End");
  await expect(trigger).toHaveAttribute(
    "aria-activedescendant",
    "assignee-filter-options-3",
  );
  await expect(page.locator("#assignee-filter-options-3")).toHaveCSS(
    "background-color",
    "rgb(45, 51, 62)",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Home");
  await expect(trigger).toHaveAttribute(
    "aria-activedescendant",
    "assignee-filter-options-0",
  );
  await page.keyboard.press("ArrowDown");
  await expect(trigger).toHaveAttribute(
    "aria-activedescendant",
    "assignee-filter-options-2",
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("#assignee-filter")).toHaveValue("user-choice");
});
