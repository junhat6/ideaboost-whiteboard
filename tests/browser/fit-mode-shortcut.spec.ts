import { test, expect, type Page, type Locator } from "@playwright/test";
import { setup, chooseToolbarOption } from "./fixtures";

const board = (page: Page) => page.locator("#board");
const mode = (page: Page) => page.locator("#fit-mode");
async function ready(page: Page) {
  const fixture = await setup(page);
  await expect(board(page)).toHaveAttribute("tabindex", "0");
  await expect(page.locator("#fit-mode-trigger")).toHaveAttribute(
    "aria-keyshortcuts",
    "N P",
  );
  await expect.poll(fixture.sprintReads).toBe(1);
  return fixture;
}
async function rows(
  page: Page,
  value: number | "all",
  count = value === "all" ? 6 : value,
  range?: string,
) {
  await expect(mode(page)).toHaveValue(String(value));
  await expect(page.locator(".pbi-title")).toHaveCount(count);
  if (range) await expect(page.locator("#page-info")).toHaveText(range);
}
async function press(page: Page, key: "n" | "p") {
  await board(page).focus();
  await page.keyboard.press(key);
}
async function chooseRows(page: Page, value: number | "all") {
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) !== "true"
  )
    await page.locator("#operations").click();
  await chooseToolbarOption(page, "fit-mode", String(value));
  await board(page).focus();
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

// 旧fit/pages切替ではなく、Nは1件減、Pは1件増。6件は管理対象の上限ではない。
test("N/Pは1〜6〜Allを順に切替え、両端でwrapせずselectorも同期する", async ({
  page,
}) => {
  const fixture = await ready(page),
    reads = fixture.reads();
  await rows(page, 6);
  await board(page).focus();
  for (const count of [5, 4, 3, 2, 1]) {
    await page.keyboard.press("n");
    await rows(page, count, count, `PBI 1–${count} / 6`);
  }
  await page.keyboard.press("n");
  await rows(page, 1);
  for (const count of [2, 3, 4, 5, 6]) {
    await page.keyboard.press("p");
    await rows(page, count, count, `PBI 1–${count} / 6`);
  }
  await page.keyboard.press("p");
  await rows(page, "all");
  await page.keyboard.press("p");
  await rows(page, "all");
  await page.keyboard.press("n");
  await rows(page, 6);
  await expect(page.locator("#pagination")).toBeHidden();
  await chooseRows(page, 3);
  await rows(page, 3);
  await page.keyboard.press("ArrowRight");
  await rows(page, 3, 3, "PBI 4–6 / 6");
  await page.keyboard.press("p");
  await rows(page, 4, 4, "PBI 1–4 / 6"); // 先頭だったp3を含むページへ。
  expect(fixture.reads()).toBe(reads);
  expect(fixture.posts()).toBe(0);
});

test("AllからPは上限、Nは6件へ戻り付箋focusを維持する", async ({ page }) => {
  const fixture = await ready(page);
  await chooseRows(page, 3);
  await page.keyboard.press("ArrowRight");
  await rows(page, 3, 3, "PBI 4–6 / 6");
  await chooseRows(page, "all");
  await rows(page, "all");
  await expect(page.locator("#pagination")).toBeHidden();
  await press(page, "p");
  await rows(page, "all");
  await press(page, "n");
  await rows(page, 6);
  const title = page.locator('[data-open="t5-0-0"]');
  await title.focus();
  await page.keyboard.press("n");
  await rows(page, 5, 1, "PBI 6–6 / 6");
  await expect(title).toBeFocused(); // focus中のlaneはページ先頭anchorより優先。
  await page.keyboard.press("n");
  await rows(page, 4, 2, "PBI 5–6 / 6");
  await expect(title).toBeFocused();
  await board(page).focus();
  await page.keyboard.press("ArrowLeft");
  await rows(page, 4, 4, "PBI 1–4 / 6");
  expect(fixture.posts()).toBe(0);
});

test("背景GET中も表示件数だけ変更でき応答・resize・reloadで保持、管理対象とthemeを変えない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await page.locator("#operations").click();
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const saved = await storage(page);
  const management = Object.fromEntries(
    Object.entries(saved).filter(
      ([key]) => !key.startsWith("idea-boost-whiteboard-rows-v1:"),
    ),
  );
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
    await press(page, "n");
    await rows(page, 5);
    release();
    await expect(board(page)).toHaveAttribute("aria-busy", "false");
    await rows(page, 5);
    await page.setViewportSize({
      width: page.viewportSize()!.width,
      height: page.viewportSize()!.height - 100,
    });
    await rows(page, 5);
    const after = await storage(page);
    expect(
      Object.fromEntries(
        Object.entries(after).filter(
          ([key]) => !key.startsWith("idea-boost-whiteboard-rows-v1:"),
        ),
      ),
    ).toEqual(management);
    const rowValue = Object.entries(after).find(([key]) =>
      key.startsWith("idea-boost-whiteboard-rows-v1:"),
    )![1];
    expect(JSON.parse(rowValue!)).toEqual({ value: 5, lastRows: 5 });
    await page.reload();
    await rows(page, 5);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await storage(page)).toEqual(after);
    expect(fixture.posts()).toBe(0);
  } finally {
    release();
  }
});

