import { withRebase } from "./burndown-fixture";
import { test, expect, type Page } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";
const hour = (page: any, value: number | null) =>
  page.locator(`#estimate-hours-choices button[data-value="${value ?? ""}"]`);
const calendar = (page: Page) => page.locator("#burn-school-days");
const calendarDay = (page: Page, day: string) =>
  calendar(page).locator(`button[data-day="${day}"]`);
async function closeChart(page: Page) {
  if (await page.locator("#burn-settings-popover").isVisible())
    await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
}
async function calendarMonth(page: Page, day: string) {
  const target = day.slice(0, 7);
  await expect(calendar(page)).toHaveAttribute("data-month", /^20\d{2}-\d{2}$/);
  for (let i = 0; i < 24; i++) {
    const current = await calendar(page).getAttribute("data-month");
    if (current === target) return;
    await calendar(page)
      .getByRole("button", {
        name: current! < target ? "次の月" : "前の月",
        exact: true,
      })
      .click();
  }
  throw new Error("Calendar month did not reach the fixture target");
}
async function expectSchoolDays(page: Page, days: string[]) {
  await expect(page.locator(".burn-calendar-count")).toHaveText(
    `${days.length}日選択中`,
  );
  for (const day of days) {
    await calendarMonth(page, day);
    await expect(calendarDay(page, day)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
}
async function setSchoolDays(page: Page, before: string[], after: string[]) {
  // Use only visible calendar controls; never inject a draft or call app internals.
  const changed = [...new Set([...before, ...after])].filter(
    (day) => before.includes(day) !== after.includes(day),
  );
  for (const day of changed) {
    await calendarMonth(page, day);
    await calendarDay(page, day).click();
  }
  await expectSchoolDays(page, after);
}
const data = {
  ok: true,
  scope: "view16",
  schedule: {
    schoolDays: [
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ],
    revision: "0",
  },
  observedAt: "2026-10-27T08:00:00Z",
  milestone: 9,
  milestones: [{ number: 9, title: "Sprint 9", dueOn: "2026-10-28T00:00:00Z" }],
  current: {
    excludedChildren: 1,
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
  let reads = 0,
    calendarModules = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/school-calendar.js"))
      calendarModules++;
  });
  await page.route("**/api/burndown**", (r) => {
    reads++;
    return r.fulfill({ json: withRebase(data) });
  });
  await page.reload();
  await expect(page.locator("#burndown-open")).toBeVisible();
  expect(reads).toBe(0);
  expect(calendarModules).toBe(0);
  const before = await page.locator("#board").boundingBox();
  await page.mouse.move(page.viewportSize()!.width - 2, 400);
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await expect(page.locator(".burn-content")).toContainText(
    "Projectの対象外と確認した直接の子Issue 1件は含みません",
  );
  expect(reads).toBe(1);
  expect(calendarModules).toBe(1);
  expect(await page.locator("#board").boundingBox()).toEqual(before);
  await closeChart(page);
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  await page.mouse.move(600, 400);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-panel")).toBeVisible();
  await page.locator("#burndown-panel").screenshot({
    path: `.wrangler/burndown-${page.viewportSize()!.width}.png`,
  });
  await closeChart(page);
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
  await hour(page, 0.5).click();
  await expect.poll(() => f.posts()).toBe(1);
  expect(patches[0].estimateHours).toBe(0.5);
  expect(patches[0].expectedEstimateHours).toBe(null);
  expect(patches[0]).not.toHaveProperty("body");
  expect(patches[0]).not.toHaveProperty("title");
  await expect(page.locator(".cm-content")).toHaveText("未保存の本文を保持");
  await hour(page, null).click();
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
  await page.route("**/api/burndown**", (r) =>
    r.fulfill(
      fail
        ? { status: 503, json: { error: "observation_unavailable" } }
        : {
            json: withRebase({
              ...data,
              current: {
                ...data.current,
                estimated: 0,
                estimatedHours: 0,
                unestimated: 5,
              },
              observations: [],
            }),
          },
    ),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-empty")).toHaveText(
    "見積時間が未設定です（5件）。",
  );
  await expect(page.locator(".burn-chart svg")).toHaveCount(0);
  await closeChart(page);
  fail = true;
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-notice")).toContainText(
    "更新できませんでした",
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
  await hour(page, 2).click();
  await expect.poll(() => posts.length).toBe(1);
  await hour(page, 3).click();
  await page.locator("#close-detail").click();
  await page.locator(".task-title").first().click();
  await expect(hour(page, 3)).toHaveAttribute("aria-pressed", "true");
  release();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].expectedEstimateHours).toBe(2);
  expect(posts[1].estimateHours).toBe(3);
  expect(posts[1]).not.toHaveProperty("body");
  await expect(hour(page, 3)).toHaveAttribute("aria-pressed", "true");
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
  await hour(page, 2).click();
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
test("履歴取得でfield公開失効を知った時も既存時間を即消去", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 4;
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({ status: 403, json: { error: "estimate_hours_not_public" } }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-open")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as any).Whiteboard.getSnapshot().tasks[0].estimateHours,
    ),
  ).toBeUndefined();
  await page.locator(".task-title").first().click();
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
});
test("履歴失効後に古い公開boardが戻っても時間を復活せず、他の本文は更新", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 4;
  let reads = 0,
    release = () => {};
  await page.route("**/api/board*", async (r) => {
    reads++;
    const data = structuredClone(f.board);
    if (reads === 2) {
      data.tasks[0].title = "通常の本文更新は採用";
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    if (reads > 2)
      return r.fulfill({ status: 503, json: { error: "unavailable" } });
    return r.fulfill({ json: data });
  });
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({ status: 403, json: { error: "estimate_hours_not_public" } }),
  );
  await page.reload();
  await expect(page.locator("#burndown-open")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads, { timeout: 10000 }).toBe(2);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-open")).toBeHidden();
  release();
  await expect(page.locator(".task-title").first()).toHaveText(
    "通常の本文更新は採用",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(2);
  await expect(page.locator("#burndown-open")).toBeHidden();
  expect(
    await page.evaluate(
      () => (window as any).Whiteboard.getSnapshot().tasks[0].estimateHours,
    ),
  ).toBeUndefined();
  await page.locator(".task-title").first().click();
  await expect(page.locator("#estimate-hours-editor")).toBeHidden();
});
test("時間field失効は競合のremote値も隠し、他の本文を消さない", async ({
  page,
}) => {
  const f = await setup(page, { conflict: true });
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  await page.reload();
  await page.locator(".task-title").first().click();
  await hour(page, 2).click();
  await expect(page.locator("#detail-error")).toBeVisible();
  (f.board.tasks[0] as any).estimateHours = 3;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#editor-conflicts")).toContainText(
    "見積時間がGitHubでも更新されました",
  );
  (f.board.scope as any).estimateHoursField = false;
  delete (f.board.tasks[0] as any).estimateHours;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#estimate-hours-editor")).toBeHidden({
    timeout: 10000,
  });
  await expect(page.locator("#editor-conflicts")).toBeHidden();
  // The lazy editor may intentionally retain its textarea while another input has focus.
  await expect(page.locator("#detail-body")).toHaveValue(f.board.tasks[0].body);
  expect(f.posts()).toBe(1);
});

