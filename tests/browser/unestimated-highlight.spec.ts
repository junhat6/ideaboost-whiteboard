import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const toggle = (page: Page) => page.locator("#highlight-unestimated");
const card = (page: Page, id = "t0-0-0") => page.locator(`[data-task="${id}"]`);
async function expectFixedFrame(page: Page, target = card(page)) {
  const width = await page
    .locator("#board")
    .evaluate((board) =>
      board.classList.contains("dense")
        ? "1px"
        : board.classList.contains("compact")
          ? "2px"
          : "4px",
    );
  await expect(target).toHaveCSS("outline-width", width);
  await expect(target).toHaveCSS("outline-style", "solid");
}
const hour = (page: Page, value: number) =>
  page.locator(`#estimate-hours-choices button[data-value="${value}"]`);
async function ready(page: Page, options = {}) {
  const f = await setup(page, options);
  let burndownReads = 0;
  // This board has no sprint fixture. Keep an accidental chart GET out of the
  // shared Issue mutation handler, but count it so no test can hide the request.
  await page.route(/\/api\/burndown(?:\?.*)?$/, (route) => {
    expect(route.request().method()).toBe("GET");
    burndownReads++;
    return route.fulfill({
      status: 404,
      json: { error: "sprint_unavailable" },
    });
  });
  (f.board.scope as any).estimateHoursField = true;
  for (const task of f.board.tasks)
    Object.assign(task, { subIssueCount: 0, parentId: task.lane });
  (f.board.tasks[0] as any).estimateHours = null;
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(toggle(page)).toBeAttached();
  return { ...f, burndownReads: () => burndownReads };
}
async function shortcut(page: Page) {
  await page.locator("#operations").focus();
  await page.keyboard.press("u");
}

test("未見積強調は初期OFF、確定nullの末端作業だけを型色を保って強調し通信を増やさない", async ({
  page,
}) => {
  const f = await ready(page);
  const t = f.board.tasks as any[];
  t[1].estimateHours = 0;
  t[3].estimateHours = null;
  t[3].type = "PBI";
  t[4].estimateHours = null;
  t[4].subIssueCount = 2;
  t[5].estimateHours = null;
  t[5].type = "競合調査";
  t[6].estimateHours = null;
  delete t[6].subIssueCount;
  t[8].estimateHours = null;
  t[8].state = "CLOSED";
  t[8].stateReason = "NOT_PLANNED";
  t[9].estimateHours = null;
  t[9].type = "Bug";
  // The seventh, unselected PBI must not acquire an on-board marker.
  t.find((i) => i.lane === "p6").estimateHours = null;
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  const reads = f.reads(),
    posts = f.posts();
  const fill = await card(page).evaluate(
    (n) => getComputedStyle(n).backgroundColor,
  );
  await shortcut(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".unestimated-highlight")).toHaveCount(3);
  for (const task of [t[0], t[5], t[9]]) {
    await expect(card(page, task.id)).toHaveClass(/unestimated-highlight/);
    await expect(card(page, task.id).locator(".unestimated-cue")).toHaveText(
      "未見積",
    );
  }
  for (const task of [t[1], t[2], t[3], t[4], t[6], t[8]])
    await expect(card(page, task.id)).not.toHaveClass(/unestimated-highlight/);
  expect(
    await card(page).evaluate((n) => getComputedStyle(n).backgroundColor),
  ).toBe(fill);
  await expect(card(page)).toHaveClass(/unestimated-visible/);
  await expectFixedFrame(page);
  await expect(card(page).locator(".unestimated-cue")).toHaveCSS(
    "background-color",
    "rgb(49, 89, 201)",
  );
  await expect
    .poll(() =>
      card(page).evaluate((n) => getComputedStyle(n, "::after").animationName),
    )
    .toBe("unestimated-breathe");
  await shortcut(page);
  await expect(
    page.locator(".unestimated-highlight, .unestimated-cue"),
  ).toHaveCount(0);
  expect(f.reads()).toBe(reads);
  expect(f.posts()).toBe(posts);
  expect(f.burndownReads()).toBe(0);
});

