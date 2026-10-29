import { test, expect, type Page, type Locator } from "@playwright/test";
import { setup, chooseToolbarOption } from "./fixtures";

const board = (page: Page) => page.locator("#board");
const mode = (page: Page) => page.locator("#fit-mode");
const hint = "表示モードを切り替え（P）";
async function ready(page: Page) {
  const fixture = await setup(page);
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#fit-mode-trigger")).toHaveAttribute(
    "aria-keyshortcuts",
    "P",
  );
  await expect.poll(fixture.sprintReads).toBe(1);
  return fixture;
}
async function fit(page: Page) {
  await expect(mode(page)).toHaveValue("fit");
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator("#pagination")).toBeHidden();
}
async function pages(page: Page, last = false) {
  await expect(mode(page)).toHaveValue("pages");
  await expect(page.locator(".pbi-title")).toHaveCount(3);
  await expect(page.locator("#page-info")).toHaveText(
    last ? "PBI 4–6 / 6" : "PBI 1–3 / 6",
  );
}
async function press(page: Page) {
  await board(page).focus();
  await page.keyboard.press("p");
}
async function beginDrag(page: Page, source: Locator) {
  await expect(source).toHaveAttribute("draggable", "true");
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 3, { steps: 4 });
  await page.mouse.move(x + 18, y + 6, { steps: 4 });
  await expect(source).toHaveClass(/dragging/);
}
const storage = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .sort()
        .map((key) => [key, localStorage.getItem(key)]),
    ),
  );

test("Pひとつで全体と3PBIページを往復し、selectorと左右キーも同じ状態を使う", async ({
  page,
}) => {
  const fixture = await ready(page),
    reads = fixture.reads();
  await fit(page);
  await press(page);
  await pages(page);
  await expect(page.locator("#fit-mode-trigger")).toContainText("ページ表示");
  await page.keyboard.press("ArrowRight");
  await pages(page, true);
  await page.keyboard.press("p");
  await fit(page);
  await page.keyboard.press("p");
  await pages(page); // モード変更は既存selectと同じpage 0へ戻す。
  await page.keyboard.press("p");
  await fit(page);
  await page.locator("#operations").click();
  await chooseToolbarOption(page, "fit-mode", "pages");
  await pages(page);
  await press(page);
  await fit(page);
  await expect(page.locator("#fit-mode-trigger")).toContainText("全体を収める");
  expect(fixture.reads()).toBe(reads);
  expect(fixture.posts()).toBe(0);
});

