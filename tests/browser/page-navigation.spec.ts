import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const board = (page: Page) => page.locator("#board");
const firstPage = (page: Page) =>
  expect(page.locator("#page-info")).toHaveText("PBI 1–3 / 6");
const secondPage = (page: Page) =>
  expect(page.locator("#page-info")).toHaveText("PBI 4–6 / 6");
async function chooseMode(page: Page, name: string) {
  await page.locator("#operations").click();
  await page.locator("#fit-mode-trigger").click();
  await page
    .locator("#fit-mode-options")
    .getByRole("option", { name, exact: true })
    .click();
}
async function pages(page: Page) {
  const f = await setup(page);
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  await chooseMode(page, "ページ表示");
  await expect(page.locator(".pbi-title")).toHaveCount(3);
  await firstPage(page);
  // A real background click dismisses the toolbar and scopes keyboard paging.
  const cell = (await page.locator(".task-cell").first().boundingBox())!;
  await page.mouse.click(cell.x + 2, cell.y + cell.height / 2);
  await expect(board(page)).toBeFocused();
  return f;
}
async function taskPointer(page: Page) {
  // Native vertical/diagonal wheel may have scrolled the first card out of its
  // cell. hover() scrolls it into view and verifies the hit target; a raw bounding
  // box still has coordinates for clipped cards and can move outside the board.
  await page.locator(".task-title").first().hover();
}
const quiet = (page: Page) => page.waitForTimeout(330);

test("page mode always shows three PBIs at every viewport, keeps six in fit and clamps without wrapping", async ({
  page,
}) => {
  const f = await pages(page),
    reads = f.reads();
  await page.locator("#next-page").click();
  await secondPage(page);
  await expect(page.locator(".pbi-title").first()).toContainText("4");
  await expect(page.locator("#next-page")).toBeDisabled();
  await page.setViewportSize({ width: 1920, height: 720 });
  await expect(page.locator(".pbi-title")).toHaveCount(3);
  await secondPage(page);
  await board(page).focus();
  await page.keyboard.press("ArrowRight");
  await secondPage(page);
  await page.keyboard.press("ArrowLeft");
  await firstPage(page);
  await expect(page.locator("#prev-page")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await firstPage(page);
  await chooseMode(page, "全体を収める");
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator("#pagination")).toBeHidden();
  await board(page).focus();
  await page.keyboard.press("ArrowRight");
  await taskPointer(page);
  await page.mouse.wheel(200, 0);
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  expect(f.reads()).toBe(reads);
  expect(f.posts()).toBe(0);
});