test("既存の候補外値は丸めず保持、外部更新とIssue切替で選択を更新", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1.5;
  (f.board.tasks[1] as any).estimateHours = 13;
  await page.reload();
  await page.locator(".task-title").first().click();
  await expect(hour(page, 1.5)).toHaveAttribute("aria-pressed", "true");
  await hour(page, 1.5).press("Space");
  await page.waitForTimeout(300);
  expect(f.posts()).toBe(0);
  (f.board.tasks[0] as any).estimateHours = 0;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(hour(page, 0)).toHaveAttribute("aria-pressed", "true");
  await expect(hour(page, 1.5)).toHaveCount(0);
  await page.locator("#close-detail").click();
  await page.locator(".task-title").nth(1).click();
  await expect(hour(page, 13)).toHaveAttribute("aria-pressed", "true");
  expect(f.posts()).toBe(0);
  await page.locator("#details").evaluate(async (d) => {
    await Promise.all(d.getAnimations().map((a) => a.finished.catch(() => {})));
  });
  await page.screenshot({
    path: `.wrangler/hours-select-${page.viewportSize()!.width}.png`,
  });
});

for (const action of ["click", "Meta+Enter", "Control+Enter"])
  test(`時間選択後の明示保存は本文を別に保存する ${action}`, async ({
    page,
  }) => {
    const f = await setup(page);
    (f.board.scope as any).estimateHoursField = true;
    (f.board.tasks[0] as any).estimateHours = 1;
    await page.reload();
    await page.locator(".task-title").first().click();
    await fillEditor(page, "明示保存した本文");
    await hour(page, 2).click();
    await expect.poll(() => f.posts()).toBe(1);
    await expect(page.locator("#save-issue")).toBeEnabled();
    expect(f.board.tasks[0].body).not.toBe("明示保存した本文");
    if (action === "click") await page.locator("#save-issue").click();
    else await hour(page, 2).press(action);
    await expect.poll(() => f.posts()).toBe(2);
    await expect.poll(() => f.board.tasks[0].body).toBe("明示保存した本文");
    expect((f.board.tasks[0] as any).estimateHours).toBe(2);
  });

test("背景保存後のchartは旧flightを待って一度だけ更新、閉じていれば要求しない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  let releaseSave!: () => void, releaseOld!: () => void;
  const saving = new Promise<void>((r) => (releaseSave = r));
  const old = new Promise<void>((r) => (releaseOld = r));
  let posts = 0,
    reads = 0;
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    await saving;
    Object.assign(f.board.tasks[0], { estimateHours: 2, revision: "new" });
    await route.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await page.route("**/api/burndown**", async (route) => {
    const n = ++reads;
    if (n === 1) await old;
    await route.fulfill({
      json: withRebase({
        ...data,
        current: { ...data.current, remainingHours: n === 1 ? 1 : 2 },
      }),
    });
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await hour(page, 2).click();
  await expect.poll(() => posts).toBe(1);
  await page.locator("#close-detail").click();
  await page.locator("#burndown-open").click();
  await expect.poll(() => reads).toBe(1);
  releaseSave();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[0].estimateHours,
      ),
    )
    .toBe(2);
  expect(reads).toBe(1);
  releaseOld();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：2h");
  expect(reads).toBe(2);
  await closeChart(page);
  await page.locator(".task-title").first().click();
  await hour(page, 3).click();
  await expect.poll(() => posts).toBe(2);
  expect(reads).toBe(2);
});

