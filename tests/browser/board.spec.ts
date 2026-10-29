import { test, expect } from "@playwright/test";
import { setup, snapshot, fillEditor, chooseToolbarOption } from "./fixtures";
test("six rows, four cards per cell, whole title lines, no page scroll", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".task")).toHaveCount(102);
  await expect(page.locator(".cell-viewport")).toHaveCount(6);
  const layout = await page.evaluate(() => ({
    firstFourContained: [...document.querySelectorAll(".task-cell")].every(
      (cell) => {
        const port = cell.querySelector(".cell-viewport") || cell;
        const bounds = port.getBoundingClientRect();
        return [...cell.querySelectorAll(".task")].slice(0, 4).every((card) => {
          const rect = card.getBoundingClientRect();
          return (
            rect.top >= bounds.top - 1 &&
            rect.bottom <= bounds.bottom + 1 &&
            rect.left >= bounds.left - 1 &&
            rect.right <= bounds.right + 1
          );
        });
      },
    ),
    height: document.documentElement.scrollHeight,
    viewport: innerHeight,
    bottom: document.querySelector("#board")!.getBoundingClientRect().bottom,
    unnecessaryPbiScroll: [
      ...document.querySelectorAll(".pbi-title-text"),
    ].some((el) => el.scrollHeight > el.clientHeight + 1),
    partial: [...document.querySelectorAll(".task-title-text")].some((el) => {
      const s = getComputedStyle(el.parentElement!);
      const line = parseFloat(s.lineHeight);
      return (
        Math.abs(
          el.getBoundingClientRect().height / line -
            Math.round(el.getBoundingClientRect().height / line),
        ) > 0.1
      );
    }),
  }));
  expect(layout.firstFourContained).toBe(true);
  expect(layout.height).toBe(layout.viewport);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewport);
  expect(layout.partial).toBe(false);
  expect(layout.unnecessaryPbiScroll).toBe(false);
  await page.screenshot({
    path: `test-results/board-${page.viewportSize()!.width}.png`,
  });
});
test("picker keeps manual membership, cancellation, source order and toolbar dismiss", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  await expect(page.locator("#pbi-options input:disabled")).toHaveCount(0);
  await expect(page.locator("#pbi-options input:checked")).toHaveCount(6);
  await page.locator("#pbi-clear").click();
  await page.locator("#pbi-cancel").click();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.locator("#choose-pbis").click();
  await page.locator("#pbi-clear").click();
  await page.locator("#pbi-options input").nth(3).check();
  await page.locator("#pbi-options input").nth(1).check();
  await page.locator("#pbi-apply").click();
  await expect(page.locator(".pbi-title").first()).toContainText("2");
  await page.locator(".pbi-title").first().click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
});
test("repeated editor saves, cancel draft, canonical refetch and no full-body patch", async ({
  page,
}) => {
  const state = await setup(page);
  for (let i = 0; i < 3; i++) {
    await page.locator(".task-title").first().click();
    await page.locator("#rename-issue").click();
    await page.locator("#detail-title").fill(`更新した日本語タイトル ${i}`);
    await page.locator("#save-issue").click();
    await expect(page.locator("#detail-heading")).toHaveText(
      `更新した日本語タイトル ${i}`,
    );
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
  }
  expect(state.posts()).toBe(3);
  expect(state.reads()).toBeGreaterThanOrEqual(4);
  await page.locator(".pbi-title").first().click();
  await page.locator("#rename-issue").click();
  await fillEditor(page, "破棄する内容");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
});
test("partial result prevents replay and preserves recoverable draft", async ({
  page,
}) => {
  const state = await setup(page, { failure: true });
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("保存結果が不明な変更");
  await page.locator("#save-issue").click();
  await expect(page.locator("#detail-error")).toBeVisible();
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(state.posts()).toBe(1);
  await expect(page.locator("#detail-title")).toHaveValue(
    "保存結果が不明な変更",
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#recover-edit").click();
  await expect(page.locator("#detail-error")).not.toBeVisible();
  expect(state.posts()).toBe(1);
});
test("pending save allows closing and keeps one submitted intent", async ({
  page,
}) => {
  const state = await setup(page, { slow: true });
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("通信中の変更");
  await page.locator("#save-issue").click();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  expect(state.posts()).toBe(1);
});
test("Markdown remains literal and malicious HTML cannot execute", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.lanes[0].body =
    '## ユーザーに提供する体験\n<img src=x onerror="window.pwned=true">\n```\n## デモゴール\n偽\n```\n<!--隠す-->';
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(page.locator(".goal-text").first()).toContainText("<img");
  await expect(page.locator(".goal-text").first()).not.toContainText("偽");
  expect(await page.evaluate(() => !!(window as any).pwned)).toBe(false);
});
test("auto refresh continues in editor, pauses in picker and resumes", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const start = s.reads();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(start + 1);
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  const edited = s.reads();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(edited + 1);
  await page.locator("#close-detail").click();
  await page.clock.fastForward(200);
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  const picking = s.reads();
  await page.clock.fastForward(46000);
  expect(s.reads()).toBe(picking);
  await page.locator("#pbi-cancel").click();
  await expect.poll(s.reads).toBe(picking + 1);
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(picking + 2);
});
test("same-column drag preserves raw status and cross-column writes Doing canonical status", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.tasks.find((t) => t.id === "t0-1-0")!.status = "壁打ち中";
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await page.locator("#operations").click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  const source = page.locator('[data-task="t0-1-0"]');
  await source.dragTo(page.locator('[data-lane="p0"][data-status="Doing"]'));
  expect(s.posts()).toBe(0);
  await page
    .locator('[data-task="t0-0-0"]')
    .dragTo(page.locator('[data-lane="p0"][data-status="Doing"]'));
  await expect.poll(s.posts).toBe(1);
  expect(s.board.tasks.find((t) => t.id === "t0-0-0")!.status).toBe("作業中");
});
test("keyboard access, dark secondary mode and full-screen API", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#search").focus();
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator("#theme").click();
  await page.locator("#fullscreen").click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await page.locator(".pbi-title").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#details")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pbi-title").first()).toBeFocused();
});

