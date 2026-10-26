import { test, expect } from "@playwright/test";
import { setup, renderReadHarness } from "./fixtures";
test("real wheel over fit/zoomed diagram flows to parent, explicit drag and Fit remain usable", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.tasks[0].body =
    "前置き\n\n```mermaid\nflowchart TD\n" +
    Array.from(
      { length: 15 },
      (_, i) => `N${i}[日本語の工程${i}] --> N${i + 1}`,
    ).join("\n") +
    "\n```\n\n" +
    "本文の後続段落\n\n".repeat(80);
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  for (const mode of ["live", "read"]) {
    if (mode === "read") await renderReadHarness(page);
    const fig = page.locator(".diagram-shell:visible").first(),
      canvas = fig.locator(".diagram-canvas");
    await expect(canvas.locator("svg")).toBeVisible();
    for (const zoomed of [false, true]) {
      if (zoomed)
        for (let i = 0; i < 5; i++)
          await fig.getByRole("button", { name: "拡大", exact: true }).click();
      for (const edge of [0, 99999]) {
        await canvas.scrollIntoViewIfNeeded();
        const b = await canvas.boundingBox();
        await canvas.evaluate((c, y) => {
          c.scrollTop = y;
          c.scrollLeft = y;
        }, edge);
        const before = await canvas.evaluate((c) => ({
          top: c.scrollTop,
          left: c.scrollLeft,
          width: (c.querySelector("svg") as SVGElement).style.width,
          parents: Array.from(
            (function* (x: Element | null) {
              while (x) {
                yield x;
                x = x.parentElement;
              }
            })(c.parentElement),
          ).map((x) => x.scrollTop),
        }));
        await page.mouse.move(
          b!.x + b!.width / 2,
          b!.y + Math.min(120, b!.height / 2),
        );
        await page.mouse.wheel(35, 180);
        await expect
          .poll(() =>
            canvas.evaluate((c) =>
              Array.from(
                (function* (x: Element | null) {
                  while (x) {
                    yield x;
                    x = x.parentElement;
                  }
                })(c.parentElement),
              ).map((x) => x.scrollTop),
            ),
          )
          .not.toEqual(before.parents);
        const after = await canvas.evaluate((c) => ({
          top: c.scrollTop,
          left: c.scrollLeft,
          width: (c.querySelector("svg") as SVGElement).style.width,
        }));
        expect(after).toEqual({
          top: before.top,
          left: before.left,
          width: before.width,
        });
        await page.mouse.wheel(-20, -120);
      }
    }
    await canvas.scrollIntoViewIfNeeded();
    await canvas.evaluate((c) => (c.scrollTop = 0));
    const b = await canvas.boundingBox();
    await page.mouse.move(b!.x + 100, b!.y + 150);
    await page.mouse.down();
    await page.mouse.move(b!.x + 100, b!.y + 50, { steps: 5 });
    await page.mouse.up();
    expect(await canvas.evaluate((c) => c.scrollTop)).toBeGreaterThan(0);
    await fig.getByRole("button", { name: "全体を表示" }).click();
    await expect(canvas).toHaveAttribute("data-zoomed", "false");
    expect(await canvas.evaluate((c) => c.scrollTop)).toBe(0);
  }
  expect(s.posts()).toBe(0);
});
test("progress has flat segments, rounded ends and readable count across edge cases", async ({
  page,
}) => {
  const s = await setup(page);
  for (const [total, done] of [
    [0, 0],
    [1, 1],
    [6, 1],
    [6, 6],
    [40, 20],
    [41, 20],
  ]) {
    s.board.tasks = s.board.tasks.filter((t) => t.lane !== "p0");
    s.board.tasks.push(
      ...Array.from({ length: total }, (_, i) => ({
        ...s.board.tasks[0],
        id: `case-${i}`,
        lane: "p0",
        status: i < done ? "完了" : "未整理",
      })),
    );
    await page.evaluate(
      (b) => (window as any).Whiteboard.applySnapshot(b),
      s.board,
    );
    const cell = page.locator('[data-pbi-row="p0"]'),
      track = cell.locator(".progress-track");
    await expect(track).toHaveAttribute("aria-valuenow", String(done));
    await expect(cell.locator(".progress-count")).toHaveText(
      `${done}/${total}`,
    );
    await expect(track.locator(".progress-segment")).toHaveCount(
      total <= 40 ? total : 0,
    );
    await expect(track.locator(".complete")).toHaveCount(
      total <= 40 ? done : 0,
    );
    await expect(track).toHaveCSS("height", "8px");
    await expect(track).toHaveCSS("box-shadow", "none");
    await expect(track).toHaveCSS("padding", "0px");
    await expect(track).toHaveCSS("border-radius", "999px");
    for (const segment of await track.locator(".progress-segment").all()) {
      await expect(segment).toHaveCSS("box-shadow", "none");
      await expect(segment).toHaveCSS("border-radius", "0px");
    }
    if (total === 6 && done === 1)
      await page.screenshot({
        path: `.wrangler/progress-refined-${page.viewportSize()!.width}.png`,
      });
  }
  expect(s.posts()).toBe(0);
});