test("切替で消える後半PBIの付箋をfocusしていてもboardへ戻り左右ページ操作を続けられる", async ({
  page,
}) => {
  const fixture = await ready(page);
  const title = page.locator('[data-open="t4-0-0"]');
  await title.focus();
  await expect(title).toBeFocused();
  await page.keyboard.press("p");
  await pages(page);
  await expect(title).toHaveCount(0);
  await expect(board(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await pages(page, true);
  await page.keyboard.press("p");
  await fit(page);
  await expect(board(page)).toBeFocused();
  const remaining = page.locator('[data-open="t1-0-0"]');
  await remaining.focus();
  await page.keyboard.press("p");
  await pages(page);
  await expect(remaining).toBeFocused(); // 残る同一Issueのfocusは奪わない。
  await page.keyboard.press("p");
  await fit(page);
  await expect(remaining).toBeFocused();
  expect(fixture.posts()).toBe(0);
});

test("背景GET中もPは表示だけを切替え、応答・resizeで戻らず既存prefsとreload既定を保つ", async ({
  page,
}) => {
  const fixture = await ready(page);
  await page.locator("#operations").click();
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const saved = await storage(page);
  expect(
    Object.keys(saved).some((key) =>
      key.startsWith("idea-boost-whiteboard-display-v1:"),
    ),
  ).toBe(true);
  expect(saved["ideaboost-theme"]).toBe("dark");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let refreshing = false;
  await page.route("**/api/board", async (route) => {
    refreshing = true;
    await gate;
    await route.fulfill({ json: fixture.board });
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => refreshing).toBe(true);
    await expect(board(page)).toHaveAttribute("aria-busy", "true");
    await press(page);
    await pages(page);
    release();
    await expect(board(page)).toHaveAttribute("aria-busy", "false");
    await pages(page);
    await page.setViewportSize({
      width: page.viewportSize()!.width,
      height: page.viewportSize()!.height - 100,
    });
    await pages(page);
    expect(await storage(page)).toEqual(saved);
    await page.reload();
    await fit(page); // 新しい永続化仕様を足さず、従来のreload既定を維持。
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await storage(page)).toEqual(saved);
    expect(fixture.posts()).toBe(0);
  } finally {
    release();
  }
});

test("入力・native control・IME・修飾・repeat・処理済みkeyを奪わない", async ({
  page,
}) => {
  const fixture = await ready(page);
  const results = await board(page).evaluate((el) => {
    const variants = [
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { isComposing: true },
    ];
    return variants.map((props) => {
      const event = new KeyboardEvent("keydown", {
        key: "p",
        bubbles: true,
        cancelable: true,
        ...props,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
  });
  expect(results).toEqual([false, false, false, false, false, false]);
  await fit(page);
  await board(page).evaluate((el) => {
    const event = new KeyboardEvent("keydown", {
      key: "p",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    el.dispatchEvent(event);
  });
  await fit(page);
  for (const kind of [
    "input",
    "textarea",
    "select",
    "combobox",
    "contenteditable",
    "codemirror",
  ]) {
    await board(page).evaluate((el, type) => {
      const node = document.createElement(
        ["input", "textarea", "select"].includes(type) ? type : "div",
      );
      node.id = "fit-shortcut-control";
      node.tabIndex = 0;
      node.style.cssText =
        "position:absolute;left:350px;top:250px;width:160px;height:32px;background:white;z-index:4";
      if (type === "select") node.append(new Option("page native", "native"));
      if (type === "combobox") node.setAttribute("role", "combobox");
      if (type === "contenteditable") node.contentEditable = "true";
      if (type === "codemirror") node.className = "cm-editor";
      el.append(node);
    }, kind);
    await page.locator("#fit-shortcut-control").focus();
    await page.keyboard.press("p");
    await fit(page);
    await page.locator("#fit-shortcut-control").evaluate((el) => el.remove());
  }
  // compositionフラグの経路はDOMイベントで検証。実OSのIME操作同等とはしない。
  await page.locator("#detail-title").dispatchEvent("compositionstart");
  await press(page);
  await fit(page);
  await page.locator("#detail-title").dispatchEvent("compositionend");
  await press(page);
  await pages(page);
  expect(fixture.posts()).toBe(0);
});

test("Issue modal・toolbar dropdown・native popover中はPで背後を切替えない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#details")).toBeVisible();
  await page.locator("#close-detail").focus(); // 入力guardではなくdialog自体のguardを通す。
  await page.keyboard.press("p");
  await board(page).dispatchEvent("keydown", { key: "p", bubbles: true });
  await expect(mode(page)).toHaveValue("fit");
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  await page.locator("#operations").click();
  await page.locator("#fit-mode-trigger").focus();
  await page.keyboard.press("p"); // 閉じたcomboboxは既存typeaheadとして扱う。
  await expect(page.locator("#fit-mode-options")).toBeVisible();
  await expect(page.locator("#fit-mode-trigger")).toBeFocused();
  await fit(page);
  await page.keyboard.press("p");
  await board(page).dispatchEvent("keydown", { key: "p", bubbles: true });
  await fit(page);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const popup = document.createElement("div");
    popup.id = "fit-shortcut-popover";
    popup.setAttribute("popover", "auto");
    const button = document.createElement("button");
    button.textContent = "合成popover";
    popup.append(button);
    document.body.append(popup);
    popup.showPopover();
    button.focus();
  });
  await page.keyboard.press("p");
  await board(page).dispatchEvent("keydown", { key: "p", bubbles: true });
  await fit(page);
  await page.locator("#fit-shortcut-popover").evaluate((el: HTMLElement) => {
    el.hidePopover();
    el.remove();
  });
  await press(page);
  await pages(page);
  expect(fixture.posts()).toBe(0);
});

test("native drag中のPはgesture/DOMを壊さず外側release後は通常toggleできる", async ({
  page,
}) => {
  const fixture = await ready(page),
    source = page.locator('[data-task="t1-0-0"]');
  try {
    await beginDrag(page, source);
    await source.evaluate((el) => (el.dataset.retained = "native-drag"));
    await page.keyboard.press("p");
    // native browserがdrag中の文字keyを配送しない場合もapp側guardを直接通す。
    await board(page).dispatchEvent("keydown", { key: "p", bubbles: true });
    await fit(page);
    await expect(source).toHaveClass(/dragging/);
    await expect(source).toHaveAttribute("data-retained", "native-drag");
    await page.mouse.move(2, page.viewportSize()!.height - 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".dragging,.drag-over")).toHaveCount(0);
    await press(page);
    await pages(page);
    expect(fixture.posts()).toBe(0);
  } finally {
    await page.mouse.up();
  }
});

test("disabled selectorと公開失効後の未接続状態ではPを実行しない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await mode(page).evaluate((el: HTMLSelectElement) => (el.disabled = true));
  await press(page);
  await fit(page);
  await mode(page).evaluate((el: HTMLSelectElement) => (el.disabled = false));
  await page.route("**/api/board", (route) =>
    route.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  await press(page);
  await expect(mode(page)).toHaveValue("fit");
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  expect(fixture.posts()).toBe(0);
});

test("既存表示密度triggerの即時tooltipだけにPを示し、新しいbuttonや常設説明を足さない", async ({
  page,
}) => {
  const fixture = await ready(page),
    reads = fixture.reads();
  await page.locator("#operations").click();
  const trigger = page.locator("#fit-mode-trigger");
  await expect(trigger).toHaveAccessibleName("ボードの表示密度");
  await expect(trigger).toHaveAttribute("data-tooltip", hint);
  await expect(mode(page).locator("option")).toHaveText([
    "全体を収める",
    "ページ表示",
  ]);
  await trigger.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toHaveText(hint);
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await page.screenshot({
    path: `test-results/fit-mode-shortcut-hint-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  expect(fixture.reads()).toBe(reads);
  expect(fixture.posts()).toBe(0);
});