test("操作barと未見積toggleの通常clickは右端hoverのchartを誤展開しない", async ({
  page,
}) => {
  const f = await ready(page);
  await page.locator("#operations").click();
  // Deliberately stay over the right-edge control beyond the 180ms hover delay.
  await page.waitForTimeout(250);
  expect(f.burndownReads()).toBe(0);
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await page.waitForTimeout(250);
  expect(f.burndownReads()).toBe(0);
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(f.posts()).toBe(0);
});

test("hover用moduleの遅延中に操作barへ移動したらchartを開かず、明示buttonは引き続き開く", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let moduleRequests = 0;
  await page.route("**/burndown.js", async (route) => {
    moduleRequests++;
    await gate;
    await route.continue();
  });
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await expect.poll(() => moduleRequests).toBe(1);
  await page.locator("#operations").click();
  const moduleResponse = page.waitForResponse("**/burndown.js");
  release();
  await (await moduleResponse).finished();
  // Let the real module evaluate and the pending hover continuation settle.
  await page.waitForTimeout(250);
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  expect(f.burndownReads()).toBe(0);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await expect.poll(f.burndownReads).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  expect(f.posts()).toBe(0);
});

test("hover用moduleの遅延中でもchartbuttonの明示clickは失わない", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let moduleRequests = 0;
  await page.route("**/burndown.js", async (route) => {
    moduleRequests++;
    await gate;
    await route.continue();
  });
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await expect.poll(() => moduleRequests).toBe(1);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  expect(f.burndownReads()).toBe(0);
  release();
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await expect.poll(f.burndownReads).toBe(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  expect(f.posts()).toBe(0);
});

test("Uは入力・IME・修飾・repeat・dialog内では動かず、toggleはkeyboardと即時tooltipで操作できる", async ({
  page,
}) => {
  const f = await ready(page);
  await page.locator("#operations").click();
  await toggle(page).hover();
  await expect(toggle(page)).toHaveAttribute(
    "data-tooltip",
    "未見積を強調（U）",
  );
  await toggle(page).focus();
  await page.keyboard.press("Space");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.locator("#search").fill("");
  await page.locator("#search").press("u");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.locator("#search").fill("");
  await page.locator("#operations").focus();
  await page.evaluate(() => {
    for (const options of [
      { isComposing: true },
      { repeat: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
    ])
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "u", bubbles: true, ...options }),
      );
    const input = document.createElement("div");
    input.id = "shortcut-writing-fixture";
    input.contentEditable = "true";
    document.body.append(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", bubbles: true }),
    );
    input.remove();
  });
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await card(page).locator(".task-title").click();
  await page.locator("#close-detail").focus();
  await page.keyboard.press("u");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.locator("#close-detail").click();
  await shortcut(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect(f.burndownReads()).toBe(0);
});