test("interrupted write never retries and leaves draft available", async ({
  page,
}) => {
  const s = await setup(page, { abort: true });
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("通信が途切れた入力");
  await page.locator("#save-issue").click();
  await expect(page.locator("#detail-error")).toContainText("保存結果が不明");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#detail-title")).toHaveValue("通信が途切れた入力");
  expect(s.posts()).toBe(1);
});
test("unconfigured connection never displays a sample board", async ({
  page,
}) => {
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: false } }),
  );
  await page.goto("/");
  await expect(page.locator("#empty")).toContainText("接続できません");
  await page.setViewportSize({ width: 1920, height: 1070 });
  await expect(page.locator("#empty")).toContainText("接続できません");
  await expect(page.locator(".task")).toHaveCount(0);
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(page.locator("#empty")).toContainText("接続できません");
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
});
test("goal parser respects long fences, heading preference and unclosed comments", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(() =>
    (window as any).Whiteboard.goal(
      "## 受け入れ条件\nfallback\n## ユーザーに提供する体験\noriginal **markdown**\n````js\n```\n## デモゴール\nfake\n````\n<!-- unclosed\n## デモゴール\ncomment",
    ),
  );
  expect(result).toBe("original **markdown**");
});

test("initial stationary top pointer does not open toolbar; deliberate edge motion does", async ({
  page,
}) => {
  await page.mouse.move(0, 0);
  await setup(page);
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.locator(".task-title").first().click();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await page.mouse.move(500, 300);
  await page.mouse.move(500, 2);
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await page.locator(".pbi-title").nth(3).click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
});

for (const mode of ["partial", "network", "conflict"]) {
  test(`recovery from ${mode} permits an explicit new edit and save`, async ({
    page,
  }) => {
    const state = await setup(page, {
      failure: mode === "partial",
      abort: mode === "network",
      conflict: mode === "conflict",
    });
    await page.locator(".task-title").first().click();
    await page.locator("#rename-issue").click();
    await page.locator("#detail-title").fill("失敗する変更");
    await page.locator("#save-issue").click();
    await expect(page.locator("#detail-error")).toBeVisible();
    await expect(page.locator("#save-issue")).toBeDisabled();
    expect(state.posts()).toBe(1);
    page.once("dialog", (d) => d.accept());
    await page.locator("#recover-edit").click();
    await expect(page.locator("#detail-error")).not.toBeVisible();
    expect(state.posts()).toBe(1);
    await page.route("**/api/issues/*", async (route) => {
      const issue = state.board.tasks[0];
      Object.assign(issue, route.request().postDataJSON(), {
        revision: "2026-10-26T00:00:02Z",
      });
      await route.fulfill({ json: { ok: true, issue } });
    });
    await page.locator("#rename-issue").click();
    await expect(page.locator("#save-issue")).toBeEnabled();
    await page.locator("#detail-title").fill("再取得後に明示して保存");
    await page.locator("#save-issue").click();
    await expect(page.locator("#detail-heading")).toHaveText(
      "再取得後に明示して保存",
    );
    await expect(page.locator("#detail-error")).not.toBeVisible();
  });
}