test("時間の0表示とkeyboard解除、他Issue値保持とchartの無関係同期要求ゼロ", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 0;
  (f.board.tasks[1] as any).estimateHours = 6;
  let reads = 0;
  await page.route("**/api/burndown**", (r) => {
    reads++;
    return r.fulfill({ json: withRebase(data) });
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await hour(page, null).focus();
  await hour(page, null).press("Enter");
  await expect.poll(() => f.posts()).toBe(1);
  await expect.poll(() => (f.board.tasks[0] as any).estimateHours).toBe(null);
  expect((f.board.tasks[1] as any).estimateHours).toBe(6);
  expect(reads).toBe(0);
  await page.locator("#close-detail").click();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  expect(reads).toBe(1);
  let n = f.reads();
  f.board.tasks[0].title = "タイトルだけの外部変更";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.reads(), { timeout: 10000 }).toBeGreaterThan(n);
  expect(reads).toBe(1);
  n = f.reads();
  (f.board.tasks[1] as any).estimateHours = 8;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.reads(), { timeout: 10000 }).toBeGreaterThan(n);
  await expect.poll(() => reads).toBe(2);
});

test("時間field失効後も本文の明示保存へ時間を便乗させない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  const patches: any[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") patches.push(r.postDataJSON());
  });
  await page.reload();
  await page.locator(".task-title").first().click();
  await fillEditor(page, "非公開fieldと独立した本文");
  (f.board.scope as any).estimateHoursField = false;
  delete (f.board.tasks[0] as any).estimateHours;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#estimate-hours-editor")).toBeHidden({
    timeout: 10000,
  });
  await page.locator("#save-issue").click();
  await expect.poll(() => f.posts()).toBe(1);
  expect(patches[0]).not.toHaveProperty("estimateHours");
  expect(patches[0].body).toBe("非公開fieldと独立した本文");
});

for (const uncertain of [false, true])
  test(`時間選択の失敗は後続を自動再送せず最新意図を復元 ${uncertain}`, async ({
    page,
  }) => {
    const f = await setup(page);
    (f.board.scope as any).estimateHoursField = true;
    (f.board.tasks[0] as any).estimateHours = 1;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let posts = 0;
    await page.route("**/api/issues/100", async (r) => {
      posts++;
      await gate;
      await r.fulfill({
        status: uncertain ? 503 : 409,
        json: {
          error: uncertain ? "mutation_outcome_unresolved" : "conflict",
          ambiguous: uncertain,
        },
      });
    });
    await page.reload();
    await page.locator(".task-title").first().click();
    await hour(page, 2).click();
    await expect.poll(() => posts).toBe(1);
    await hour(page, 8).click();
    await page.locator("#close-detail").click();
    release();
    await expect(page.locator("#save-problems")).toBeVisible();
    await page.locator("#save-problems button").click();
    await expect(hour(page, 8)).toHaveAttribute("aria-pressed", "true");
    if (uncertain) await expect(page.locator("#recover-edit")).toBeDisabled();
    await hour(page, 4).click();
    await page.waitForTimeout(300);
    expect(posts).toBe(1);
  });

test("時間連打は200msで最終値一件、同値と元値への未送信復帰はPOSTゼロ", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  await page.reload();
  await page.locator(".task-title").first().click();
  await page.evaluate(() => {
    for (const value of [2, 3, 1])
      (
        document.querySelector(
          `#estimate-hours-choices button[data-value="${value}"]`,
        ) as HTMLButtonElement
      ).click();
  });
  await page.waitForTimeout(350);
  expect(f.posts()).toBe(0);
  await page.evaluate(() => {
    for (const value of [2, 3, 5])
      (
        document.querySelector(
          `#estimate-hours-choices button[data-value="${value}"]`,
        ) as HTMLButtonElement
      ).click();
  });
  await expect.poll(() => f.posts()).toBe(1);
  await expect.poll(() => (f.board.tasks[0] as any).estimateHours).toBe(5);
  await expect(hour(page, 5)).toHaveAttribute("aria-pressed", "true");
  await hour(page, 5).press("Space");
  await expect(hour(page, 5)).toBeFocused();
  await page.waitForTimeout(300);
  expect(f.posts()).toBe(1);
});

test("Sprint9の6学校日と青ideal/赤actual、過去未観測と未来を補間しない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = structuredClone(data);
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({ json: withRebase(current) }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-ideal")).toHaveCount(1);
  const svg = page.locator(".burn-chart svg");
  for (const day of ["10/21", "10/22", "10/23", "10/26", "10/27", "10/28"])
    await expect(svg).toContainText(day);
  await expect(svg).not.toContainText("10/24");
  await expect(page.locator(".burn-point")).toHaveCount(2);
  expect(await page.locator(".burn-point").first().getAttribute("cx")).toBe(
    "432",
  );
  expect(await page.locator(".burn-point").last().getAttribute("cx")).toBe(
    "556",
  );
  await expect(page.locator(".burn-ideal")).toHaveAttribute(
    "d",
    "M 60 50 L 680 310",
  );
  await expect(page.locator(".burn-baseline")).toHaveAttribute("cy", "50");
  await expect(page.locator(".burn-baseline")).toHaveAccessibleName(
    /開始基準.*実測ではありません/,
  );
  const actual = await page.locator(".burn-actual").getAttribute("d");
  await page.screenshot({
    path: `.wrangler/burn-school-${page.viewportSize()!.width}.png`,
  });
  await closeChart(page);
  current.current.estimatedHours = 16;
  await page.locator("#burndown-open").click();
  await expect(svg).toContainText("16");
  expect(current.observations).toEqual(data.observations);
  expect(await page.locator(".burn-actual").getAttribute("d")).not.toBe(actual); // same values, rescaled Y axis
});