test("見積の保存ackまでは強調を保持し、成功で解除・不明な失敗でcanonical未見積を保持する", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let posted = 0;
  await page.route("**/api/issues/100", async (r) => {
    expect(r.request().method()).toBe("POST");
    expect(r.request().postDataJSON()).toMatchObject({
      estimateHours: 4,
      expectedEstimateHours: null,
    });
    posted++;
    await gate;
    Object.assign(f.board.tasks[0], {
      estimateHours: 4,
      revision: "saved-hours",
    });
    await r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await shortcut(page);
  await card(page).locator(".task-title").click();
  await hour(page, 4).click();
  await expect.poll(() => posted).toBe(1);
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  release();
  await expect(card(page)).not.toHaveClass(/unestimated-highlight/);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#close-detail").click();
  await page.unroute("**/api/issues/100");
  (f.board.tasks[0] as any).estimateHours = null;
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await page.route("**/api/issues/100", (r) => {
    expect(r.request().method()).toBe("POST");
    expect(r.request().postDataJSON()).toMatchObject({
      estimateHours: 2,
      expectedEstimateHours: null,
    });
    return r.fulfill({
      status: 502,
      json: { error: "github_unavailable", ambiguous: true },
    });
  });
  await card(page).locator(".task-title").click();
  await hour(page, 2).click();
  await expect(page.locator("#detail-error")).toBeVisible();
  await expect(hour(page, 2)).toHaveAttribute("aria-pressed", "true");
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  expect(f.burndownReads()).toBe(0);
});

test("通常再取得中は確認済みnullの枠が途切れず、値不明と公開失効は正しく反映する", async ({
  page,
}) => {
  const f = await ready(page);
  await shortcut(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (r) => {
    await gate;
    await r.fulfill({ json: f.board });
  });
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await expectFixedFrame(page);
  release();
  await expect(toggle(page)).toBeEnabled();
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await page.unroute("**/api/board");
  delete (f.board.tasks[0] as any).estimateHours;
  await page.locator("#refresh").click();
  await expect(card(page)).not.toHaveClass(/unestimated-highlight/);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  (f.board.tasks[0] as any).estimateHours = null;
  await page.locator("#refresh").click();
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  (f.board.scope as any).estimateHoursField = false;
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
  (f.board.scope as any).estimateHoursField = true;
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await toggle(page).click();
  await page.route("**/api/board", (r) =>
    r.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await page.locator("#refresh").click();
  await expect(page.locator("[data-task]")).toHaveCount(0);
  await expect(toggle(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  expect(f.burndownReads()).toBe(0);
});

test("overflow移動・検索・再描画でも強調が保たれ、非表示付箋ではanimationを動かさない", async ({
  page,
}) => {
  const f = await ready(page);
  for (const task of f.board.tasks.slice(0, 5))
    (task as any).estimateHours = null;
  f.board.tasks[4].title = "奥にある未見積の付箋";
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await shortcut(page);
  await expect(page.locator(".unestimated-highlight")).toHaveCount(5);
  const fifth = card(page, f.board.tasks[4].id);
  // Wait for the initial observer delivery before testing a 0 → visible change.
  await expect(card(page)).toHaveClass(/unestimated-visible/);
  await expect(fifth).not.toHaveClass(/unestimated-visible/);
  // Use the card's own viewport rather than depending on a visual scroll offset.
  const actualPort = fifth.locator(
    "xpath=ancestor::*[contains(@class,'cell-viewport')]",
  );
  await actualPort.focus();
  await expect(actualPort).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(actualPort.locator("..").locator(".cell-range")).toHaveText(
    "5–5 / 5",
  );
  // Verify the real scroll/clip geometry independently from the observer class.
  await expect
    .poll(() =>
      fifth.evaluate((element) => {
        const card = element.getBoundingClientRect();
        const port = element.closest(".cell-viewport")!.getBoundingClientRect();
        return (
          Math.min(card.bottom, port.bottom) - Math.max(card.top, port.top)
        );
      }),
    )
    .toBeGreaterThan(1);
  await expect(fifth).toHaveClass(/unestimated-visible/);
  await expect(card(page)).not.toHaveClass(/unestimated-visible/);
  await page.keyboard.press("PageUp");
  await expect(actualPort.locator("..").locator(".cell-range")).toHaveText(
    "1–4 / 5",
  );
  await expect(card(page)).toHaveClass(/unestimated-visible/);
  await expect(fifth).not.toHaveClass(/unestimated-visible/);
  await page.keyboard.press("PageDown");
  await expect(fifth).toHaveClass(/unestimated-visible/);
  await expect(card(page)).not.toHaveClass(/unestimated-visible/);
  await page.locator("#operations").click();
  await page.locator("#search").fill("奥にある未見積");
  await expect(page.locator("[data-task]")).toHaveCount(1);
  await expect(fifth).toHaveClass(/unestimated-highlight/);
  await page.locator("#search").fill("");
  await expect(page.locator(".unestimated-highlight")).toHaveCount(5);
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});

test("動きの軽減設定では穏やかな強調も静止し、scope変更でOFFへ戻る", async ({
  page,
}) => {
  const f = await ready(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await shortcut(page);
  await expect(card(page)).toHaveClass(/unestimated-visible/);
  expect(
    await card(page).evaluate(
      (n) => getComputedStyle(n, "::after").animationName,
    ),
  ).toBe("none");
  expect(
    await card(page).evaluate((n) => getComputedStyle(n).outlineStyle),
  ).toBe("solid");
  (f.board.scope as any).viewFilter = "different verified view scope";
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
  expect(f.burndownReads()).toBe(0);
});

test("確認済み0件は明示ON時だけ通知し、0h・親・PBI・対象外と未選択PBIを混同しない", async ({
  page,
}) => {
  const f = await ready(page);
  for (const task of f.board.tasks) (task as any).estimateHours = 0;
  Object.assign(f.board.tasks[1], { estimateHours: null, subIssueCount: 2 });
  Object.assign(f.board.tasks[2], { estimateHours: null, type: "PBI" });
  Object.assign(f.board.tasks[3], {
    estimateHours: null,
    state: "CLOSED",
    stateReason: "NOT_PLANNED",
  });
  Object.assign(f.board.tasks[4], { estimateHours: null, projectItemId: null });
  Object.assign(
    f.board.tasks.find((task) => task.lane === "p6")!,
    {
      estimateHours: null,
    },
  );
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.clock.install();
  await shortcut(page);
  await expect(page.locator("#announcement.visible")).toHaveText(
    "未見積もりのタスクは0件です",
  );
  await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
  await page.clock.fastForward(4600);
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeEnabled();
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  await shortcut(page);
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  await shortcut(page);
  await expect(page.locator("#announcement.visible")).toHaveText(
    "未見積もりのタスクは0件です",
  );
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});

for (const unknown of ["estimateHours", "subIssueCount", "projectItemId"]) {
  test(`表示対象の${unknown}が未取得なら0件と断定しない`, async ({ page }) => {
    const f = await ready(page);
    for (const task of f.board.tasks) (task as any).estimateHours = 0;
    delete (f.board.tasks[0] as any)[unknown];
    await page.reload();
    await expect(page.locator(".pbi-title")).toHaveCount(6);
    await shortcut(page);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
    await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
    expect(f.posts()).toBe(0);
    expect(f.burndownReads()).toBe(0);
  });
}

test("overflowで隠れた未見積も0件扱いせず、PBI選択後もONと固定枠を保持する", async ({
  page,
}) => {
  const f = await ready(page);
  for (const task of f.board.tasks) (task as any).estimateHours = 0;
  (f.board.tasks[4] as any).estimateHours = null;
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await shortcut(page);
  await expect(card(page, "t0-0-4")).toHaveClass(/unestimated-highlight/);
  await expect(card(page, "t0-0-4")).not.toHaveClass(/unestimated-visible/);
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  await page.locator("#pbi-clear").click();
  await page.locator("#pbi-options input").nth(0).check();
  await page.locator("#pbi-apply").click();
  await expect(page.locator(".pbi-title")).toHaveCount(1);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(card(page, "t0-0-4")).toHaveClass(/unestimated-highlight/);
  await expectFixedFrame(page, card(page, "t0-0-4"));
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  expect(f.posts()).toBe(0);
});

test("読取中と取得失敗後は0件通知を出さない", async ({ page }) => {
  const f = await ready(page);
  for (const task of f.board.tasks) (task as any).estimateHours = 0;
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/board", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { error: "github_unavailable" } });
  });
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeDisabled();
  await shortcut(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#announcement")).not.toHaveClass(/visible/);
  release();
  await expect(toggle(page)).toBeEnabled();
  await shortcut(page);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#announcement")).not.toHaveText(
    "未見積もりのタスクは0件です",
  );
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});

test("drag中も固定枠を保ち、終了後に補助pulseだけ復帰する", async ({
  page,
}) => {
  const f = await ready(page);
  await shortcut(page);
  await expect(card(page)).toHaveClass(/unestimated-visible/);
  await card(page).evaluate((element) => {
    element.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      }),
    );
  });
  await expect(card(page)).toHaveClass(/dragging/);
  await expectFixedFrame(page);
  expect(
    await card(page).evaluate(
      (element) => getComputedStyle(element, "::after").animationName,
    ),
  ).toBe("none");
  await card(page).dispatchEvent("dragend");
  await expect(card(page)).not.toHaveClass(/dragging/);
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      card(page).evaluate(
        (element) => getComputedStyle(element, "::after").animationName,
      ),
    )
    .toBe("unestimated-breathe");
  expect(f.posts()).toBe(0);
});

