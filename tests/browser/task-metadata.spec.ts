import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";
const card = (page: Page, id = "t0-0-0") => page.locator(`[data-task="${id}"]`);
const amount = (page: Page, id = "t0-0-0") =>
  card(page, id).locator(".task-estimate");
async function ready(page: Page) {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  for (const task of f.board.tasks)
    Object.assign(task, {
      estimateHours: 4,
      subIssueCount: 0,
      parentId: task.lane,
    });
  let chartReads = 0;
  await page.route(/\/api\/burndown(?:\?.*)?$/, (r) => {
    chartReads++;
    return r.fulfill({ status: 503, json: { error: "fixture_not_used" } });
  });
  await page.reload();
  await expect(amount(page)).toHaveText("4h");
  return { ...f, chartReads: () => chartReads };
}

test("2x2の付箋は担当avatarと見積を常時表示し、type/status/名前を詰め込まない", async ({
  page,
}) => {
  await page.route("https://avatars.githubusercontent.com/**", (r) =>
    r.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="8" fill="#64748b"/></svg>',
    }),
  );
  const f = await ready(page);
  f.board.tasks[0].assignees = [
    {
      login: "first",
      name: "担当一",
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
    },
    {
      login: "second",
      name: "担当二",
      avatarUrl: "https://avatars.githubusercontent.com/u/2",
    },
    {
      login: "third",
      name: "担当三",
      avatarUrl: "https://avatars.githubusercontent.com/u/3",
    },
  ];
  f.board.tasks[1].assignees = [];
  await page.reload();
  await expect(card(page).locator(".avatar-image")).toHaveCount(2);
  await expect(card(page).locator(".avatar-count")).toHaveText("+1");
  await expect(card(page).locator(".person")).toHaveAttribute(
    "aria-label",
    /担当一.*担当二.*担当三/,
  );
  await expect(card(page, "t0-0-1").locator(".avatar.none")).toHaveAttribute(
    "aria-label",
    "未割り当て",
  );
  await expect(
    page.locator(".task .type-cue, .task .raw-status, .task .person-name"),
  ).toHaveCount(0);
  await expect(page.locator(".pbi-assignees").first()).toContainText(
    "検証担当者",
  );
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.locator(".task-cell").evaluateAll((cells) =>
    cells.every((cell) =>
      [...cell.querySelectorAll(".task")].slice(0, 4).every((task) => {
        const bounds = task.getBoundingClientRect(),
          footer = task.querySelector(".task-bottom")!.getBoundingClientRect(),
          person = task.querySelector(".person")!.getBoundingClientRect(),
          value = task.querySelector(".task-estimate")!.getBoundingClientRect(),
          title = task.querySelector(".task-title")!.getBoundingClientRect();
        return (
          footer.height >= 16 &&
          footer.bottom <= bounds.bottom &&
          footer.top >= title.bottom - 1 &&
          person.width >= 16 &&
          person.height >= 16 &&
          value.width > 0 &&
          value.height >= 12 &&
          person.right <= value.left &&
          value.right <= bounds.right &&
          title.height >=
            parseFloat(
              getComputedStyle(task.querySelector(".task-title")!).lineHeight,
            )
        );
      }),
    ),
  );
  expect(geometry).toBe(true);
  const cell = page.locator('[data-lane="p0"][data-status="ToDo"]');
  await expect(cell.locator(".task-top").first()).toBeHidden();
  const button = cell.locator('[data-cell-step="1"]');
  const buttonSize = await button.boundingBox();
  expect(buttonSize!.height).toBeLessThanOrEqual(20);
  expect(buttonSize!.width).toBeGreaterThanOrEqual(36);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  await expect(amount(page, "t0-0-4")).toHaveText("4h");
  await expect(
    card(page, "t0-0-4").locator(".avatar").first(),
  ).toBeInViewport();
  await cell.locator(".cell-viewport").focus();
  await page.keyboard.press("PageUp");
  await expect(cell.locator(".cell-range")).toHaveText("1–4 / 5");
  // One large card keeps its Issue number; the left PBI content is untouched.
  f.board.tasks = f.board.tasks.filter(
    (t) => t.lane !== "p0" || t.status !== "完了" || t.id === "t0-3-0",
  );
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(card(page, "t0-3-0").locator(".task-top")).toBeVisible();
  await expect(card(page, "t0-3-0").locator(".task-top")).toContainText("#115");
  expect(f.posts()).toBe(0);
  expect(f.chartReads()).toBe(0);
});