test("赤い実線は中間の未観測学校日を補間せず、観測済みの隣接日だけ結ぶ", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = structuredClone(data);
  current.schedule.schoolDays = ["2026-10-21", "2026-10-22", "2026-10-23"];
  current.observations = data.observations.map((point, i) => ({
    ...point,
    day: i ? "2026-10-23" : "2026-10-21",
    at: i ? "2026-10-23T08:00:00Z" : "2026-10-21T08:00:00Z",
  }));
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({ json: withRebase(current) }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-point")).toHaveCount(2);
  await expect(page.locator(".burn-actual")).toHaveAttribute(
    "d",
    "M 60 50 L 60 50 M 680 147.5",
  );
  await closeChart(page);
  current.observations.splice(1, 0, {
    ...current.observations[0],
    day: "2026-10-22",
    at: "2026-10-22T08:00:00Z",
    remainingHours: 6,
  });
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-point")).toHaveCount(3);
  await expect(page.locator(".burn-actual")).toHaveAttribute(
    "d",
    "M 60 50 L 60 50 L 370 115 L 680 147.5",
  );
  expect(f.posts()).toBe(0);
});

test("再openは前回観測を即表示、背景更新/失敗保持と公開失効の消去", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  let n = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/burndown**", async (r) => {
    const count = ++n;
    if (count === 2) await gate;
    if (count === 3)
      return r.fulfill({ status: 503, json: { error: "unavailable" } });
    if (count === 4)
      return r.fulfill({
        status: 403,
        json: { error: "estimate_hours_not_public" },
      });
    return r.fulfill({
      json: withRebase({
        ...data,
        current: { ...data.current, remainingHours: count === 1 ? 5 : 4 },
      }),
    });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await expect.poll(() => n).toBe(2);
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await expect(page.locator(".burn-content")).not.toContainText(
    "読み込んでいます",
  );
  release();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：4h");
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-notice")).toBeVisible();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：4h");
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-open")).toBeHidden();
  await expect(page.locator(".burn-summary")).toHaveCount(0);
  await expect(page.locator("#burndown-panel select option")).toHaveCount(0);
  expect(f.posts()).toBe(0);
});

test("学校カレンダーの独立選択と明示保存はIssueを変更せず、再訪保持・競合確認", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = structuredClone(data),
    posts: any[] = [];
  await page.route("**/api/burndown**", async (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      if (posts.length === 2)
        return r.fulfill({ status: 409, json: { error: "schedule_conflict" } });
      current.schedule = { schoolDays: patch.schoolDays, revision: "saved" };
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, data.schedule.schoolDays);
  await expect(
    page.locator(".burn-settings textarea, .burn-settings input[type=date]"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  expect(posts).toHaveLength(0);
  const chosen = ["2026-10-22", "2026-10-23", "2026-10-27", "2026-10-28"];
  await setSchoolDays(page, data.schedule.schoolDays, chosen);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator(".burn-settings-error")).toBeHidden();
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, chosen);
  await setSchoolDays(page, chosen, ["2026-10-28"]);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect(page.locator(".burn-settings-error")).toContainText("別の操作");
  await page.getByRole("button", { name: "最新の日程に戻す" }).click();
  await expectSchoolDays(page, chosen);
  expect(posts[0].expectedRevision).toBe("0");
  expect(posts[1].expectedRevision).toBe("saved");
  expect(f.posts()).toBe(0);
});

test("日程の保存中に追記した下書きはackと再取得で失わず、次の明示保存まで送らない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = structuredClone(data),
    posts: any[] = [];
  let release!: () => void,
    reads = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/burndown**", async (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      if (posts.length === 1) await gate;
      current.schedule = {
        schoolDays: patch.schoolDays,
        revision: `saved-${posts.length}`,
      };
      current.observedAt = `2026-10-27T08:0${posts.length}:00Z`;
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    reads++;
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  await page.locator("#burn-settings-toggle").click();
  const save = page.getByRole("button", { name: "日程を保存", exact: true }),
    sent = ["2026-10-27", "2026-10-28"],
    draft = ["2026-10-26", "2026-10-27", "2026-10-28"];
  await setSchoolDays(page, data.schedule.schoolDays, sent);
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  await setSchoolDays(page, sent, draft);
  release();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator(".burn-observed")).toContainText("17:01");
  await expect(save).toBeEnabled();
  await expect(page.locator(".burn-settings form")).toHaveAttribute(
    "data-revision",
    "saved-1",
  );
  await expectSchoolDays(page, draft);
  expect(posts).toHaveLength(1);
  expect(posts[0].schoolDays).toEqual(sent);
  await save.click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].expectedRevision).toBe("saved-1");
  expect(posts[1].schoolDays).toEqual(draft);
  await expect.poll(() => reads).toBe(3);
  await expect(page.locator(".burn-observed")).toContainText("17:02");
  await expectSchoolDays(page, draft);
  expect(f.posts()).toBe(0);
});