test("unpredictable public path preserves same-path API reads and saves", async ({
  page,
}) => {
  const prefix = "/b/" + "a".repeat(48);
  const s = await setup(page, { prefix });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("公開パスで保存");
  await page.locator("#save-issue").click();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect.poll(s.posts).toBe(1);
  expect(s.board.tasks[0].title).toBe("公開パスで保存");
});

test("long PBI stays within cell with complete lines and visible progress", async ({
  page,
}) => {
  await setup(page, { longPbi: true });
  const result = await page
    .locator(".pbi-cell")
    .first()
    .evaluate((cell) => {
      const title = cell.querySelector(".pbi-title")!;
      const progress = cell.querySelector(".lane-progress")!;
      const c = cell.getBoundingClientRect(),
        t = title.getBoundingClientRect(),
        p = progress.getBoundingClientRect();
      return {
        top: t.top - c.top,
        bottom: c.bottom - t.bottom,
        progressBottom: c.bottom - p.bottom,
        overlap: t.bottom - p.top,
        wholeLines: (() => {
          const text = title.querySelector(".pbi-title-text")!;
          const line = parseFloat(getComputedStyle(title).lineHeight);
          return parseFloat((text as HTMLElement).style.maxHeight) / line;
        })(),
      };
    });
  expect(result.top).toBeGreaterThanOrEqual(0);
  expect(result.bottom).toBeGreaterThanOrEqual(0);
  expect(result.progressBottom).toBeGreaterThanOrEqual(0);
  expect(result.overlap).toBeLessThanOrEqual(0);
  expect(
    Math.abs(result.wholeLines - Math.round(result.wholeLines)),
  ).toBeLessThan(0.001);
});

test("right 88% viewer opens and closes immediately during background read, then reconciles", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = false;
  await page.route("**/api/board", async (route) => {
    started = true;
    await gate;
    await route.fulfill({ json: s.board });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => started).toBe(true);
  await page
    .locator(".task")
    .first()
    .click({ position: { x: 8, y: 8 } });
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-sync")).toBeHidden();
  await expect(page.locator("#detail-fields")).toBeEnabled();
  await page.waitForTimeout(250);
  const box = await page.locator("#details").boundingBox();
  expect(box!.x).toBeCloseTo(page.viewportSize()!.width * 0.12, 0);
  expect(box!.width).toBeCloseTo(page.viewportSize()!.width * 0.88, 0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator(".pbi-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  s.board.lanes[0].body = "再取得後の正本本文";
  release();
  await expect(page.locator("#detail-body")).toHaveValue("再取得後の正本本文");
  await expect(page.locator("#detail-sync")).toBeHidden();
  await page.locator("#rename-issue").click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("未保存");
  await expect(page.locator("#detail-body")).toHaveValue("未保存");
  page.once("dialog", (d) => d.dismiss());
  await page.mouse.click(20, 200);
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-body")).toHaveValue("未保存");
  page.once("dialog", (d) => d.accept());
  await page.mouse.click(20, 200);
  await expect(page.locator("#details")).not.toBeVisible();
  expect(s.posts()).toBe(0);
});

test("viewer remains usable on interrupted refresh and explicit retry restores freshness", async ({
  page,
}) => {
  const s = await setup(page);
  await page.route("**/api/board", (route) => route.abort("connectionreset"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".task-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-sync")).toContainText(
    "同期できませんでした",
  );
  await page.route("**/api/board", (route) => route.fulfill({ json: s.board }));
  await page.locator("#recover-edit").click();
  await expect(page.locator("#detail-sync")).toBeHidden();
  await page.locator("#rename-issue").click();
  await expect(page.locator("#detail-title")).toBeEnabled();
  await page.keyboard.press("Escape"); // タイトル変更だけを取消
  if (await page.locator(".instant-tooltip").count())
    await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
  expect(s.posts()).toBe(0);
});

test("first load has six-row skeleton, honest slow state, reduced motion and no false empty state", async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/board", async (r) => {
    await gate;
    await r.fulfill({ json: snapshot() });
  });
  await page.goto("/");
  await expect(page.locator(".skeleton-row")).toHaveCount(6);
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#empty")).toContainText("GitHubから読み込み中");
  await expect(page.locator("#empty")).not.toContainText("ありません");
  await expect(page.locator(".skeleton-note").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    page.viewportSize()!.height,
  );
  await page.clock.fastForward(8000);
  await expect(page.locator("#empty")).toContainText("通常より時間");
  await expect(page.locator("#retry-load")).toBeHidden();
  release();
  await expect(page.locator(".task")).toHaveCount(102);
  await expect(page.locator(".skeleton-row")).toHaveCount(0);
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#empty")).toBeHidden();
});

