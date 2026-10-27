import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
import { readFile } from "node:fs/promises";
const asset =
  "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000011";
const comment = (id, body) => ({
  id,
  body,
  url: `https://github.com/engineer-first/idea-boost/issues/100#issuecomment-${id}`,
  createdAt: "2026-10-26T00:00:00Z",
  author: { login: "tester", type: "User" },
});

test("unchanged comments preserve media across refresh and metadata changes", async ({
  page,
}) => {
  await setup(page);
  let reads = 0,
    videoRequests = 0;
  const video = await readFile("tests/fixtures/media.webm");
  await page.route(asset, (r) => {
    videoRequests++;
    return r.fulfill({ contentType: "video/webm", body: video });
  });
  await page.route("**/api/issues/*/comments*", (r) => {
    reads++;
    return r.fulfill({
      json: {
        comments: [
          {
            ...comment(1, asset),
            author: { login: reads > 1 ? "renamed" : "tester", type: "User" },
          },
        ],
        nextPage: null,
      },
    });
  });
  await page.locator(".task-title").first().click();
  await expect(page.locator("#comments-list .media-shell")).toHaveCount(1);
  await page
    .locator("#comments-list .media-shell")
    .first()
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(0);
  const beforeRefresh = videoRequests;
  await page.locator("video").evaluate((v) => (v.dataset.retained = "yes"));
  await page.locator("#comments-refresh").click();
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator("#comments-refresh")).toBeEnabled();
  await expect(page.locator('video[data-retained="yes"]')).toHaveCount(1);
  expect(videoRequests).toBe(beforeRefresh);
  await expect(page.locator("#comments-list strong")).toHaveText("renamed");
  console.log(
    JSON.stringify({
      metric: "comment-refresh",
      width: page.viewportSize()!.width,
      videoRequests,
      retained: await page.locator('video[data-retained="yes"]').count(),
    }),
  );
});

test("rapid-scroll images share dialog observer and bound transfers; close cancels queue", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = window.IntersectionObserver;
    (window as any).mediaRoots = [];
    window.IntersectionObserver = class extends Original {
      constructor(callback, options) {
        super(callback, options);
        (window as any).mediaRoots.push(options?.root?.id || null);
      }
    };
  });
  await setup(page);
  // Keep this fixture explicitly outside the 200px near-view margin.
  // Natural comment position depends on live-editor hydration timing.
  await page.addStyleTag({
    content: ".issue-comments { margin-top: 2000px !important; }",
  });
  let active = 0,
    maxActive = 0,
    requests = 0;
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(
    "https://user-images.githubusercontent.com/1/perf-*.gif",
    async (r) => {
      active++;
      requests++;
      maxActive = Math.max(active, maxActive);
      await gate;
      active--;
      await r.fulfill({
        contentType: "image/gif",
        body: Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64",
        ),
      });
    },
  );
  const comments = Array.from({ length: 14 }, (_, i) =>
    comment(
      i + 1,
      `![画像${i}](https://user-images.githubusercontent.com/1/perf-${i}.gif)`,
    ),
  );
  await page.route("**/api/issues/*/comments*", (r) =>
    r.fulfill({ json: { comments, nextPage: null } }),
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator("#comments-list .media-shell")).toHaveCount(14);
  const initial = requests;
  for (const i of [0, 3, 6, 9, 12]) {
    await page
      .locator("#comments-list .media-shell")
      .nth(i)
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  console.log(
    JSON.stringify({
      metric: "rapid-scroll",
      width: page.viewportSize()!.width,
      initial,
      requests,
      maxActive,
      roots: await page.evaluate(() => (window as any).mediaRoots),
    }),
  );
  expect(initial).toBe(0);
  expect(maxActive).toBe(3);
  const roots = await page.evaluate(() => (window as any).mediaRoots);
  expect(roots.filter((r) => r === "details")).toHaveLength(1);
  const beforeClose = requests;
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  release();
  await page.waitForTimeout(150);
  expect(requests).toBe(beforeClose);
});

test("live image completion during accepted close never starts queued transfers", async ({
  page,
}) => {
  const s = await setup(page);
  s.board.tasks[0].body = Array.from(
    { length: 6 },
    (_, i) =>
      `![live${i}](https://user-images.githubusercontent.com/1/closing-${i}.gif)`,
  ).join("\n\n");
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  // Keep six real live widgets inside the viewport, so three transfers queue.
  await page.addStyleTag({
    content:
      ".media-frame {height:40px!important;min-height:40px!important;aspect-ratio:auto!important} .media-shell {margin:0!important}",
  });
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(
    "https://user-images.githubusercontent.com/1/closing-*.gif",
    async (r) => {
      await gate;
      await r.abort();
    },
  );
  await page.locator(".task-title").first().click();
  const images = page.locator(".cm-content .media-shell img");
  await expect(images).toHaveCount(6);
  await expect(page.locator(".cm-content .media-shell img[src]")).toHaveCount(
    3,
  );
  await page.waitForTimeout(100);
  const result = await page.evaluate(async () => {
    const images = [
      ...document.querySelectorAll<HTMLImageElement>(
        ".cm-content .media-shell img",
      ),
    ];
    const waiting = images.filter((i) => !i.hasAttribute("src"));
    const active = images.find((i) => i.hasAttribute("src"))!;
    (document.querySelector("#close-detail") as HTMLButtonElement).click();
    // A retained network callback after synchronous teardown must stay inert.
    active.dispatchEvent(new Event("load"));
    await Promise.resolve();
    return {
      closing: document
        .querySelector("#details")!
        .classList.contains("closing"),
      waiting: waiting.length,
      newlyStarted: waiting.filter((i) => i.hasAttribute("src")).length,
    };
  });
  release();
  expect(result).toEqual({ closing: false, waiting: 3, newlyStarted: 0 });
  await expect(page.locator("#details")).not.toBeVisible();
  expect(s.posts()).toBe(0);
});