test("別スプリントの日程保存中と遅いack後の取得失敗でも表示中の日程と保存先を混ぜない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const milestones = [
      ...data.milestones,
      { number: 10, title: "Sprint 10", dueOn: "2026-11-04T00:00:00Z" },
    ],
    nine = { ...structuredClone(data), milestones },
    ten = {
      ...structuredClone(data),
      milestones,
      milestone: 10,
      schedule: { schoolDays: ["2026-11-02", "2026-11-04"], revision: "0" },
    },
    posts: any[] = [];
  let release!: () => void,
    failTen = false,
    failedTenReads = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/burndown**", async (r) => {
    const milestone = Number(
        new URL(r.request().url()).searchParams.get("milestone") || 9,
      ),
      current = milestone === 9 ? nine : ten;
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push({ milestone, ...patch });
      if (milestone === 9) await gate;
      current.schedule = {
        schoolDays: patch.schoolDays,
        revision: `saved-${milestone}`,
      };
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    if (milestone === 10 && failTen) {
      failedTenReads++;
      return r.fulfill({ status: 503, json: { error: "unavailable" } });
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  const select = page.getByLabel("バーンダウンのスプリント"),
    save = page.getByRole("button", { name: "日程を保存", exact: true });
  await select.selectOption("10");
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, ten.schedule.schoolDays);
  await select.selectOption("9");
  await page.locator("#burn-settings-toggle").click();
  await setSchoolDays(page, nine.schedule.schoolDays, [
    "2026-10-27",
    "2026-10-28",
  ]);
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  failTen = true;
  await select.selectOption("10");
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, ten.schedule.schoolDays);
  await expect(save).toBeEnabled();
  await expect(page.locator(".burn-settings form")).toHaveAttribute(
    "data-revision",
    "0",
  );
  await expect.poll(() => failedTenReads).toBe(1);
  release();
  await expect.poll(() => failedTenReads).toBe(2);
  await expect(page.locator(".burn-notice")).toBeVisible();
  await expectSchoolDays(page, ten.schedule.schoolDays);
  await save.click();
  expect(posts).toHaveLength(1);
  await setSchoolDays(page, ten.schedule.schoolDays, [
    "2026-11-03",
    "2026-11-04",
  ]);
  await save.click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].milestone).toBe(10);
  expect(posts[1].expectedRevision).toBe("0");
  expect(posts[1].schoolDays).toEqual(["2026-11-03", "2026-11-04"]);
  expect(f.posts()).toBe(0);
});

test("スプリントを切替えても他スプリントのcache/遅い応答を混ぜない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let ten = 0;
  await page.route("**/api/burndown**", async (r) => {
    const milestone = Number(
      new URL(r.request().url()).searchParams.get("milestone") || 9,
    );
    if (milestone === 10) {
      ten++;
      await gate;
    }
    return r.fulfill({
      json: withRebase({
        ...data,
        milestone,
        milestones: [
          ...data.milestones,
          { number: 10, title: "Sprint 10", dueOn: "2026-11-11T00:00:00Z" },
        ],
        current: { ...data.current, remainingHours: milestone === 9 ? 5 : 2 },
      }),
    });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await page.getByLabel("バーンダウンのスプリント").selectOption("10");
  await expect.poll(() => ten).toBe(1);
  await expect(page.locator(".burn-summary")).toHaveCount(0);
  await page.getByLabel("バーンダウンのスプリント").selectOption("9");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  release();
  await expect(page.getByLabel("バーンダウンのスプリント")).toHaveValue("9");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await page.getByLabel("バーンダウンのスプリント").selectOption("10");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：2h");
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await expect(page.getByLabel("バーンダウンのスプリント")).toHaveValue("10");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：2h");
});

test("同じ観測の背景更新は図DOMを保持し、確認時刻だけ更新", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  let reads = 0;
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({
      json: withRebase({
        ...data,
        observedAt: ++reads === 1 ? data.observedAt : "2026-10-27T08:01:00Z",
      }),
    }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  await expect(
    page.locator(".burn-chart details, .burn-chart table"),
  ).toHaveCount(0);
  await page
    .locator(".burn-chart svg")
    .evaluate((e) => ((window as any).__burnSvg = e));
  (f.board.tasks[0] as any).estimateHours = 2;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads, { timeout: 10000 }).toBe(2);
  await expect(page.locator(".burn-observed")).toContainText("17:01");
  expect(
    await page
      .locator(".burn-chart svg")
      .evaluate((e) => e === (window as any).__burnSvg),
  ).toBe(true);
});

test("未設定の学校日程は初回展開だけ今日JSTから期日までの平日を提案し、下書きを上書きしない", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 1;
  const current = {
    ...structuredClone(data),
    milestone: 10,
    milestones: [
      { number: 10, title: "Sprint 10", dueOn: "2026-11-02T00:00:00Z" },
    ],
    schedule: { schoolDays: [], revision: "0" },
  };
  let reads = 0,
    writes = 0;
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") writes++;
    else reads++;
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary")).toBeVisible();
  expect(writes).toBe(0);
  await page.locator("#burn-settings-toggle").click();
  const proposal = [
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-11-02",
    ],
    chosen = proposal.filter((day) => day !== "2026-10-28");
  await expectSchoolDays(page, proposal);
  await expect(page.locator(".burn-calendar-proposal")).toBeVisible();
  await setSchoolDays(page, proposal, chosen);
  (f.board.tasks[0] as any).estimateHours = 2;
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:10Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads, { timeout: 10000 }).toBe(2);
  await expectSchoolDays(page, chosen);
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, chosen);
  await setSchoolDays(page, chosen, []);
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, []);
  expect(writes).toBe(0);
  expect(f.posts()).toBe(0);
});

