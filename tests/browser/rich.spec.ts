import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
import { readFile } from "node:fs/promises";

test("author is distinct, avatar tiles preserve multiple and outside assignments, status colors match column representative", async ({
  page,
}) => {
  const s = await setup(page);
  const author = {
    login: "creator",
    name: "作成した人",
    avatarUrl: "https://avatars.githubusercontent.com/u/2",
    url: "https://github.com/creator",
    type: "User",
  };
  Object.assign(s.board.tasks[0], {
    author,
    assignees: [
      {
        login: "outside",
        name: "既存担当",
        avatarUrl: "https://avatars.githubusercontent.com/u/3",
      },
    ],
  });
  (s.board.scope as any).statusColors = [
    { name: "未整理", color: "GRAY" },
    { name: "作業中", color: "YELLOW" },
    { name: "レビュー中", color: "ORANGE" },
    { name: "完了", color: "GREEN" },
  ];
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator("#issue-author")).toContainText(
    "作成した人 (@creator)",
  );
  await expect(page.locator("#issue-author a")).toHaveAttribute(
    "href",
    "https://github.com/creator",
  );
  await expect(
    page.getByRole("button", { name: "担当者 既存担当 (@outside)" }),
  ).toHaveAttribute("aria-pressed", "true");
  const tile = page.getByRole("button", {
    name: "担当者 検証担当者 (@tester)",
  });
  await tile.focus();
  await page.keyboard.press("Space");
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  expect(
    await page
      .locator("#detail-assignee")
      .evaluate((s: HTMLSelectElement) =>
        [...s.selectedOptions].map((o) => o.value).sort(),
      ),
  ).toEqual(["outside", "tester"]);
  await page.getByRole("button", { name: "レビュー中", exact: true }).click();
  await expect(page.locator("#detail-status")).toHaveValue("レビュー中");
  expect(
    await page
      .locator('[data-status="レビュー中"] .status-dot')
      .evaluate((el) => getComputedStyle(el).borderTopColor),
  ).toBe(
    await page
      .locator(".board-head .status-dot.wait")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  expect(s.posts()).toBe(0);
  page.once("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator(".task-title").first().click();
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `.wrangler/rich-${page.viewportSize()!.width}.png`,
  });
});

test("progress has one segment per task with zero and dense fallback, counts refresh", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.tasks = s.board.tasks.filter((t) => t.lane !== "p0");
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  const p = page.locator('[data-pbi-row="p0"] .progress-track');
  await expect(p).toHaveAttribute("aria-valuetext", "0/0件完了");
  for (const n of [1, 6, 41]) {
    s.board.tasks = s.board.tasks.filter((t) => t.lane !== "p0");
    s.board.tasks.push(
      ...Array.from({ length: n }, (_, i) => ({
        ...s.board.tasks[0],
        id: `new${i}`,
        lane: "p0",
        status: i === 0 ? "完了" : "未整理",
      })),
    );
    await page.evaluate(
      (b) => (window as any).Whiteboard.applySnapshot(b),
      s.board,
    );
    await expect(p).toHaveAttribute("aria-valuenow", "1");
    await expect(p).toHaveAttribute("aria-valuemax", String(n));
    if (n <= 40) await expect(p.locator(".progress-segment")).toHaveCount(n);
    else await expect(p).toHaveAttribute("title", /多数/);
  }
});

test("Mermaid is lazy, isolated, zoomable and preserves raw source; unsafe diagram has no network", async ({
  page,
}) => {
  const s = await setup(page);
  let workerRequests = 0,
    external = 0;
  page.on("request", (r) => {
    if (r.url().includes("diagram-worker.js")) workerRequests++;
    if (r.url().includes("evil.example")) external++;
  });
  expect(workerRequests).toBe(0);
  const raw =
    "## 図\r\n\r\n```mermaid\r\nflowchart LR\r\n A[日本語の入力] --> B[確認]\r\n```\r\n\r\n```mermaid\r\nsequenceDiagram\r\n actor U as 利用者\r\n U->>U: 開く\r\n```";
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".diagram-shell svg")).toHaveCount(2);
  expect(workerRequests).toBe(1);
  const first = page.locator(".diagram-shell").first();
  await first.getByRole("button", { name: "拡大", exact: true }).click();
  await expect(first.locator("svg")).toHaveCSS("width", /px/);
  await first.getByRole("button", { name: "全体を表示" }).click();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#detail-body")).toHaveValue(
    raw.replaceAll("\r\n", "\n"),
  );
  await expect(page.locator(".format-actions")).toHaveCount(0);
  await page.screenshot({
    path: `.wrangler/diagram-${page.viewportSize()!.width}.png`,
  });
  s.board.tasks[0].body =
    '```mermaid\nflowchart LR\n A["<img src=https://evil.example/x onerror=alert(1)>"] --> B\n click A "https://evil.example/link"\n```';
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await expect(page.locator(".diagram-shell svg")).toHaveCount(1);
  await expect(
    page.locator(
      ".diagram-shell image,.diagram-shell a,.diagram-shell foreignObject",
    ),
  ).toHaveCount(0);
  expect(external).toBe(0);
  expect(s.posts()).toBe(0);
});