test("initial failure survives resize and retries into distinct empty data state", async ({
  page,
}) => {
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/board", (r) =>
    r.fulfill({ status: 502, json: { error: "github_request_failed" } }),
  );
  await page.goto("/");
  await expect(page.locator("#empty")).toContainText("502");
  await expect(page.locator("#retry-load")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  await expect(page.locator("#empty")).toContainText("502");
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await page.route("**/api/board", (r) =>
    r.fulfill({ json: { ...snapshot(), lanes: [], tasks: [] } }),
  );
  await page.locator("#retry-load").click();
  await expect(page.locator("#empty")).toContainText("表示するPBIがありません");
  await expect(page.locator("#empty")).not.toContainText("読み込み中");
  await expect(page.locator("#retry-load")).toBeHidden();
  await expect(page.locator(".skeleton-row")).toHaveCount(0);
});

test("failed background sync preserves cards with an actionable error and last success time", async ({
  page,
}) => {
  const s = await setup(page);
  await page.route("**/api/board", (r) => r.abort("connectionreset"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#sync-warning")).toBeVisible();
  await expect(page.locator("#sync-warning")).toContainText("前回の表示を保持");
  await expect(page.locator(".task")).toHaveCount(102);
  await expect(page.locator("#connection")).toContainText("最終取得");
  await page.route("**/api/board", (r) => r.fulfill({ json: s.board }));
  await page.locator("#retry-sync").click();
  await expect(page.locator("#sync-warning")).toBeHidden();
  await expect(page.locator("#connection")).not.toContainText("接続エラー");
  expect(s.posts()).toBe(0);
});

test("hanging initial read reaches timeout reason and can retry without a reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = () => nativeTimeout(500);
  });
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/board", () => {});
  await page.goto("/");
  await expect(page.locator("#empty")).toContainText(
    "制限時間内に届きませんでした",
  );
  await expect(page.locator("#retry-load")).toBeVisible();
  await page.route("**/api/board", (r) => r.fulfill({ json: snapshot() }));
  await page.locator("#retry-load").click();
  await expect(page.locator(".task")).toHaveCount(102);
  await expect(page.locator("#empty")).toBeHidden();
});