test("unchanged author keeps avatar DOM through fresh reads, changed author updates", async ({
  page,
}) => {
  const s = await setup(page);
  (s.board.tasks[0] as any).author = {
    login: "creator",
    name: "作者",
    avatarUrl: "https://avatars.githubusercontent.com/u/2",
    url: "https://github.com/creator",
    type: "User",
  } as any;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await page.evaluate(() => {
    const r = document.querySelector("#issue-author")!;
    (window as any).authorFirst = r.firstChild;
    (window as any).authorReplacements = 0;
    new MutationObserver(() => {
      if (r.firstChild !== (window as any).authorFirst) {
        (window as any).authorReplacements++;
        (window as any).authorFirst = r.firstChild;
      }
    }).observe(r, { childList: true });
  });
  for (let i = 0; i < 3; i++) {
    const count = s.reads();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => s.reads()).toBeGreaterThan(count);
    await page.waitForTimeout(150);
  }
  const replacements = await page.evaluate(
    () => (window as any).authorReplacements,
  );
  console.log("AUTHOR_REPLACEMENTS", replacements);
  expect(replacements).toBe(0);
  (s.board.tasks[0] as any).author = {
    ...(s.board.tasks[0] as any).author,
    name: "更新された作者",
  } as any;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#issue-author")).toContainText("更新された作者", {
    timeout: 10000,
  });
  expect(s.posts()).toBe(0);
});

test("blue semantic palette and goal whole-line viewport keep strong contrast and full scroll access", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.lanes[0].body =
    "## ユーザーに提供する体験\n" +
    "- 長い日本語のデモゴールを省略せずに表示して内容を確認できます。\n".repeat(
      30,
    );
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  const goal = page.locator(".goal-text").first();
  const data = await goal.evaluate((el) => {
    const c = getComputedStyle(el),
      p = getComputedStyle(el.parentElement!),
      r = getComputedStyle(document.documentElement);
    return {
      fg: c.color,
      bg: p.backgroundColor,
      height: el.clientHeight,
      line: parseFloat(c.lineHeight),
      padding: p.paddingTop,
      scroll: el.scrollHeight,
      font: parseFloat(c.fontSize),
      accent: r.getPropertyValue("--accent"),
      muted: r.getPropertyValue("--muted"),
      pending: r.getPropertyValue("--progress-pending"),
      border: r.getPropertyValue("--input-border"),
    };
  });
  function rgb(s: string) {
    if (s.trim().startsWith("#"))
      return s
        .trim()
        .slice(1)
        .match(/../g)!
        .map((x) => parseInt(x, 16));
    return s
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
  }
  function lum(s: string) {
    return rgb(s)
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function ratio(a: string, b: string) {
    const x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  expect(ratio(data.fg, data.bg)).toBeGreaterThan(12);
  expect(ratio(data.muted, data.bg)).toBeGreaterThan(4.5);
  expect(ratio(data.accent, data.bg)).toBeGreaterThan(4.5);
  expect(ratio(data.accent, data.pending)).toBeGreaterThan(3);
  expect(ratio(data.border, data.bg)).toBeGreaterThan(3);
  expect(data.padding).toBe("6px");
  expect(data.scroll).toBeGreaterThan(data.height);
  expect(
    Math.abs(data.height / data.line - Math.round(data.height / data.line)),
  ).toBeLessThan(0.08);
  await goal.evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(await goal.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  console.log("GOAL_VIEWPORT", JSON.stringify(data));
  await page.screenshot({
    path: `.wrangler/blue-board-${page.viewportSize()!.width}.png`,
  });
  await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  await page.locator("#pbi-search").focus();
  await page.screenshot({
    path: `.wrangler/blue-picker-${page.viewportSize()!.width}.png`,
  });
  expect(s.posts()).toBe(0);
});

test("actual toolbar/detail input borders and failed avatar use semantic colors", async ({
  page,
}) => {
  await page.route("https://avatars.githubusercontent.com/**", (r) =>
    r.abort(),
  );
  await setup(page);
  const avatar = page.locator(".task .avatar-stack .avatar").first();
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar).toHaveCSS("background-color", "rgb(232, 239, 252)");
  await expect(avatar).toHaveCSS("color", "rgb(24, 43, 73)");
  await page.locator("#operations").click();
  await expect(page.locator("#search")).toHaveCSS(
    "border-top-color",
    "rgb(125, 141, 168)",
  );
  await expect(page.locator("#assignee-filter")).toHaveCSS(
    "border-top-color",
    "rgb(125, 141, 168)",
  );
  await page.locator(".task-title").first().click();
  await page.locator("#rename-issue").click();
  await expect(page.locator("#detail-title")).toHaveCSS(
    "border-bottom-color",
    "rgb(125, 141, 168)",
  );
  await expect(page.locator("#detail-body")).toHaveCSS(
    "border-top-color",
    "rgb(125, 141, 168)",
  );
});