test("near unknown attachments automatically decode image and paused video, offscreen does not request", async ({
  page,
}) => {
  const s = await setup(page);
  const videoUrl =
      "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000077",
    imageUrl = videoUrl.replace(/77$/, "78"),
    farUrl = videoUrl.replace(/77$/, "79");
  let far = 0;
  const video = await readFile("tests/fixtures/media.webm");
  await page.route(videoUrl, (r) =>
    r.fulfill({ contentType: "video/webm", body: video }),
  );
  await page.route(imageUrl, (r) =>
    r.fulfill({
      contentType: "image/gif",
      body: Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    }),
  );
  await page.route(farUrl, (r) => {
    far++;
    return r.abort();
  });
  s.board.tasks[0].body = `本文が先\n\n${videoUrl}\n\n${imageUrl}\n\n${"段落\n\n".repeat(120)}${farUrl}`;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toContainText("本文が先");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(1);
  expect(
    await page
      .locator("video")
      .evaluate(
        (v: HTMLVideoElement) =>
          v.paused && !v.autoplay && v.currentTime < 0.01,
      ),
  ).toBe(true);
  await page.locator(".media-shell").nth(1).scrollIntoViewIfNeeded();
  await expect(page.locator('[data-preview="image"]')).toHaveCount(1);
  expect(far).toBe(0);
  await expect(page.locator("video")).not.toHaveAttribute("autoplay", "");
  expect(s.posts()).toBe(0);
});

test("thumbnail queue limits video decoding and closing cancels pending previews", async ({
  page,
}) => {
  const s = await setup(page);
  const video = await readFile("tests/fixtures/media.webm");
  let mediaRequests = 0;
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(
    "https://github.com/user-attachments/assets/**",
    async (r) => {
      if (r.request().resourceType() === "image")
        return r.fulfill({ contentType: "video/webm", body: video });
      mediaRequests++;
      await gate;
      await r.fulfill({ contentType: "video/webm", body: video });
    },
  );
  s.board.tasks[0].body = Array.from(
    { length: 6 },
    (_, i) =>
      `https://github.com/user-attachments/assets/00000000-0000-4000-8000-${String(i + 100).padStart(12, "0")}`,
  ).join("\n\n");
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.addStyleTag({
    content:
      ".media-frame{height:40px!important;min-height:40px!important;aspect-ratio:auto!important}.media-shell{margin:0!important}",
  });
  await page.locator(".task-title").first().click();
  await expect.poll(() => mediaRequests).toBe(1);
  await page.waitForTimeout(150);
  expect(mediaRequests).toBe(1);
  await page.locator("#close-detail").click();
  release();
  await expect(page.locator("#details")).not.toBeVisible();
  expect(mediaRequests).toBe(1);
  expect(s.posts()).toBe(0);
});

test("manual play cancels preview timeout and late metadata cannot seek playback", async ({
  page,
}) => {
  const s = await setup(page);
  const video = await readFile("tests/fixtures/media.webm"),
    url =
      "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000188";
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(url, async (r) => {
    if (r.request().resourceType() === "media") await gate;
    await r.fulfill({ contentType: "video/webm", body: video });
  });
  s.board.tasks[0].body = url;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator("video[src]")).toHaveCount(1);
  await page.clock.install();
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    void v.play().catch(() => {});
  });
  await page.clock.fastForward(13000);
  await expect(page.locator("video[src]")).toHaveCount(1);
  release();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(1);
  expect(s.posts()).toBe(0);
});

test("diagram deadline terminates worker and retains source; author bot and null never use assignee", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).terminated = 0;
    (window as any).Worker = class {
      onmessage;
      onerror;
      postMessage() {}
      terminate() {
        (window as any).terminated++;
      }
    };
  });
  const s = await setup(page);
  s.board.tasks[0].body = "```mermaid\nflowchart LR\nA-->B\n```";
  (s.board.tasks[0] as any).author = {
    login: "helper[bot]",
    url: "https://github.com/apps/helper",
    type: "Bot",
  };
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator("#issue-author")).toContainText("helper[bot]");
  await expect(page.locator("#issue-author")).toContainText("Bot");
  await expect(page.locator(".diagram-status")).toHaveText("図を描画中…");
  await page.clock.install();
  await page.clock.fastForward(3100);
  await expect(page.locator(".diagram-status")).toContainText(
    "図を表示できません",
  );
  expect(await page.evaluate(() => (window as any).terminated)).toBe(1);
  await expect(page.locator(".diagram-shell details")).toBeVisible();
  (s.board.tasks[0] as any).author = null;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await expect(page.locator("#issue-author")).toContainText("削除済み・不明");
  await expect(page.locator("#issue-author")).not.toContainText("tester");
});
