import { withRebase } from "./burndown-fixture";
import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { snapshot, chooseToolbarOption } from "./fixtures";

const scope = JSON.stringify([
  "github",
  "engineer-first",
  "idea-boost",
  3,
  16,
  "default",
]);
const legacyKey = `idea-boost-whiteboard-display-v1:${scope}`;
const selectionKey = `idea-boost-whiteboard-display-v2:${scope}`;
const rowsKey = `idea-boost-whiteboard-rows-v1:${scope}`;
const managed = (count: number) =>
  Array.from({ length: count }, (_, index) => `p${index}`);
function boardData(count: number) {
  const source = snapshot();
  const lanes = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(source.lanes[index % source.lanes.length]),
    id: `p${index}`,
    nodeId: `p${index}`,
    number: index + 1,
    url: `https://github.com/engineer-first/idea-boost/issues/${index + 1}`,
    title: `利用者のアイデアをチームで共有し次の改善につなげる ${index + 1}`,
  }));
  const template = source.tasks.filter((task) => task.lane === "p0");
  const tasks = lanes.flatMap((lane, index) =>
    template.map((task, offset) => ({
      ...structuredClone(task),
      id: `t${index}-${offset}`,
      nodeId: `t${index}-${offset}`,
      number: 100 + index * 20 + offset,
      url: `https://github.com/engineer-first/idea-boost/issues/${100 + index * 20 + offset}`,
      title: `利用者から届いた改善案を確認して担当者と対応方針を整理する ${offset + 1}`,
      lane: lane.id,
      parentId: lane.id,
      subIssueCount: 0,
      estimateHours: offset === 0 ? null : offset === 1 ? 0 : 4,
    })),
  );
  return {
    ...source,
    lanes,
    tasks,
    scope: { ...source.scope, estimateHoursField: true },
  };
}
const chartPayload = {
  ok: true,
  scope: "synthetic-managed-scope",
  milestone: 10,
  milestones: [
    { number: 10, title: "Sprint 10", dueOn: "2026-11-09T00:00:00Z" },
  ],
  observedAt: "2026-10-29T03:00:00Z",
  current: {
    remainingHours: 43,
    estimatedHours: 60,
    estimated: 12,
    unestimated: 2,
    total: 14,
    cancelled: 0,
    excludedChildren: 0,
  },
  schedule: {
    schoolDays: ["2026-10-29", "2026-11-02", "2026-11-09"],
    revision: "saved-10",
  },
  observations: [
    {
      day: "2026-10-29",
      at: "2026-10-29T03:00:00Z",
      remainingHours: 43,
      estimatedHours: 60,
      estimated: 12,
      unestimated: 2,
      total: 14,
      cancelled: 0,
      excludedChildren: 0,
    },
  ],
};
async function prepare(page: Page, count = 12, legacy = managed(count)) {
  const board = boardData(count),
    reads: string[] = [],
    writes: string[] = [];
  await page.addInitScript(
    ({ key, ids }) => {
      if (!sessionStorage.getItem("managed-fixture-seeded")) {
        localStorage.setItem(key, JSON.stringify(ids));
        sessionStorage.setItem("managed-fixture-seeded", "true");
      }
    },
    { key: legacyKey, ids: legacy },
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="8" fill="#64748b"/></svg>',
    }),
  );
  await page.route("**/api/**", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({
        status: 403,
        json: { error: "synthetic_writes_forbidden" },
      });
    }
    reads.push(url.pathname + url.search);
    if (url.pathname === "/api/health")
      return route.fulfill({ json: { configured: true, accessMode: "team" } });
    if (url.pathname === "/api/board") return route.fulfill({ json: board });
    if (url.pathname === "/api/current-sprint")
      return route.fulfill({
        json: {
          ok: true,
          status: "none",
          currentSprint: null,
          checkedAt: new Date().toISOString(),
        },
      });
    if (url.pathname === "/api/burndown")
      return route.fulfill({ json: withRebase(chartPayload) });
    if (url.pathname.endsWith("/comments"))
      return route.fulfill({ json: { comments: [], nextPage: null } });
    if (url.pathname.endsWith("/pull-requests"))
      return route.fulfill({ json: { prs: [], nextCursor: null } });
    return route.fulfill({
      status: 404,
      json: { error: "unexpected_fixture_read" },
    });
  });
  await page.goto("/");
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#fit-mode-trigger")).toBeAttached();
  await expect
    .poll(() => reads.filter((path) => path === "/api/current-sprint").length)
    .toBe(1);
  return { board, reads, writes };
}
async function controls(page: Page) {
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) !== "true"
  )
    await page.locator("#operations").click();
}
async function chooseRows(page: Page, value: number | "all") {
  await controls(page);
  await chooseToolbarOption(page, "fit-mode", String(value));
}
async function picker(page: Page) {
  await controls(page);
  await page.locator("#choose-pbis").click();
  await expect(page.locator("#pbi-picker")).toBeVisible();
}
async function visibleIds(page: Page) {
  return page
    .locator(".pbi-title")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).dataset.pbi),
    );
}
async function selection(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || "null"),
    selectionKey,
  );
}
async function refresh(page: Page) {
  await controls(page);
  await page.locator("#refresh").click();
  await expect(page.locator("#refresh")).toBeEnabled();
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
}