test("未見積の固定枠と種類色をlight・darkの実pixel資料に残す", async ({
  page,
}) => {
  const f = await ready(page);
  for (const task of f.board.tasks) (task as any).estimateHours = 4;
  for (const index of [0, 5, 9, 17, 51])
    (f.board.tasks[index] as any).estimateHours = null;
  f.board.tasks[5].type = "競合調査";
  f.board.tasks[9].type = "Bug";
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await shortcut(page);
  await expect(page.locator(".unestimated-highlight")).toHaveCount(5);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.locator("#operations").click();
      await page.locator("#theme").click();
      await page.locator("#operations").click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectFixedFrame(page);
    await expect(card(page)).toHaveCSS(
      "background-color",
      theme === "light" ? "rgb(251, 223, 127)" : "rgb(85, 71, 34)",
    );
    await page.mouse.move(900, 700);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `test-results/unestimated-highlight-${page.viewportSize()!.width}-${theme}.png`,
      animations: "disabled",
    });
  }
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});

for (const metadata of [undefined, "true"]) {
  test(`見積fieldmetadataが${String(metadata)}ならnullが残っていても強調を解除する`, async ({
    page,
  }) => {
    const f = await ready(page);
    await shortcut(page);
    await expect(card(page)).toHaveClass(/unestimated-highlight/);
    (f.board.scope as any).estimateHoursField = metadata;
    await page.locator("#operations").click();
    await page.locator("#refresh").click();
    await expect(toggle(page)).toBeHidden();
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
    await expect(page.locator("#announcement")).not.toHaveText(
      "未見積もりのタスクは0件です",
    );
    expect(f.posts()).toBe(0);
  });
}