test("未設定から全候補を解除して空日程を明示保存すると再読込でも再提案しない", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = {
      ...structuredClone(data),
      milestone: 10,
      milestones: [
        { number: 10, title: "Sprint 10", dueOn: "2026-11-02T00:00:00Z" },
      ],
      schedule: { schoolDays: [] as string[], revision: "0" },
    },
    posts: any[] = [];
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      current.schedule = {
        schoolDays: patch.schoolDays,
        revision: "empty-saved",
      };
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  const proposal = [
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-11-02",
  ];
  await expectSchoolDays(page, proposal);
  await setSchoolDays(page, proposal, []);
  const save = page.getByRole("button", { name: "日程を保存", exact: true });
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].schoolDays).toEqual([]);
  expect(posts[0].expectedRevision).toBe("0");
  await expect(page.locator(".burn-settings form")).toHaveAttribute(
    "data-revision",
    "empty-saved",
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, []);
  await expect(page.locator(".burn-settings form")).toHaveAttribute(
    "data-revision",
    "empty-saved",
  );
  await save.click();
  expect(posts).toHaveLength(1);
  expect(f.posts()).toBe(0);
});

test("初回候補と外部保存が同値なら明示保存で送信せずrevisionを同期し、次の追記に使う", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = {
      ...structuredClone(data),
      schedule: { schoolDays: [] as string[], revision: "0" },
    },
    proposal = ["2026-10-27", "2026-10-28"],
    posts: any[] = [];
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      current.schedule = {
        schoolDays: patch.schoolDays,
        revision: "saved-1",
      };
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, proposal);
  const form = page.locator(".burn-settings form"),
    save = page.getByRole("button", { name: "日程を保存", exact: true }),
    hint = page.locator(".burn-calendar-proposal");
  await expect(form).toHaveAttribute("data-revision", "0");
  await expect(hint).toContainText("仮選択");

  current.schedule = { schoolDays: proposal, revision: "external-1" };
  current.observedAt = "2026-10-27T08:01:00Z";
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-observed")).toContainText("17:01");
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, proposal);
  // A background read must not silently acknowledge the unsaved proposal.
  await expect(form).toHaveAttribute("data-revision", "0");
  await expect(hint).toContainText("仮選択");
  expect(posts).toHaveLength(0);

  await save.click();
  await expect(form).toHaveAttribute("data-revision", "external-1");
  await expect(hint).not.toContainText("仮選択");
  await expect(page.locator(".burn-settings-error")).toBeHidden();
  expect(posts).toHaveLength(0);
  const next = [...proposal, "2026-10-29"];
  await setSchoolDays(page, proposal, next);
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].expectedRevision).toBe("external-1");
  expect(posts[0].schoolDays).toEqual(next);
  await expect(form).toHaveAttribute("data-revision", "saved-1");
  await expectSchoolDays(page, next);
  expect(f.posts()).toBe(0);
});

test("保存応答503後の同値再取得は明示保存で再送せずエラーとrevisionを同期する", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const initial = ["2026-10-27"],
    chosen = [...initial, "2026-10-28"],
    current = {
      ...structuredClone(data),
      schedule: { schoolDays: initial, revision: "initial-1" },
    },
    posts: any[] = [];
  let reads = 0;
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      current.schedule = {
        schoolDays: patch.schoolDays,
        revision: `saved-${posts.length}`,
      };
      current.observedAt = `2026-10-27T08:0${posts.length}:00Z`;
      // The mock persisted the value, but the client cannot trust this response.
      if (posts.length === 1)
        return r.fulfill({ status: 503, json: { error: "unavailable" } });
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    reads++;
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, initial);
  await setSchoolDays(page, initial, chosen);
  const form = page.locator(".burn-settings form"),
    save = page.getByRole("button", { name: "日程を保存", exact: true }),
    error = page.locator(".burn-settings-error");
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].expectedRevision).toBe("initial-1");
  expect(posts[0].schoolDays).toEqual(chosen);
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator(".burn-observed")).toContainText("17:01");
  await expect(save).toBeEnabled();
  await expect(error).toContainText("保存結果");
  await expect(form).toHaveAttribute("data-revision", "initial-1");
  await expectSchoolDays(page, chosen);
  expect(posts).toHaveLength(1);

  await save.click();
  await expect(error).toBeHidden();
  await expect(form).toHaveAttribute("data-revision", "saved-1");
  expect(posts).toHaveLength(1);
  const next = [...chosen, "2026-10-29"];
  await setSchoolDays(page, chosen, next);
  await save.click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].expectedRevision).toBe("saved-1");
  expect(posts[1].schoolDays).toEqual(next);
  await expect(form).toHaveAttribute("data-revision", "saved-2");
  await expect(error).toBeHidden();
  await expectSchoolDays(page, next);
  expect(f.posts()).toBe(0);
});