test("polling applies upstream fields, a new child and closed PBI without navigation", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  let navigations = 0;
  page.on("framenavigated", () => navigations++);
  const target = s.board.tasks[0];
  await page.locator(`[data-open="${target.id}"]`).click();
  Object.assign(target, {
    title: "外部で更新されたタイトル",
    body: "外部で更新された本文",
    status: "レビュー中",
    assignees: [
      {
        login: "new-user",
        name: "新しい担当者",
        avatarUrl: "https://avatars.githubusercontent.com/u/2",
      },
    ],
  });
  s.board.assigneeOptions = [...s.board.assigneeOptions, target.assignees[0]];
  s.board.tasks.unshift({
    ...s.board.tasks[1],
    id: "new-child",
    nodeId: "new-child",
    number: 9999,
    title: "新しく追加された正式な子Issue",
  });
  await page.clock.fastForward(46000);
  await expect(page.locator("#detail-heading")).toHaveText(target.title);
  await expect(page.locator("#detail-body")).toHaveValue(target.body);
  await expect(page.locator("#detail-status")).toHaveValue("レビュー中");
  await expect(page.locator("#detail-assignee")).toHaveValues(["new-user"]);
  await expect(page.locator("#detail-sync")).toBeHidden();
  await expect(page.locator('[data-task="new-child"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.fastForward(200);
  await page.locator("#operations").click();
  await page.clock.fastForward(300);
  await chooseToolbarOption(page, "assignee-filter", "new-user");
  await expect(page.locator(".task")).toHaveCount(1);
  await chooseToolbarOption(page, "assignee-filter", "");
  await page.locator("#operations").click();
  await page.clock.fastForward(300);
  await page.locator('[data-pbi="p0"]').first().click();
  s.board.lanes = s.board.lanes.filter((i) => i.id !== "p0");
  s.board.tasks = s.board.tasks.filter((i) => i.lane !== "p0");
  await page.clock.fastForward(46000);
  await expect(page.locator('[data-pbi="p0"]')).toHaveCount(0);
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-sync")).toContainText(
    "表示範囲から外れています",
  );
  await expect(page.locator("#detail-fields")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.clock.fastForward(200);
  await expect(page.locator("#operations")).toBeFocused();
  expect(navigations).toBe(0);
  expect(s.posts()).toBe(0);
});

test("inline overflow reconciles title, membership and removed PBI on polling", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const cell = page.locator('[data-lane="p0"][data-status="ToDo"]');
  await cell.locator('[data-cell-step="1"]').click();
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  await expect(page.locator("#list-dialog")).not.toBeVisible();
  s.board.tasks.find((t) => t.id === "t0-0-0")!.status = "完了";
  s.board.tasks.find((t) => t.id === "t0-0-1")!.title = "付箋も自動更新";
  s.board.tasks = s.board.tasks.filter((t) => t.id !== "t0-0-2");
  await page.clock.fastForward(46000);
  await expect(cell.locator(".task")).toHaveCount(3);
  await expect(cell.locator('[data-open="t0-0-1"]')).toHaveText(
    "付箋も自動更新",
  );
  await expect(cell.locator(".cell-viewport")).toHaveCount(0);
  s.board.lanes = s.board.lanes.filter((i) => i.id !== "p0");
  s.board.tasks = s.board.tasks.filter((i) => i.lane !== "p0");
  await page.clock.fastForward(46000);
  await expect(cell).toHaveCount(0);
  expect(s.posts()).toBe(0);
});

for (const kind of ["見送り", "未分類"])
  test(`${kind} list stays current while open`, async ({ page }) => {
    await page.clock.install();
    const s = await setup(page);
    const target = s.board.tasks[0];
    target.status = kind === "見送り" ? "見送り" : "未知";
    await page.clock.fastForward(46000);
    await page.locator("#operations").click();
    await page
      .locator(kind === "見送り" ? "#show-deferred" : "#show-unmapped")
      .click();
    await expect(page.locator("#issue-list .list-item")).toHaveCount(1);
    target.title = "一覧の外部変更";
    await page.clock.fastForward(46000);
    await expect(page.locator("#issue-list")).toContainText("一覧の外部変更");
    target.status = "作業中";
    await page.clock.fastForward(46000);
    await expect(page.locator("#issue-list .list-item")).toHaveCount(0);
    expect(s.posts()).toBe(0);
  });

test("dirty editor preserves draft during sync and discards explicitly onto current content", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("保持すべき未保存の入力");
  s.board.tasks[0].title = "GitHubで別の人が変更";
  s.board.tasks[0].body = "GitHubの本文変更";
  const reads = s.reads();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(reads + 1);
  await expect(page.locator("#detail-title")).toHaveValue(
    "保持すべき未保存の入力",
  );
  await expect(page.locator("#detail-sync")).toContainText(
    "同じ項目にGitHub側の変更",
  );
  page.once("dialog", (d) => d.accept());
  await page.locator("#cancel-edit").click();
  await expect.poll(s.reads).toBe(reads + 1);
  await expect(page.locator("#detail-heading")).toHaveText(
    "GitHubで別の人が変更",
  );
  await expect(page.locator("#detail-body")).toHaveValue("GitHubの本文変更");
  expect(s.posts()).toBe(0);
});

