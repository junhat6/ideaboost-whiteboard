import { test, expect } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";
const hour = (page: any, value: number | null) =>
  page.locator(`#estimate-hours-choices button[data-value="${value ?? ""}"]`);
const data = {
  ok: true,
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
  await expect(page.locator(".burn-content")).toContainText(
    "Projectの対象外と確認した直接の子Issue 1件は含みません",
  );
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
  await page.route("**/api/burndown*", (r) =>
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
  await page.route("**/api/burndown*", (r) =>
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
  await page.route("**/api/burndown*", async (route) => {
    const n = ++reads;
    if (n === 1) await old;
    await route.fulfill({
      json: {
        ...data,
        current: { ...data.current, remainingHours: n === 1 ? 1 : 2 },
      },
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
  await expect(page.locator(".burn-summary strong")).toHaveText("2 h");
  expect(reads).toBe(2);
  await page.keyboard.press("Escape");
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
  await page.route("**/api/burndown*", (r) => {
    reads++;
    return r.fulfill({ json: data });
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