test("連続範囲ではなく月をまたぐ6日を独立選択し、明示保存した日だけ送る", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = {
      ...structuredClone(data),
      schedule: { schoolDays: [] as string[], revision: "saved-empty" },
    },
    posts: any[] = [];
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") {
      const patch = r.request().postDataJSON();
      posts.push(patch);
      current.schedule = { schoolDays: patch.schoolDays, revision: "six-days" };
      return r.fulfill({ json: { ok: true, schedule: current.schedule } });
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, []); // 保存済みの空日程は候補を勝手に復活させない。
  const selected = [
    "2026-10-20",
    "2026-10-22",
    "2026-10-24",
    "2026-10-27",
    "2026-10-29",
    "2026-11-02",
  ];
  await setSchoolDays(page, [], selected);
  await calendarMonth(page, "2026-10-21");
  await expect(calendarDay(page, "2026-10-21")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await calendarDay(page, "2026-10-22").click({ modifiers: ["Shift"] });
  await expectSchoolDays(
    page,
    selected.filter((day) => day !== "2026-10-22"),
  );
  await calendarMonth(page, "2026-10-22");
  await calendarDay(page, "2026-10-22").click({ modifiers: ["Shift"] });
  await expectSchoolDays(page, selected);
  await page.locator(".burn-settings").screenshot({
    path: `.wrangler/burn-calendar-${page.viewportSize()!.width}.png`,
  });
  expect(posts).toHaveLength(0);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].schoolDays).toEqual(selected);
  expect(posts[0].expectedRevision).toBe("saved-empty");
  expect(current.observations).toEqual(data.observations);
  await expectSchoolDays(page, selected);
  expect(f.posts()).toBe(0);
});