test("online recovers initial failure and later offline updates without reload or request storm", async ({
  page,
}) => {
  await page.clock.install();
  const board = snapshot();
  let reads = 0,
    fail = true;
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true } }),
  );
  await page.route("**/api/board", (r) => {
    reads++;
    return r.fulfill(
      fail
        ? { status: 502, json: { error: "github_request_failed" } }
        : { json: board },
    );
  });
  await page.goto("/");
  await expect(page.locator("#retry-load")).toBeVisible();
  fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".task")).toHaveCount(102);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  const before = reads;
  board.tasks[0].title = "回線復帰で反映";
  await page.clock.fastForward(46000);
  expect(reads).toBe(before);
  await expect(page.locator("#connection")).toContainText("オフライン");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("focus"));
    }
  });
  await expect(page.locator('[data-open="t0-0-0"]')).toHaveText(
    "回線復帰で反映",
  );
  await page.clock.fastForward(6000);
  expect(reads - before).toBeLessThanOrEqual(2);
  await expect(page.locator("#sync-warning")).toBeHidden();
});

test("slow poll stays serialized and queued wakeup cannot overwrite newer data", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  let reads = 0,
    release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (r) => {
    reads++;
    const data = JSON.parse(JSON.stringify(s.board));
    if (reads === 1) await gate;
    await r.fulfill({ json: data });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(1);
  s.board.tasks[0].title = "後の最新状態";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(reads).toBe(1);
  release();
  await expect(page.locator("#refresh")).toBeEnabled();
  await page.clock.fastForward(6000);
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator('[data-open="t0-0-0"]')).toHaveText("後の最新状態");
  expect(s.posts()).toBe(0);
});

test("resize during interrupted drag releases the auto refresh pause", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const box = await page.locator(".task").first().boundingBox();
  await page.mouse.move(box!.x + 2, box!.y + 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 24, box!.y + 24, { steps: 4 });
  await expect(page.locator(".task.dragging")).toHaveCount(1);
  const before = s.reads();
  await page.clock.fastForward(46000);
  expect(s.reads()).toBe(before);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: viewport.height - 10 });
  await expect.poll(s.reads).toBe(before + 1);
  await expect(page.locator("#refresh")).toBeEnabled();
  await page.mouse.up();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(before + 2);
  expect(s.posts()).toBe(0);
});

test("shared snapshot paints actual cards then refreshes immediately, with age and editable inputs", async ({
  page,
}) => {
  const data = snapshot();
  data.fetchedAt = new Date(Date.now() - 20000).toISOString();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let freshReads = 0,
    posts = 0;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      posts++;
      return route.abort();
    }
    if (req.url().endsWith("/health"))
      return route.fulfill({ json: { configured: true } });
    if (req.headers()["x-board-snapshot"] === "1")
      return route.fulfill({
        json: { ...data, readState: { kind: "snapshot", ageMs: 20000 } },
      });
    freshReads++;
    await gate;
    const fresh = structuredClone(data);
    fresh.tasks[0].body = "最新の正本本文";
    return route.fulfill({ json: fresh });
  });
  await page.goto("/");
  await expect(page.locator(".task")).toHaveCount(102);
  await expect(page.locator("#connection")).toBeHidden();
  await expect.poll(() => freshReads).toBe(1);
  await page.locator(".task-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-fields")).toBeEnabled();
  release();
  await expect(page.locator("#detail-body")).toHaveValue("最新の正本本文");
  await expect(page.locator("#detail-fields")).toBeEnabled();
  await expect(page.locator("#connection")).not.toContainText("直近の取得結果");
  expect(posts).toBe(0);
});

test("cached view remains editable on failed refresh and clears on known private transition", async ({
  page,
}) => {
  const data = snapshot();
  let fail = "github_unavailable";
  await page.route("**/api/**", (route) => {
    if (route.request().url().endsWith("/health"))
      return route.fulfill({ json: { configured: true } });
    if (route.request().headers()["x-board-snapshot"] === "1")
      return route.fulfill({
        json: { ...data, readState: { kind: "snapshot", ageMs: 20000 } },
      });
    return route.fulfill({ status: 403, json: { error: fail } });
  });
  await page.goto("/");
  await expect(page.locator("#sync-warning")).toBeVisible();
  await page.locator(".task-title").first().click();
  await expect(page.locator("#detail-fields")).toBeEnabled();
  await page.keyboard.press("Escape");
  fail = "scope_not_public";
  await page.locator("#retry-sync").click();
  await expect(page.locator(".task")).toHaveCount(0);
  await expect(page.locator("#empty")).toContainText("公開範囲");
  await expect(page.locator("#details")).not.toBeVisible();
});