async function frameMetrics(page: Page) {
  return page.evaluate(async () => {
    const samples: number[] = [];
    let previous = await new Promise<number>((resolve) =>
      requestAnimationFrame(resolve),
    );
    for (let index = 0; index < 60; index++) {
      const time = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      samples.push(time - previous);
      previous = time;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return {
      cardNodes: document.querySelectorAll("#board .task").length,
      sampleCount: samples.length,
      meanMs: samples.reduce((sum, n) => sum + n, 0) / samples.length,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      samples,
    };
  });
}

for (const count of [9, 12])
  test(`${count}管理対象は既定6件のページ、Allでも2列付箋とavatar/hを保ち全作業へアクセスできる`, async ({
    page,
  }) => {
    const fixture = await prepare(page, count);
    await expect(page.locator("#fit-mode")).toHaveValue("6");
    await expect(page.locator(".pbi-title")).toHaveCount(6);
    await expect(page.locator("#page-info")).toHaveText(`PBI 1–6 / ${count}`);
    await expect(
      page.locator('[data-lane="p0"][data-status="ToDo"] .cell-viewport'),
    ).toHaveAttribute("data-capacity", "4");
    await page.evaluate(() => document.fonts.ready);
    const normalFrames = await frameMetrics(page);
    expect(normalFrames.cardNodes).toBe(6 * 17); // 管理総数によらず通常6行のDOMだけ。
    await page.screenshot({
      path: `test-results/managed-pbis-${count}-six-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
    await page.locator("#next-page").click();
    await expect(page.locator(".pbi-title")).toHaveCount(count - 6);
    await expect(page.locator("#page-info")).toHaveText(
      `PBI 7–${count} / ${count}`,
    );
    await expect(page.locator("#next-page")).toBeDisabled();
    await page.locator("#board").focus();
    await page.keyboard.press("n");
    await expect(page.locator("#fit-mode")).toHaveValue("5");
    await expect(page.locator('.pbi-title[data-pbi="p6"]')).toBeVisible();
    await page.keyboard.press("p");
    await expect(page.locator("#fit-mode")).toHaveValue("6");
    await expect(page.locator("#page-info")).toHaveText(
      `PBI 7–${count} / ${count}`,
    );
    await page.locator("#prev-page").click();
    const readsBeforeAll = [...fixture.reads];
    await page.locator("#fit-mode").evaluate((select) => {
      select.addEventListener(
        "change",
        () => {
          const begin = performance.now();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              (window as any).__managedAllChangeMs = performance.now() - begin;
            }),
          );
        },
        { once: true, capture: true },
      );
    });
    await chooseRows(page, "all");
    await expect(page.locator(".pbi-title")).toHaveCount(count);
    await expect(page.locator("#board")).toHaveClass(/overview/);
    await expect(page.locator("#pagination")).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => (window as any).__managedAllChangeMs))
      .toEqual(expect.any(Number));
    const allChangeTwoFramesMs = await page.evaluate(
      () => (window as any).__managedAllChangeMs,
    );
    const allFrames = await frameMetrics(page);
    expect(allFrames.cardNodes).toBe(count * 17);
    expect(fixture.reads).toEqual(readsBeforeAll);
    const metrics = {
      context: "headless CI rAF diagnostic, not hardware FPS or GPU proof",
      viewport: page.viewportSize(),
      managed: count,
      normalRows: 6,
      normalFrames,
      allFrames,
      allChangeTwoFramesMs,
    };
    const cell = page.locator('[data-lane="p0"][data-status="ToDo"]');
    const port = cell.locator(".cell-viewport");
    await expect(cell).toHaveCSS("padding-top", "2px");
    await expect(cell).toHaveCSS("padding-bottom", "2px");
    await expect(port).toHaveAttribute("data-capacity", "2");
    await expect(cell.locator(".cell-page")).toHaveCount(3);
    await expect(cell.locator(".cell-page").last()).toHaveAttribute(
      "data-count",
      "2",
    );
    expect(
      await cell
        .locator(".cell-page")
        .first()
        .evaluate(
          (grid) =>
            getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        ),
    ).toBe(2);
    const first = cell.locator('[data-task="t0-0"]'),
      second = cell.locator('[data-task="t0-1"]');
    await expect(first.locator(".task-title")).toBeVisible();
    await expect(first.locator(".avatar").first()).toBeInViewport();
    await expect(first.locator(".task-estimate")).toHaveText("未設定");
    await expect(second.locator(".task-estimate")).toHaveText("0h");
    const titleGeometry = await first
      .locator(".task-title")
      .evaluate((title) => {
        const box = title.getBoundingClientRect(),
          card = title.closest(".task")!;
        const cardBox = card.getBoundingClientRect();
        const footer = card
          .querySelector(".task-bottom")!
          .getBoundingClientRect();
        const avatar = card.querySelector(".person")!.getBoundingClientRect();
        const hours = card
          .querySelector(".task-estimate")!
          .getBoundingClientRect();
        const span = title.querySelector(".task-title-text")!,
          spanBox = span.getBoundingClientRect(),
          text = span.firstChild!,
          clip = {
            top: Math.max(box.top, spanBox.top),
            bottom: Math.min(box.bottom, spanBox.bottom),
            left: Math.max(box.left, spanBox.left),
            right: Math.min(box.right, spanBox.right),
          };
        const range = document.createRange(),
          lines = new Map<number, DOMRect[]>();
        for (let index = 0; index < (text.textContent || "").length; index++) {
          range.setStart(text, index);
          range.setEnd(text, index + 1);
          const glyph = range.getBoundingClientRect();
          const y = Math.round(glyph.top * 10) / 10;
          if (!lines.has(y)) lines.set(y, []);
          lines.get(y)!.push(glyph);
        }
        const inside = (glyph: DOMRect) =>
          glyph.top >= clip.top - 0.5 &&
          glyph.bottom <= clip.bottom + 0.5 &&
          glyph.left >= clip.left - 0.5 &&
          glyph.right <= clip.right + 0.5;
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        return {
          card: cardBox.toJSON(),
          title: box.toJSON(),
          textSpan: spanBox.toJSON(),
          textClip: clip,
          footer: footer.toJSON(),
          avatar: avatar.toJSON(),
          hours: hours.toJSON(),
          fullLines: [...lines.values()].filter((glyphs) =>
            glyphs.every(inside),
          ).length,
          visibleGlyphs: [...lines.values()].flat().filter(inside).length,
          toolbarOpen:
            document
              .querySelector("#operations")!
              .getAttribute("aria-expanded") === "true",
          titleCenterHit: !!hit && (hit === title || title.contains(hit)),
        };
      });
    await mkdir("test-results", { recursive: true });
    await writeFile(
      `test-results/managed-pbis-${count}-${page.viewportSize()!.width}-metrics.json`,
      JSON.stringify({ ...metrics, titleGeometry }, null, 2),
    );
    await page.screenshot({
      path: `test-results/managed-pbis-${count}-all-toolbar-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
    expect(titleGeometry.fullLines).toBeGreaterThanOrEqual(1);
    expect(titleGeometry.visibleGlyphs).toBeGreaterThan(0);
    expect(titleGeometry.footer.top).toBeGreaterThanOrEqual(
      titleGeometry.title.bottom - 0.5,
    );
    expect(titleGeometry.footer.bottom).toBeLessThanOrEqual(
      titleGeometry.card.bottom + 0.5,
    );
    expect(titleGeometry.avatar.right).toBeLessThanOrEqual(
      titleGeometry.hours.left + 0.5,
    );
    expect(titleGeometry.avatar.height).toBeGreaterThanOrEqual(16);
    expect(titleGeometry.hours.height).toBeGreaterThanOrEqual(12);
    expect(titleGeometry.toolbarOpen).toBe(true);
    expect(titleGeometry.titleCenterHit).toBe(true);
    await first.locator(".task-title").click();
    await expect(page.locator("#detail-meta")).toHaveText("#100");
    await expect(page.locator("#detail-heading")).toHaveText(
      fixture.board.tasks[0].title,
    );
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).toBeHidden();
    const [a, b] = await Promise.all([
      first.boundingBox(),
      second.boundingBox(),
    ]);
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(1);
    expect(b!.x).toBeGreaterThan(a!.x);
    await port.focus();
    await expect(cell.locator(".cell-range")).toHaveText("1–2 / 5");
    await page.keyboard.press("PageDown");
    await expect(cell.locator(".cell-range")).toHaveText("3–4 / 5");
    await expect(
      cell.locator('[data-task="t0-2"] .task-title'),
    ).toBeInViewport();
    await page.keyboard.press("PageDown");
    await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
    await expect(
      cell.locator('[data-task="t0-4"] .task-title'),
    ).toBeInViewport();
    await cell.locator('[data-task="t0-4"] .task-title').click();
    await expect(page.locator("#detail-meta")).toHaveText("#104");
    await expect(page.locator("#detail-heading")).toHaveText(
      fixture.board.tasks[4].title,
    );
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).toBeHidden();
    await port.focus();
    await page.keyboard.press("PageUp");
    await page.keyboard.press("PageUp");
    await expect(cell.locator(".cell-range")).toHaveText("1–2 / 5");
    await page.screenshot({
      path: `test-results/managed-pbis-${count}-all-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
    const lastTitle = page.locator(`[data-task="t${count - 1}-0"] .task-title`);
    await lastTitle.click(); // 通常actionability/scroll経路。最後のPBIもリスト化せず到達可能。
    await expect(page.locator("#detail-meta")).toHaveText(
      `#${100 + (count - 1) * 20}`,
    );
    await expect(page.locator("#detail-heading")).toHaveText(
      fixture.board.tasks[(count - 1) * 17].title,
    );
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).toBeHidden();
    // 最後へscroll/focusした後は先頭の付箋へ通常focusを戻して1行の画像を採る。
    await first.locator(".task-title").focus();
    await chooseRows(page, 1);
    await expect(page.locator(".pbi-title")).toHaveCount(1);
    await expect(page.locator("#page-info")).toHaveText(`PBI 1–1 / ${count}`);
    await expect(page.locator("#board")).not.toHaveClass(/overview/);
    await page.screenshot({
      path: `test-results/managed-pbis-${count}-one-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
    expect(await selection(page)).toEqual({
      mode: "manual",
      ids: managed(count),
      topN: 6,
    });
    expect(fixture.writes).toEqual([]);
    expect(
      fixture.reads.filter((path) => path.startsWith("/api/burndown")),
    ).toEqual([]);
  });

test("legacy手選択5件・空・範囲外IDと6超を自動補充も切捨てもせずv2 manualへ移行する", async ({
  page,
}) => {
  const fixture = await prepare(page, 12, ["p0", "p2", "p5", "p8", "p11"]);
  await expect(page.locator(".pbi-title")).toHaveCount(5);
  expect(await visibleIds(page)).toEqual(["p0", "p2", "p5", "p8", "p11"]);
  expect(await selection(page)).toEqual({
    mode: "manual",
    ids: ["p0", "p2", "p5", "p8", "p11"],
    topN: 6,
  });
  for (const ids of [
    [],
    ["missing-a", "p0", "p1", "p2", "p3", "p4", "p5", "p6", "missing-b"],
  ]) {
    await page.evaluate(
      ({ legacyKey, selectionKey, ids }) => {
        localStorage.setItem(legacyKey, JSON.stringify(ids));
        localStorage.removeItem(selectionKey);
      },
      { legacyKey, selectionKey, ids },
    );
    await page.reload();
    await expect
      .poll(() => selection(page))
      .toEqual({ mode: "manual", ids, topN: 6 });
    await chooseRows(page, "all");
    expect(await visibleIds(page)).toEqual(
      ids.filter((id) => id.startsWith("p")),
    );
    await picker(page);
    await expect(page.locator("#pbi-mode-manual")).toBeChecked();
    if (ids.length) {
      await expect(
        page.locator('#pbi-missing [data-select-pbi="missing-a"]'),
      ).toBeChecked();
      await expect(
        page.locator('#pbi-missing [data-select-pbi="missing-b"]'),
      ).toBeChecked();
    }
    await page.locator("#pbi-cancel").click();
    expect(await selection(page)).toEqual({ mode: "manual", ids, topN: 6 });
  }
  expect(fixture.writes).toEqual([]);
});

test("手選択は全12件へ増やせ、明示top NだけProject順の追加/並替えへ追従し手選択backupを残す", async ({
  page,
}) => {
  const fixture = await prepare(page, 12, ["p0", "p2", "p4", "p6", "p8"]);
  await picker(page);
  await expect(page.locator("#pbi-top-six")).toHaveCount(0);
  await expect(page.locator("#pbi-picker")).toContainText(
    "GitHub Projectの並び順",
  );
  for (let index = 0; index < 12; index++)
    await page.locator(`#pbi-options [data-select-pbi="p${index}"]`).check();
  await page.locator("#pbi-apply").click();
  expect(await selection(page)).toEqual({
    mode: "manual",
    ids: expect.arrayContaining(managed(12)),
    topN: 6,
  });
  expect((await selection(page)).ids).toHaveLength(12);
  await picker(page);
  await page.locator("#pbi-clear").click();
  for (const id of ["p0", "p2", "p4", "p6", "p8"])
    await page.locator(`#pbi-options [data-select-pbi="${id}"]`).check();
  await page.locator("#pbi-apply").click();
  const backup = (await selection(page)).ids;
  // Historical priority values must never override the server's shared order.
  fixture.board.lanes.forEach((lane, index) => {
    Object.assign(lane, {
      priority: index % 2 ? null : 999 - index,
      優先順位: index % 2 ? null : 999 - index,
      優先度: index % 2 ? "最優先" : "低",
    });
  });
  // 他PBIの追加はmanual membershipを勝手に変更しない。
  const inserted = {
    ...structuredClone(fixture.board.lanes[0]),
    id: "p-new",
    nodeId: "p-new",
    number: 900,
    title: "Project先頭へ追加されたPBI",
  };
  fixture.board.lanes.unshift(inserted);
  await refresh(page);
  expect(await visibleIds(page)).toEqual(backup);
  await picker(page);
  await page.locator("#pbi-mode-top").check();
  await page.locator("#pbi-top-count").fill("3");
  await page.screenshot({
    path: `test-results/managed-pbis-picker-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  await page.locator("#pbi-apply").click();
  expect(await visibleIds(page)).toEqual(["p-new", "p0", "p1"]);
  expect(await selection(page)).toEqual({ mode: "top", ids: backup, topN: 3 });
  fixture.board.lanes.unshift({
    ...structuredClone(inserted),
    id: "p-newer",
    nodeId: "p-newer",
    number: 901,
    title: "自動管理の開始後にProject先頭へ追加されたPBI",
  });
  await refresh(page);
  expect(await visibleIds(page)).toEqual(["p-newer", "p-new", "p0"]);
  fixture.board.lanes = [
    fixture.board.lanes.find((lane) => lane.id === "p8")!,
    ...fixture.board.lanes.filter((lane) => lane.id !== "p8"),
  ];
  await refresh(page);
  expect(await visibleIds(page)).toEqual(["p8", "p-newer", "p-new"]);
  await page.reload();
  await expect.poll(() => visibleIds(page)).toEqual(["p8", "p-newer", "p-new"]);
  await picker(page);
  await page.locator("#pbi-mode-manual").check();
  await page.locator("#pbi-apply").click();
  expect(await visibleIds(page)).toEqual(["p8", "p0", "p2", "p4", "p6"]);
  expect((await selection(page)).ids).toEqual(backup);
  expect(fixture.writes).toEqual([]);
});

test("top Nは正整数のみ、候補より大きな値は保持し取消は保存しない", async ({
  page,
}) => {
  const fixture = await prepare(page, 9);
  const before = await selection(page);
  await picker(page);
  await page.locator("#pbi-mode-top").check();
  for (const value of ["0", "-1", "1.5", ""]) {
    await page.locator("#pbi-top-count").fill(value);
    await expect(page.locator("#pbi-apply")).toBeDisabled();
    await expect(page.locator("#pbi-picker")).toBeVisible();
    await expect(page.locator("#pbi-selection-error")).toBeVisible();
    expect(await selection(page)).toEqual(before);
  }
  await page.locator("#pbi-top-count").fill("30");
  await page.locator("#pbi-cancel").click();
  expect(await selection(page)).toEqual(before);
  await picker(page);
  await page.locator("#pbi-mode-top").check();
  await page.locator("#pbi-top-count").fill("30");
  await page.locator("#pbi-apply").click();
  await chooseRows(page, "all");
  await expect(page.locator(".pbi-title")).toHaveCount(9);
  expect(await selection(page)).toEqual({
    mode: "top",
    ids: managed(9),
    topN: 30,
  });
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(9);
  await picker(page);
  await expect(page.locator("#pbi-top-count")).toHaveValue("30");
  await page.locator("#pbi-cancel").click();
  expect(fixture.writes).toEqual([]);
});

test("管理対象・ページ数・Allの変更はバーンダウンのSprint集計を狭めず読取追加もない", async ({
  page,
}) => {
  const fixture = await prepare(page, 12);
  await controls(page);
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：43h");
  const request = fixture.reads.filter((path) =>
    path.startsWith("/api/burndown"),
  );
  expect(request).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#burndown-panel")).toBeHidden();
  await picker(page);
  await page.locator("#pbi-clear").click();
  await page.locator('#pbi-options [data-select-pbi="p0"]').check();
  await page.locator("#pbi-apply").click();
  await chooseRows(page, "all");
  await page.locator("#board").focus();
  await page.keyboard.press("n");
  expect(
    fixture.reads.filter((path) => path.startsWith("/api/burndown")),
  ).toEqual(request);
  await controls(page);
  await page.locator("#burndown-open").click();
  await expect(page.locator(".burn-summary strong")).toHaveText("残り：43h");
  await expect
    .poll(
      () =>
        fixture.reads.filter((path) => path.startsWith("/api/burndown")).length,
    )
    .toBe(2);
  expect(
    fixture.reads.filter((path) => path.startsWith("/api/burndown"))[1],
  ).toBe("/api/burndown?milestone=10");
  expect(fixture.writes).toEqual([]);
});

test("遅い同sourceの公開失効は開いた管理pickerも閉じ候補DOMを残さない", async ({
  page,
}) => {
  const fixture = await prepare(page, 12);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let requests = 0;
  await page.route("**/api/issues/*/pull-requests*", async (route) => {
    requests++;
    await gate;
    return route.fulfill({ status: 403, json: { error: "scope_not_public" } });
  });
  try {
    await page.locator('[data-open="t0-0"]').click();
    await expect.poll(() => requests).toBe(1);
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).toBeHidden();
    await picker(page);
    await expect(page.locator("#pbi-options input")).toHaveCount(12);
    release();
    await expect(page.locator(".pbi-title")).toHaveCount(0);
    await expect(page.locator("#pbi-picker")).toBeHidden();
    await expect(page.locator("#pbi-options")).toBeEmpty();
    await expect(page.locator("#pbi-missing")).toBeEmpty();
    expect(fixture.writes).toEqual([]);
  } finally {
    release();
  }
});

test("20PBIのAllはボード内の縦scrollを使い最後のPBI/付箋まで通常操作で到達できる", async ({
  page,
}) => {
  const fixture = await prepare(page, 20);
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await chooseRows(page, "all");
  await expect(page.locator(".pbi-title")).toHaveCount(20);
  const outer = page.locator("#board-scroll");
  await expect(outer).toHaveClass(/overview-scroll/);
  expect(await outer.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  const lastPbi = page.locator('.pbi-title[data-pbi="p19"]');
  await lastPbi.scrollIntoViewIfNeeded();
  await expect
    .poll(() => outer.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await lastPbi.click();
  await expect(page.locator("#detail-meta")).toHaveText("#20");
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  const cell = page.locator('[data-lane="p19"][data-status="ToDo"]');
  await expect(cell).toHaveCSS("padding-top", "2px");
  await expect(cell).toHaveCSS("padding-bottom", "2px");
  const port = cell.locator(".cell-viewport");
  await port.focus();
  await page.keyboard.press("End");
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  const title = cell.locator('[data-task="t19-4"] .task-title');
  await title.click();
  await expect(page.locator("#detail-meta")).toHaveText("#484");
  await expect(page.locator("#detail-heading")).toHaveText(
    fixture.board.tasks[19 * 17 + 4].title,
  );
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  await page.screenshot({
    path: `test-results/managed-pbis-20-all-bottom-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(
    0,
  );
  expect(fixture.writes).toEqual([]);
});

test("N/Pで6件の後半pageからAllへ往復しanchor維持、All再読込後もNは6へ戻る", async ({
  page,
}) => {
  const fixture = await prepare(page, 12);
  const before = await selection(page);
  await page.locator("#next-page").click();
  await expect(page.locator("#page-info")).toHaveText("PBI 7–12 / 12");
  const reads = [...fixture.reads];
  await page.locator("#board").focus();
  await page.keyboard.press("p");
  await expect(page.locator("#fit-mode")).toHaveValue("all");
  await expect(page.locator(".pbi-title")).toHaveCount(12);
  await expect(page.locator("#board")).toHaveClass(/overview/);
  const card = await page.locator('[data-task="t6-0"]').elementHandle();
  await page.keyboard.press("p");
  await expect(page.locator("#fit-mode")).toHaveValue("all");
  expect(await card!.evaluate((node) => node.isConnected)).toBe(true);
  await page.keyboard.press("n");
  await expect(page.locator("#fit-mode")).toHaveValue("6");
  await expect(page.locator("#page-info")).toHaveText("PBI 7–12 / 12");
  await expect(page.locator('[data-pbi="p6"].pbi-title')).toBeVisible();
  expect(await selection(page)).toEqual(before);
  expect(fixture.reads).toEqual(reads);

  // Existing persisted lastRows=3 must not revive the superseded All shortcut rule.
  await chooseRows(page, 3);
  await chooseRows(page, "all");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      rowsKey,
    ),
  ).toEqual({ value: "all", lastRows: 3 });
  await page.reload();
  await expect(page.locator("#fit-mode")).toHaveValue("all");
  await expect(page.locator(".pbi-title")).toHaveCount(12);
  await page.locator("#board").focus();
  await page.keyboard.press("p");
  await expect(page.locator("#fit-mode")).toHaveValue("all");
  await page.keyboard.press("n");
  await expect(page.locator("#fit-mode")).toHaveValue("6");
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      rowsKey,
    ),
  ).toEqual({ value: 6, lastRows: 6 });
  expect(await selection(page)).toEqual(before);
  expect(fixture.writes).toEqual([]);
});