test("0h・小数・候補外・未設定・未取得を区別し、公開失効は即座に見積を消す", async ({
  page,
}) => {
  const f = await ready(page);
  [0, 1.5, 13, null, undefined].forEach((value, i) => {
    (f.board.tasks[i] as any).estimateHours = value;
  });
  await page.reload();
  for (const [i, label, state] of [
    [0, "0h", "set"],
    [1, "1.5h", "set"],
    [2, "13h", "set"],
    [3, "未設定", "unset"],
    [4, "—", "unavailable"],
  ] as const) {
    await expect(amount(page, `t0-0-${i}`)).toHaveText(label);
    await expect(amount(page, `t0-0-${i}`)).toHaveAttribute(
      "data-state",
      state,
    );
  }
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/board", async (r) => {
    await gate;
    return r.fulfill({ json: f.board });
  });
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(amount(page)).toHaveText("0h");
  release();
  await expect(page.locator("#refresh")).toBeEnabled();
  await page.unroute("**/api/board");
  (f.board.scope as any).estimateHoursField = false;
  await page.locator("#refresh").click();
  await expect(
    page.locator(
      '.task-estimate[data-state="set"], .task-estimate[data-state="unset"]',
    ),
  ).toHaveCount(0);
  await expect(amount(page)).toHaveText("—");
  (f.board.scope as any).estimateHoursField = true;
  await page.locator("#refresh").click();
  await expect(amount(page)).toHaveText("0h");
  await page.route("**/api/board", (r) =>
    r.fulfill({ status: 403, json: { error: "estimate_hours_not_public" } }),
  );
  await page.locator("#refresh").click();
  await expect(amount(page)).toHaveText("—");
  expect(f.posts()).toBe(0);
  expect(f.chartReads()).toBe(0);
});