test("公開field読取の403は以前のnullを強調せず、復旧後も勝手にONに戻さない", async ({
  page,
}) => {
  const f = await ready(page);
  await shortcut(page);
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  await page.route("**/api/board", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "estimate_hours_not_public" },
    }),
  );
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".unestimated-highlight")).toHaveCount(0);
  await page.unroute("**/api/board");
  await page.locator("#refresh").click();
  await expect(toggle(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await shortcut(page);
  await expect(card(page)).toHaveClass(/unestimated-highlight/);
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});

test("多数の小さい付箋でも固定枠とlabelはtitle・担当者の領域を圧迫せず枠を内側に収める", async ({
  page,
}) => {
  const f = await ready(page);
  for (const task of f.board.tasks) (task as any).estimateHours = null;
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
  });
  const geometry = () =>
    page.locator("#board [data-task]").evaluateAll((elements) =>
      elements.map((element) => ({
        id: (element as HTMLElement).dataset.task,
        card: element.getBoundingClientRect().toJSON(),
        title: element
          .querySelector(".task-title")!
          .getBoundingClientRect()
          .toJSON(),
        person: element
          .querySelector(".person")!
          .getBoundingClientRect()
          .toJSON(),
        font: getComputedStyle(element.querySelector(".task-title")!).fontSize,
      })),
    );
  const before = await geometry();
  await shortcut(page);
  await expect(page.locator(".unestimated-highlight")).toHaveCount(
    before.length,
  );
  expect(await geometry()).toEqual(before);
  expect(
    await page.locator(".unestimated-highlight").evaluateAll((elements) =>
      elements.every((element) => {
        const card = element.getBoundingClientRect(),
          cue = element
            .querySelector(".unestimated-cue")!
            .getBoundingClientRect(),
          issue = element
            .querySelector(".task-top > span")!
            .getBoundingClientRect(),
          style = getComputedStyle(element);
        return (
          ((cue.width === 0 &&
            cue.height === 0 &&
            getComputedStyle(element.querySelector(".task-top")!).display ===
              "none") ||
            (cue.left >= issue.right &&
              cue.top >= card.top &&
              cue.right <= card.right &&
              cue.bottom <= card.bottom)) &&
          parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) <= 0
        );
      }),
    ),
  ).toBe(true);
  expect(f.posts()).toBe(0);
  expect(f.burndownReads()).toBe(0);
});
