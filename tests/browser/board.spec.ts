import { test, expect, type Page } from "@playwright/test";
const statuses = ["未整理", "作業中", "レビュー中", "完了"];
function snapshot() {
  const base = {
    revision: "2026-10-26T00:00:00Z",
    state: "OPEN",
    assignees: [
      {
        login: "tester",
        name: "検証担当者",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
    ],
    projectItemId: "item",
    statusEditable: true,
    body: "## ユーザーに提供する体験\n- 原文の **Markdown** を保持する\n\n## 詳細\n本文の全体",
  };
  const lanes = Array.from({ length: 7 }, (_, i) => ({
    ...base,
    id: `p${i}`,
    nodeId: `p${i}`,
    number: i + 1,
    type: "PBI",
    status: "作業中",
    title: `チームのアイデアを共有して育てる ${i + 1}`,
  }));
  const tasks = lanes.flatMap((l, i) =>
    statuses.flatMap((status, j) =>
      Array.from({ length: j === 0 ? 5 : 4 }, (_, k) => ({
        ...base,
        id: `t${i}-${j}-${k}`,
        nodeId: `t${i}-${j}-${k}`,
        number: 100 + i * 20 + j * 5 + k,
        type: "Task",
        title: `利用者が投稿したアイデアの内容を確認して、チームへ共有できる ${k + 1}`,
        status,
        lane: l.id,
      })),
    ),
  );
  return {
    lanes,
    tasks,
    assigneeOptions: base.assignees,
    scope: {
      owner: "engineer-first",
      repo: "idea-boost",
      projectNumber: 3,
      viewNumber: 16,
      filterApplied: true,
    },
    fetchedAt: "2026-10-26T00:00:00Z",
  };
}
async function setup(
  page: Page,
  {
    failure = false,
    slow = false,
    abort = false,
    conflict = false,
    prefix = "",
    longPbi = false,
  } = {},
) {
  const board = snapshot();
  if (longPbi)
    board.lanes[0].title =
      "日本語の非常に長いPBIタイトルを読みながら進捗も確認する".repeat(8);
  let posts = 0;
  let reads = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.slice(prefix.length);
    if (p === "/api/health")
      return route.fulfill({
        json: {
          configured: true,
          accessMode: prefix ? "public-temporary" : "team",
        },
      });
    if (p === "/api/board") {
      reads++;
      return route.fulfill({ json: board });
    }
    posts++;
    if (conflict)
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "conflict" },
      });
    if (abort) return route.abort("connectionreset");
    if (slow) await new Promise((r) => setTimeout(r, 500));
    if (failure)
      return route.fulfill({
        status: 502,
        json: { ok: false, ambiguous: true, partial: true },
      });
    const patch = route.request().postDataJSON();
    const id = Number(p.split("/").pop());
    const issue = [...board.lanes, ...board.tasks].find(
      (i) => i.number === id,
    )!;
    Object.assign(issue, { ...patch, revision: "2026-10-26T00:00:01Z" });
    return route.fulfill({ json: { ok: true, issue } });
  });
  await page.goto(prefix + "/");
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  return { board, posts: () => posts, reads: () => reads };
}
test("six rows, four cards per cell, whole title lines, no page scroll", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".task")).toHaveCount(96);
  await expect(page.locator(".overflow-button")).toHaveCount(6);
  const layout = await page.evaluate(() => ({
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
  expect(layout.height).toBe(layout.viewport);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewport);
  expect(layout.partial).toBe(false);
  expect(layout.unnecessaryPbiScroll).toBe(false);
  await page.screenshot({
    path: `test-results/board-${page.viewportSize()!.width}.png`,
  });
});
test("picker max six, cancellation, source order and toolbar dismiss", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  await expect(page.locator("#pbi-options input:disabled")).toHaveCount(1);
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
    await page.locator("#edit-issue").click();
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
  await page.locator("#edit-issue").click();
  await page.locator("#detail-body").fill("破棄する内容");
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
  await page.locator("#edit-issue").click();
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
test("pending save blocks closing and duplicate submit", async ({ page }) => {
  const state = await setup(page, { slow: true });
  await page.locator(".task-title").first().click();
  await page.locator("#edit-issue").click();
  await page.locator("#detail-title").fill("通信中の変更");
  await page.locator("#save-issue").click();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-heading")).toHaveText("通信中の変更");
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
test("auto refresh pauses in editor and picker, resumes on visible interval", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const start = s.reads();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(start + 1);
  await page.locator(".task-title").first().click();
  await page.locator("#edit-issue").click();
  const edited = s.reads();
  await page.clock.fastForward(46000);
  expect(s.reads()).toBe(edited);
  page.once("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await page.clock.fastForward(200);
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  const picking = s.reads();
  await page.clock.fastForward(46000);
  expect(s.reads()).toBe(picking);
  await page.locator("#pbi-cancel").click();
  await page.clock.fastForward(46000);
  await expect.poll(s.reads).toBe(picking + 1);
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
  await page.locator("#edit-issue").click();
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
    await page.locator("#edit-issue").click();
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
    await page.locator("#edit-issue").click();
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
  await page.locator("#edit-issue").click();
  await page.locator("#detail-title").fill("公開パスで保存");
  await page.locator("#save-issue").click();
  await expect(page.locator("#edit-issue")).toBeVisible();
  expect(s.posts()).toBe(1);
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

test("right 80% viewer opens and closes immediately during background read, then reconciles", async ({
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
  await expect(page.locator("#detail-sync")).toContainText("最新を確認中");
  await expect(page.locator("#edit-issue")).toBeDisabled();
  await page.waitForTimeout(250);
  const box = await page.locator("#details").boundingBox();
  expect(box!.x).toBeCloseTo(page.viewportSize()!.width * 0.2, 0);
  expect(box!.width).toBeCloseTo(page.viewportSize()!.width * 0.8, 0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator(".pbi-title").first().click();
  await expect(page.locator("#details")).toBeVisible();
  s.board.lanes[0].body = "再取得後の正本本文";
  release();
  await expect(page.locator("#detail-body-view")).toHaveText(
    "再取得後の正本本文",
  );
  await expect(page.locator("#detail-sync")).toBeHidden();
  await page.locator("#edit-issue").click();
  await page.locator("#detail-body").fill("未保存");
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
  await expect(page.locator("#detail-sync")).toContainText("前回取得した内容");
  await page.route("**/api/board", (route) => route.fulfill({ json: s.board }));
  await page.locator("#recover-edit").click();
  await expect(page.locator("#detail-sync")).toBeHidden();
  await page.locator("#edit-issue").click();
  await expect(page.locator("#detail-title")).toBeEnabled();
  page.once("dialog", (d) => d.accept());
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
  expect(
    await page
      .locator(".skeleton-note")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    page.viewportSize()!.height,
  );
  await page.clock.fastForward(8000);
  await expect(page.locator("#empty")).toContainText("通常より時間");
  await expect(page.locator("#retry-load")).toBeHidden();
  release();
  await expect(page.locator(".task")).toHaveCount(96);
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
  await expect(page.locator(".task")).toHaveCount(96);
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
  await expect(page.locator(".task")).toHaveCount(96);
  await expect(page.locator("#empty")).toBeHidden();
});