test("色凡例は操作バー内だけ、未知・未設定を同じ中立色へ示しlight/darkとtoolbar操作を維持", async ({
  page,
}) => {
  const f = await ready(page);
  await page.clock.setFixedTime(new Date("2026-10-28T02:00:00Z"));
  await page.route("**/api/current-sprint", (r) =>
    r.fulfill({
      json: {
        ok: true,
        status: "current",
        checkedAt: "2026-10-28T02:00:00Z",
        currentSprint: {
          number: 10,
          title: "Sprint 10",
          startAt: "2026-10-27T15:00:00.000Z",
          endAt: "2026-11-08T15:00:00.000Z",
          policy: "sprint-v2-exclusive-jst",
        },
      },
    }),
  );
  f.board.tasks[1].type = "競合調査";
  f.board.tasks[2].type = "新しい種別";
  (f.board.tasks[3] as any).type = null;
  (f.board.tasks[0] as any).estimateHours = 12;
  await page.reload();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.locator("#operations").click();
  const legend = page.locator("#type-legend");
  await expect(legend).toBeVisible();
  for (const label of ["Task", "競合調査"])
    await expect(legend).toContainText(label);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.locator("#theme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    for (const [i, kind] of [
      [0, "task"],
      [1, "research"],
      [2, "unknown"],
      [3, "unknown"],
    ] as const) {
      expect(
        await legend
          .locator(`[data-type-kind="${kind}"] .type-legend-swatch`)
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      ).toBe(
        await card(page, `t0-0-${i}`).evaluate(
          (e) => getComputedStyle(e).backgroundColor,
        ),
      );
    }
    const panel = await page.locator(".control-panel").boundingBox(),
      operations = await page.locator("#operations").boundingBox(),
      lb = await legend.boundingBox();
    expect(panel!.height).toBeLessThan(100);
    expect(lb!.x + lb!.width).toBeLessThanOrEqual(operations!.x);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `test-results/task-metadata-${page.viewportSize()!.width}-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.locator("#operations").click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.mouse.move(500, 300);
  await page.mouse.move(500, 2);
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  // The toolbar is an overlay; click an actually exposed card, not the first
  // row title covered by the open contextual toolbar. No force/focus bypass.
  await card(page, "t1-0-0").locator(".task-title").click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.keyboard.press("Escape");
  expect(f.posts()).toBe(0);
  expect(f.chartReads()).toBe(0);
});

test("12h presetは見積だけautosaveし、遅いackは公開失効したfooterへ復活しない", async ({
  page,
}) => {
  const f = await ready(page);
  let release!: () => void, sent: any;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/issues/100", async (r) => {
    sent = r.request().postDataJSON();
    await gate;
    return r.fulfill({
      json: {
        ok: true,
        issue: { ...f.board.tasks[0], estimateHours: 12, revision: "saved" },
      },
    });
  });
  await card(page).locator(".task-title").click();
  await page.locator('#estimate-hours-choices button[data-value="12"]').click();
  await expect.poll(() => sent?.estimateHours).toBe(12);
  await expect(amount(page)).toHaveText("4h");
  expect(sent).not.toHaveProperty("body");
  expect(sent).not.toHaveProperty("storyPoints");
  (f.board.scope as any).estimateHoursField = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(amount(page)).toHaveText("—");
  release();
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
  await expect(amount(page)).toHaveText("—");
  expect(f.chartReads()).toBe(0);
});

test("12h追加の明示選択はmetadataだけを自動保存し、付箋と再訪に同じ12hを示す", async ({
  page,
}) => {
  const f = await ready(page);
  const patches: any[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") patches.push(r.postDataJSON());
  });
  await card(page).locator(".task-title").click();
  await page.locator('#estimate-hours-choices button[data-value="12"]').click();
  await expect.poll(f.posts).toBe(1);
  expect(patches[0].estimateHours).toBe(12);
  expect(patches[0]).not.toHaveProperty("body");
  expect(patches[0]).not.toHaveProperty("storyPoints");
  await expect(amount(page)).toHaveText("12h");
  await page.locator("#close-detail").click();
  await card(page).locator(".task-title").click();
  await expect(
    page.locator('#estimate-hours-choices button[data-value="12"]'),
  ).toHaveAttribute("aria-pressed", "true");
  expect(f.chartReads()).toBe(0);
});

for (const canonical of [4, null])
  test(`保存中と結果不明502でもfooterは確認済み見積を保持 ${canonical}`, async ({
    page,
  }) => {
    const f = await ready(page);
    (f.board.tasks[0] as any).estimateHours = canonical;
    await page.reload();
    const label = canonical === null ? "未設定" : "4h";
    let release!: () => void,
      posts = 0;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/issues/100", async (r) => {
      posts++;
      await gate;
      return r.fulfill({
        status: 502,
        json: { error: "mutation_outcome_unresolved", ambiguous: true },
      });
    });
    await card(page).locator(".task-title").click();
    await page
      .locator('#estimate-hours-choices button[data-value="12"]')
      .click();
    await expect.poll(() => posts).toBe(1);
    await expect(amount(page)).toHaveText(label);
    release();
    await expect(page.locator("#detail-error")).toBeVisible();
    await expect(amount(page)).toHaveText(label);
    await page.locator("#close-detail").click();
    await expect(amount(page)).toHaveText(label);
    expect(posts).toBe(1);
  });

test("avatar画像失敗でもfallbackと時間footerを2x2に残す", async ({ page }) => {
  await page.route("https://avatars.githubusercontent.com/**", (r) =>
    r.abort(),
  );
  const f = await ready(page);
  const avatar = card(page).locator(".avatar").first();
  await expect(avatar).toBeVisible();
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar).toContainText("検");
  await expect(amount(page)).toHaveText("4h");
  const box = await avatar.boundingBox(),
    value = await amount(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(16);
  expect(box!.x + box!.width).toBeLessThanOrEqual(value!.x);
  expect(f.posts()).toBe(0);
});