test("N/Pは入力・native control・IME・修飾・repeat・処理済みkeyを奪わない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await chooseRows(page, 3);
  for (const key of ["n", "p"]) {
    const results = await board(page).evaluate(
      (el, key) =>
        [
          { repeat: true },
          { ctrlKey: true },
          { metaKey: true },
          { altKey: true },
          { shiftKey: true },
          { isComposing: true },
        ].map((props) => {
          const event = new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            ...props,
          });
          el.dispatchEvent(event);
          return event.defaultPrevented;
        }),
      key,
    );
    expect(results).toEqual([false, false, false, false, false, false]);
    await rows(page, 3);
    await board(page).evaluate((el, key) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      el.dispatchEvent(event);
    }, key);
    await rows(page, 3);
  }
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
    for (const key of ["n", "p"]) {
      await page.keyboard.press(key);
      await rows(page, 3);
    }
    await page.locator("#fit-shortcut-control").evaluate((el) => el.remove());
  }
  // DOM composition経路。実OSのIME同等性とは区別する。
  await page.locator("#detail-title").dispatchEvent("compositionstart");
  for (const key of ["n", "p"] as const) {
    await press(page, key);
    await rows(page, 3);
  }
  await page.locator("#detail-title").dispatchEvent("compositionend");
  await press(page, "n");
  await rows(page, 2);
  expect(fixture.posts()).toBe(0);
});

test("Issue modal・toolbar dropdown・native popover中はN/Pで背後を変更しない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await chooseRows(page, 3);
  await page.locator('[data-open="t1-0-0"]').click();
  await expect(page.locator("#details")).toBeVisible();
  await page.locator("#close-detail").focus();
  for (const key of ["n", "p"]) {
    await page.keyboard.press(key);
    await board(page).dispatchEvent("keydown", { key, bubbles: true });
    await rows(page, 3);
  }
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) !== "true"
  )
    await page.locator("#operations").click();
  await page.locator("#fit-mode-trigger").focus();
  await page.keyboard.press("p"); // 閉comboboxでは既存typeahead。
  await expect(page.locator("#fit-mode-options")).toBeVisible();
  for (const key of ["n", "p"]) {
    await page.keyboard.press(key);
    await board(page).dispatchEvent("keydown", { key, bubbles: true });
    await rows(page, 3);
  }
  await page.locator("#fit-mode-trigger").click();
  await expect(page.locator("#fit-mode-options")).toBeHidden();
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
  for (const key of ["n", "p"]) {
    await page.keyboard.press(key);
    await board(page).dispatchEvent("keydown", { key, bubbles: true });
    await rows(page, 3);
  }
  await page.locator("#fit-shortcut-popover").evaluate((el: HTMLElement) => {
    el.hidePopover();
    el.remove();
  });
  await press(page, "n");
  await rows(page, 2);
  expect(fixture.posts()).toBe(0);
});

test("native drag中のN/Pはgesture/DOMを壊さず外側release後は通常操作できる", async ({
  page,
}) => {
  const fixture = await ready(page),
    source = page.locator('[data-task="t1-0-0"]');
  await chooseRows(page, 3);
  try {
    await beginDrag(page, source);
    await source.evaluate((el) => (el.dataset.retained = "native-drag"));
    for (const key of ["n", "p"]) {
      await page.keyboard.press(key);
      // nativeがdrag中に文字を配送しない場合もapp guardを直接通す。
      await board(page).dispatchEvent("keydown", { key, bubbles: true });
      await rows(page, 3);
      await expect(source).toHaveClass(/dragging/);
      await expect(source).toHaveAttribute("data-retained", "native-drag");
    }
    await page.mouse.move(2, page.viewportSize()!.height - 2, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(".dragging,.drag-over")).toHaveCount(0);
    await press(page, "n");
    await rows(page, 2);
    expect(fixture.posts()).toBe(0);
  } finally {
    await page.mouse.up();
  }
});

test("disabled selectorと公開失効後の未接続ではN/Pを実行しない", async ({
  page,
}) => {
  const fixture = await ready(page);
  await chooseRows(page, 3);
  await mode(page).evaluate((el: HTMLSelectElement) => (el.disabled = true));
  for (const key of ["n", "p"] as const) {
    await press(page, key);
    await rows(page, 3);
  }
  await mode(page).evaluate((el: HTMLSelectElement) => (el.disabled = false));
  await page.route("**/api/board", (route) =>
    route.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  const revokedValue = await mode(page).inputValue();
  for (const key of ["n", "p"] as const) {
    await press(page, key);
    await expect(mode(page)).toHaveValue(revokedValue);
  }
  await expect(page.locator(".pbi-title")).toHaveCount(0);
  expect(fixture.posts()).toBe(0);
});

test("既存selectorのhintは6→AllとAll→6のN/P境界を示す", async ({ page }) => {
  const fixture = await ready(page),
    reads = fixture.reads();
  await page.locator("#operations").click();
  const trigger = page.locator("#fit-mode-trigger");
  await expect(trigger).toHaveAccessibleName("1ページのPBI数");
  await expect(mode(page).locator("option")).toHaveCount(7);
  expect(
    await mode(page)
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value),
      ),
  ).toEqual(["6", "5", "4", "3", "2", "1", "all"]);
  await expect(trigger).toHaveAttribute(
    "data-tooltip",
    "N：減らす / P：全体一覧",
  );
  await trigger.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.getByRole("tooltip")).toHaveText(
    (await trigger.getAttribute("data-tooltip")) || "",
  );
  await page.screenshot({
    path: `test-results/fit-mode-shortcut-count-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  await chooseToolbarOption(page, "fit-mode", "all");
  await expect(trigger).toHaveAttribute("data-tooltip", "N：6件 / P：上限");
  await page.mouse.move(0, page.viewportSize()!.height - 1);
  await trigger.hover();
  await expect(page.getByRole("tooltip")).toHaveText("N：6件 / P：上限");
  const box = (await page.getByRole("tooltip").boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({
    path: `test-results/fit-mode-shortcut-all-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  expect(fixture.reads()).toBe(reads);
  expect(fixture.posts()).toBe(0);
});