test("real board Arrow keys page once, ignore repeats and leave native controls and outside focus alone", async ({
  page,
}) => {
  const f = await pages(page);
  await page.keyboard.press("ArrowRight");
  await secondPage(page);
  await expect(board(page)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await firstPage(page);
  await board(page).dispatchEvent("keydown", {
    key: "ArrowRight",
    repeat: true,
  });
  await firstPage(page);
  await page.locator(".task-title").first().focus();
  await page.keyboard.press("ArrowRight");
  await firstPage(page);
  await page.locator("#operations").focus();
  await page.keyboard.press("ArrowRight");
  await firstPage(page);
  await board(page).evaluate((el) => {
    const input = document.createElement("input");
    input.id = "navigation-editable";
    input.value = "editable";
    el.append(input);
  });
  await page.locator("#navigation-editable").focus();
  await page.keyboard.press("ArrowRight");
  await firstPage(page);
  await page.locator("#navigation-editable").evaluate((el) => el.remove());
  await board(page).evaluate((el) => {
    const editor = document.createElement("div");
    editor.id = "navigation-contenteditable";
    editor.contentEditable = "true";
    editor.textContent = "編集中";
    el.append(editor);
  });
  await page.locator("#navigation-contenteditable").focus();
  await page.keyboard.press("ArrowRight");
  await firstPage(page);
  expect(f.posts()).toBe(0);
});

test("trackpad-style real horizontal wheel uses threshold and one page for a long inertia session including reversals", async ({
  page,
}) => {
  const f = await pages(page);
  await taskPointer(page);
  await page.mouse.wheel(30, 0);
  await firstPage(page);
  await page.mouse.wheel(30, 0);
  await firstPage(page);
  await page.mouse.wheel(30, 0);
  await secondPage(page);
  for (let i = 0; i < 14; i++) {
    await page.mouse.wheel(i < 7 ? 24 : -28, 1);
    await page.waitForTimeout(40);
  }
  await secondPage(page);
  // The previous button remains usable, but a remaining tail must not page again.
  await page.locator("#prev-page").click();
  await taskPointer(page);
  await page.mouse.wheel(120, 0);
  await firstPage(page);
  await quiet(page);
  await page.mouse.wheel(120, 0);
  await secondPage(page);
  await quiet(page);
  await page.mouse.wheel(-120, 0);
  await firstPage(page);
  expect(f.posts()).toBe(0);
});

test("vertical/diagonal/modified gestures stay native and a new horizontal session still works", async ({
  page,
}) => {
  await pages(page);
  await taskPointer(page);
  await page.mouse.wheel(0, 160);
  await page.mouse.wheel(200, 0); // Same session began vertically: no intent switch.
  await firstPage(page);
  await quiet(page);
  await page.mouse.wheel(100, 90);
  await firstPage(page);
  const results = await board(page).evaluate((el) =>
    ["ctrlKey", "metaKey", "altKey", "shiftKey"].map((key) => {
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 200,
        [key]: true,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(results).toEqual([false, false, false, false]);
  await firstPage(page);
  await quiet(page);
  await taskPointer(page);
  await page.mouse.wheel(120, 20);
  await secondPage(page);
});

test("nested horizontal scrollers keep their wheel and arrow behavior even at their boundary", async ({
  page,
}) => {
  await pages(page);
  await board(page).evaluate((el) => {
    const scroll = document.createElement("div");
    scroll.id = "navigation-scroller";
    scroll.tabIndex = 0;
    scroll.style.cssText =
      "position:absolute;left:400px;top:300px;width:180px;height:80px;overflow-x:auto;z-index:4;background:white";
    const inner = document.createElement("div");
    inner.style.cssText = "width:1200px;height:50px";
    inner.textContent = "横スクロール領域";
    scroll.append(inner);
    el.append(scroll);
  });
  await page.locator("#navigation-scroller").hover();
  await page.mouse.wheel(150, 0);
  await expect
    .poll(() =>
      page.locator("#navigation-scroller").evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
  await firstPage(page);
  await page.locator("#navigation-scroller").focus();
  await page.keyboard.press("ArrowRight");
  await firstPage(page);
  await page.locator("#navigation-scroller").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await quiet(page);
  await page.mouse.wheel(200, 0);
  await firstPage(page);
  await page.locator("#navigation-scroller").evaluate((el) => el.remove());
  await page.setViewportSize({ width: 800, height: 720 });
  await quiet(page);
  await taskPointer(page);
  await page.mouse.wheel(150, 0);
  await firstPage(page);
  await expect
    .poll(() => page.locator("#board-scroll").evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
});

test("modal, toolbar popover and drag prevent accidental paging; closing detail restores navigation", async ({
  page,
}) => {
  const f = await pages(page);
  await page.locator(".task-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  // The board is inert under a modal; dispatch verifies the global guard too.
  await board(page).dispatchEvent("wheel", {
    deltaX: 200,
    cancelable: true,
    bubbles: true,
  });
  await firstPage(page);
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  await board(page).focus();
  await page.keyboard.press("ArrowRight");
  await secondPage(page);
  await page.keyboard.press("ArrowLeft");
  await firstPage(page);
  await page.locator("#operations").click();
  await page.locator("#fit-mode-trigger").click();
  await expect(page.locator("#fit-mode-options")).toBeVisible();
  await board(page).dispatchEvent("wheel", {
    deltaX: 200,
    cancelable: true,
    bubbles: true,
  });
  await firstPage(page);
  await page.keyboard.press("Escape");
  await board(page).focus();
  await board(page).dispatchEvent("dragstart", { bubbles: true });
  await page.keyboard.press("ArrowRight");
  await board(page).dispatchEvent("wheel", {
    deltaX: 200,
    cancelable: true,
    bubbles: true,
  });
  await firstPage(page);
  await board(page).dispatchEvent("dragend", { bubbles: true });
  await quiet(page);
  await page.keyboard.press("ArrowRight");
  await secondPage(page);
  expect(f.posts()).toBe(0);
});

test("display selection and search retain existing page reset and clamp without changing Issue data", async ({
  page,
}) => {
  const f = await pages(page);
  await page.locator("#next-page").click();
  await secondPage(page);
  await page.locator("#operations").click();
  await page.locator("#search").fill("共有");
  await firstPage(page);
  await page.locator("#choose-pbis").click();
  await page.locator("#pbi-clear").click();
  await page.locator("#pbi-options input").nth(0).check();
  await page.locator("#pbi-options input").nth(1).check();
  await page.locator("#pbi-apply").click();
  await expect(page.locator(".pbi-title")).toHaveCount(2);
  await expect(page.locator("#page-info")).toHaveText("PBI 1–2 / 2");
  await expect(page.locator("#pagination")).toBeHidden();
  await board(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".pbi-title")).toHaveCount(2);
  expect(f.posts()).toBe(0);
});