test("学校カレンダーは矢印と月移動キーでfocusを保ちSpace/Enterで1日ずつ切り替える", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = {
    ...structuredClone(data),
    schedule: { schoolDays: [], revision: "saved-empty" },
  };
  let posts = 0;
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") posts++;
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await calendarMonth(page, "2026-10-27");
  await calendarDay(page, "2026-10-27").focus();
  await page.keyboard.press("ArrowRight");
  await expect(calendarDay(page, "2026-10-28")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(calendarDay(page, "2026-10-28")).toBeFocused();
  await expect(calendarDay(page, "2026-10-28")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await expect(calendarDay(page, "2026-11-04")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendarDay(page, "2026-11-04")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("PageUp");
  await expect(calendarDay(page, "2026-10-04")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(calendarDay(page, "2026-10-04")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("PageDown");
  await expect(calendarDay(page, "2026-11-04")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(calendarDay(page, "2026-11-04")).toBeFocused();
  await expect(calendarDay(page, "2026-11-04")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.keyboard.press("Home");
  await expect(calendarDay(page, "2026-11-01")).toBeFocused();
  await page.keyboard.press("End");
  await expect(calendarDay(page, "2026-11-07")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(calendarDay(page, "2026-10-31")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(calendarDay(page, "2026-10-30")).toBeFocused();
  await expect(
    calendar(page).locator('button[data-day][tabindex="0"]'),
  ).toHaveCount(1);
  await expectSchoolDays(page, ["2026-10-04", "2026-10-28"]);
  expect(posts).toBe(0);
  expect(f.posts()).toBe(0);
});

for (const [title, dueOn] of [
  ["不明", null],
  ["過去", "2026-10-26T00:00:00Z"],
  ["180日より先", "2027-10-27T00:00:00Z"],
  ["平日60日超", "2027-02-27T00:00:00Z"],
] as const)
  test(`期日が${title}なら候補は空で、カレンダーから任意の日を選べる`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-10-27T08:00:00Z"));
    const f = await setup(page);
    (f.board.scope as any).estimateHoursField = true;
    const current = {
      ...structuredClone(data),
      milestone: 10,
      milestones: [{ number: 10, title: "Sprint 10", dueOn }],
      schedule: { schoolDays: [], revision: "0" },
    };
    let posts = 0;
    await page.route("**/api/burndown**", (r) => {
      if (r.request().method() === "POST") posts++;
      return r.fulfill({ json: withRebase(current) });
    });
    await page.reload();
    await page.locator("#burndown-open").click();
    await page.locator("#burn-settings-toggle").click();
    await expectSchoolDays(page, []);
    await setSchoolDays(page, [], ["2026-10-31"]);
    await closeChart(page);
    await page.locator("#burndown-open").click();
    await page.locator("#burn-settings-toggle").click();
    await expectSchoolDays(page, ["2026-10-31"]);
    expect(posts).toBe(0);
    expect(f.posts()).toBe(0);
  });

test("学校日程の保存失敗は下書きを保持し、公開失効では選択を消去する", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const current = structuredClone(data);
  let posts = 0;
  await page.route("**/api/burndown**", (r) => {
    if (r.request().method() === "POST") {
      posts++;
      return r.fulfill(
        posts === 1
          ? { status: 503, json: { error: "unavailable" } }
          : { status: 403, json: { error: "estimate_hours_not_public" } },
      );
    }
    return r.fulfill({ json: withRebase(current) });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  const chosen = ["2026-10-27", "2026-10-28"];
  await setSchoolDays(page, data.schedule.schoolDays, chosen);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect(page.locator(".burn-settings-error")).toContainText("保存結果");
  await expectSchoolDays(page, chosen);
  await closeChart(page);
  await page.locator("#burndown-open").click();
  await page.locator("#burn-settings-toggle").click();
  await expectSchoolDays(page, chosen);
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "最新の日程に戻す" }).click();
  await expectSchoolDays(page, data.schedule.schoolDays);
  await setSchoolDays(page, data.schedule.schoolDays, ["2026-10-28"]);
  await page.getByRole("button", { name: "日程を保存", exact: true }).click();
  await expect(page.locator("#burndown-panel")).not.toBeVisible();
  await expect(page.locator("#burndown-open")).toBeHidden();
  await expect(
    calendar(page).locator('button[data-day][aria-pressed="true"]'),
  ).toHaveCount(0);
  expect(posts).toBe(2);
  expect(f.posts()).toBe(0);
});

test("繰越後の旧Sprintは終了前の最終記録と学校日を保持し、新Sprintと公開失効を分離", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  const old = {
    ...structuredClone(data),
    observedAt: "2026-10-28T01:00:00Z",
    current: {
      ...data.current,
      remainingHours: 0,
      estimatedHours: 0,
      estimated: 0,
      total: 0,
      unestimated: 0,
    },
    display: {
      mode: "historical",
      summary: structuredClone(data.current),
      observedAt: data.observedAt,
      cutoff: "2026-10-27T15:00:00Z",
      policy: "sprint-v2-exclusive-jst",
    },
    milestones: [
      ...data.milestones,
      { number: 10, title: "Sprint 10", dueOn: "2026-11-09T00:00:00Z" },
    ],
  };
  let privateField = false,
    reads = 0;
  await page.route("**/api/burndown**", (r) => {
    reads++;
    if (privateField)
      return r.fulfill({
        status: 403,
        json: { error: "estimate_hours_not_public" },
      });
    const ten =
      new URL(r.request().url()).searchParams.get("milestone") === "10";
    return r.fulfill({
      json: withRebase(
        ten
          ? {
              ...old,
              milestone: 10,
              current: {
                ...data.current,
                remainingHours: 3,
                estimatedHours: 12,
              },
              display: {
                mode: "live",
                summary: {
                  ...data.current,
                  remainingHours: 3,
                  estimatedHours: 12,
                },
                observedAt: old.observedAt,
                cutoff: null,
                policy: null,
              },
              observations: [],
            }
          : old,
      ),
    });
  });
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await expect(page.locator(".burn-observed")).toHaveText(
    "最終記録: 2026/10/27 17:00:00 JST",
  );
  await expect(page.locator(".burn-point")).toHaveCount(2);
  await expect(page.locator(".burn-point").last()).toHaveAttribute("cx", "556");
  await expect(page.locator(".burn-chart svg")).toContainText("10/28");
  await expect(page.locator(".burn-ideal-label")).toHaveText(
    "理想（最終記録の全体見積）",
  );
  await expect(page.locator(".burn-ideal")).toHaveAttribute(
    "d",
    "M 60 50 L 680 310",
  );
  await page.locator("#burndown-panel").screenshot({
    path: `test-results/burndown-rollover-${page.viewportSize()!.width}.png`,
  });
  await closeChart(page);
  old.observedAt = "2026-10-29T01:00:00Z";
  await page.locator("#burndown-open").click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator(".burn-observed")).toHaveText(
    "最終記録: 2026/10/27 17:00:00 JST",
  );
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await page
    .getByRole("combobox", { name: "バーンダウンのスプリント" })
    .selectOption("10");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：3h");
  await expect(page.locator(".burn-ideal-label")).toHaveText(
    "理想（現在の全体見積）",
  );
  await page
    .getByRole("combobox", { name: "バーンダウンのスプリント" })
    .selectOption("9");
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：5h");
  await closeChart(page);
  privateField = true;
  await page.locator("#burndown-open").click();
  await expect(page.locator("#burndown-open")).toBeHidden();
  await expect(page.locator(".burn-summary")).toHaveCount(0);
  expect(f.posts()).toBe(0);
});

test("終了前の記録がないSprintは残りをゼロにせず記録なし、過去点も生成しない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({
      json: withRebase({
        ...data,
        observedAt: "2026-10-28T01:00:00Z",
        observations: [],
        current: {
          ...data.current,
          remainingHours: 0,
          estimatedHours: 0,
          estimated: 0,
          total: 0,
        },
        display: {
          mode: "historical",
          summary: null,
          observedAt: null,
          cutoff: "2026-10-27T15:00:00Z",
          policy: "sprint-v2-exclusive-jst",
        },
      }),
    }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：—");
  await expect(page.locator(".burn-summary")).toContainText("記録なし");
  await expect(page.locator(".burn-observed")).toHaveText("記録なし");
  await expect(page.locator(".burn-chart svg")).toHaveCount(0);
  expect(f.posts()).toBe(0);
});

test("終了前に実際に完了した0hは保持し、最終非ゼロ値へ戻さない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({
      json: withRebase({
        ...data,
        observedAt: "2026-10-28T01:00:00Z",
        display: {
          mode: "historical",
          summary: { ...data.current, remainingHours: 0 },
          observedAt: data.observedAt,
          cutoff: "2026-10-27T15:00:00Z",
          policy: "sprint-v2-exclusive-jst",
        },
        observations: data.observations.map((p, i) => ({
          ...p,
          remainingHours: i ? 0 : p.remainingHours,
        })),
      }),
    }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：0h");
  await expect(page.locator(".burn-point").last()).toHaveAttribute("cy", "310");
  expect(f.posts()).toBe(0);
});

test("進行中の現在scopeが空なら過去scopeの赤線へfallbackせずゼロ理想線も捏造しない", async ({
  page,
}) => {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  await page.route("**/api/burndown**", (r) =>
    r.fulfill({
      json: withRebase({
        ...data,
        current: {
          ...data.current,
          remainingHours: 0,
          estimatedHours: 0,
          estimated: 0,
          total: 0,
        },
      }),
    }),
  );
  await page.reload();
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：—");
  await expect(page.locator(".burn-point")).toHaveCount(0);
  await expect(page.locator(".burn-ideal")).toHaveCount(0);
  expect(f.posts()).toBe(0);
});
