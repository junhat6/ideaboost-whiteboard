import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
import { readFile } from "node:fs/promises";
const asset =
  "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000001";
const imageUrl = "https://user-images.githubusercontent.com/1/example.gif";
const comment = {
  id: 1,
  body: "## コメント\n本文<script>window.bad=1</script>",
  url: "https://github.com/engineer-first/idea-boost/issues/100#issuecomment-1",
  createdAt: "2026-10-26T00:00:00Z",
  author: {
    login: "tester",
    type: "User",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
  },
};
async function open(page) {
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
}
test("inline pencil rename accepts locally, cancels with Escape, and preview keeps 16px body", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await page.screenshot({
    path: `.wrangler/enhancement-editor-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  const original = await page.locator("#detail-heading").innerText();
  await expect(page.locator("#rename-issue svg")).toHaveCount(1);
  await expect(page.locator("#finish-title")).toHaveCount(0);
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("新しいタイトル");
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail-heading")).toHaveText("新しいタイトル");
  expect(s.posts()).toBe(0);
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("取り消す");
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-heading")).toHaveText("新しいタイトル");
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill(original);
  await page.locator("#markdown-preview").click();
  await expect(page.locator("#detail-body-view p").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(page.locator("#detail-body-view p").first()).toHaveCSS(
    "color",
    "rgb(32, 37, 43)",
  );
  await page.locator("#markdown-write").click();
  await expect(page.locator(".cm-content")).toHaveCSS("font-size", "16px");
  expect(s.posts()).toBe(0);
});
test("comments load separately, preserve drafts on refresh, post explicitly as App and prevent double submit", async ({
  page,
}) => {
  const s = await setup(page);
  let posts = 0,
    entries = [comment];
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/*/comments*", async (route) => {
    if (route.request().method() === "GET") {
      await gate;
      return route.fulfill({ json: { comments: entries, nextPage: null } });
    }
    posts++;
    const data = route.request().postDataJSON();
    expect(data).toHaveProperty("requestId");
    entries = [
      ...entries,
      {
        ...comment,
        id: 2,
        body: data.body,
        author: { ...comment.author, login: "app[bot]", type: "Bot" },
      },
    ];
    await route.fulfill({
      status: 201,
      json: { ok: true, comment: entries[1] },
    });
  });
  await open(page);
  await expect(page.locator("#comments-status")).toContainText("読み込み中");
  await page.locator("#comment-body").fill("下書きコメント");
  release();
  await expect(page.locator(".issue-comment")).toHaveCount(1);
  await expect(page.locator("#comment-body")).toHaveValue("下書きコメント");
  await page.locator("#comments-refresh").click();
  await expect(page.locator("#comment-body")).toHaveValue("下書きコメント");
  await expect(page.locator(".comment-identity")).toContainText("GitHub App");
  await page.evaluate(() => {
    const f = document.querySelector("#comment-form") as HTMLFormElement;
    f.requestSubmit();
    f.requestSubmit();
  });
  await expect.poll(() => posts).toBe(1);
  await expect(page.locator("#comment-state")).toContainText("投稿しました");
  await expect(page.locator("#comment-body")).toHaveValue("");
  await expect(page.locator(".issue-comment")).toHaveCount(2);
  expect(s.posts()).toBe(0);
  await expect(page.locator(".issue-comment script")).toHaveCount(0);
});
test("unknown comment result retains draft and blocks replay after GET and reopen; IME never submits", async ({
  page,
}) => {
  await setup(page);
  let posts = 0;
  await page.route("**/api/issues/*/comments*", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { comments: [], nextPage: null } });
    posts++;
    return route.abort("connectionreset");
  });
  await open(page);
  await page.locator("#comment-body").fill("不明の下書き");
  await page.locator("#comment-body").dispatchEvent("compositionstart");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(posts).toBe(0);
  await page.locator("#comment-body").dispatchEvent("compositionend");
  await page.locator("#post-comment").click();
  await expect(page.locator("#comment-error")).toContainText("再投稿を停止");
  await page.locator("#comments-refresh").click();
  await expect(page.locator("#comment-body")).toHaveValue("不明の下書き");
  await expect(page.locator("#post-comment")).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await page.locator("#details").waitFor({ state: "hidden" });
  await open(page);
  await expect(page.locator("#comment-error")).toContainText("再投稿を停止");
  expect(posts).toBe(1);
});
test("safe lazy media never delays text; video has no request before play and stops on close", async ({
  page,
}) => {
  const s = await setup(page);
  let imageRequests = 0,
    videoRequests = 0;
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(imageUrl, async (r) => {
    imageRequests++;
    await gate;
    await r.fulfill({
      contentType: "image/gif",
      body: Buffer.from(
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        "base64",
      ),
    });
  });
  const video = await readFile("tests/fixtures/media.webm");
  await page.route(asset, (r) => {
    videoRequests++;
    return r.fulfill({ contentType: "video/webm", body: video });
  });
  await open(page);
  await page
    .locator(".cm-content")
    .fill(
      `本文は先に表示\n\n![画像](${imageUrl})\n\n${asset}\n\n\`\`\`\n${asset}\n\`\`\`\n\n![危険](https://github.com.evil/x)`,
    );
  await page.locator("#markdown-preview").click();
  await expect(page.locator("#detail-body-view")).toContainText(
    "本文は先に表示",
  );
  expect(videoRequests).toBe(0);
  await expect(page.locator(".media-shell")).toHaveCount(2);
  await expect(page.locator('#detail-body-view img[src*="evil"]')).toHaveCount(
    0,
  );
  await expect.poll(() => imageRequests).toBe(1);
  release();
  await expect
    .poll(() =>
      page
        .locator(".media-frame img")
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBe(1);
  await page.getByRole("button", { name: "動画として再生" }).click();
  await expect.poll(() => videoRequests).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThan(0);
  page.once("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await page.locator("#details").waitFor({ state: "hidden" });
  await expect(page.locator("video")).toHaveCount(0);
  expect(s.posts()).toBe(0);
});
test("type colors are stable across Status moves and update for actual type changes; F ignores input", async ({
  page,
}) => {
  const s = await setup(page);
  const card = page.locator('[data-task="t0-0-0"]');
  await expect(card).toHaveClass(/type-task/);
  await expect(card).not.toContainText("⠿");
  const color = await card.evaluate((e) => getComputedStyle(e).backgroundColor);
  s.board.tasks[0].status = "作業中";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.locator(".raw-status")).toHaveText("作業中");
  expect(await card.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    color,
  );
  s.board.tasks[0].type = "競合調査";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card).toHaveClass(/type-research/, { timeout: 8000 });
  await expect(card.locator(".type-cue")).toHaveAttribute(
    "aria-label",
    "Issue type: 競合調査",
  );
  await page.screenshot({
    path: `.wrangler/enhancement-board-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  s.board.tasks[0].type = "新しい種別";
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await expect(card).toHaveClass(/type-unknown/);
  await page.keyboard.press("f");
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.keyboard.press("f");
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.keyboard.press("Shift+f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.locator("#operations").click();
  await page.locator("#search").fill("f");
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.locator("#search").fill("");
  await page.locator(".task-title").nth(20).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("f");
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").fill("f");
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await page.locator("#comment-body").fill("f");
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});
test("toolbar opens across actual header upper half and respects dismissal until pointer leaves", async ({
  page,
}) => {
  await setup(page);
  const box = await page.locator(".board-head").boundingBox();
  const x = box!.x + 200;
  await page.mouse.move(x, box!.y + box!.height * 0.75);
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.mouse.move(x, box!.y + box!.height * 0.45);
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await page.locator(".task-title").nth(20).click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await page.keyboard.press("Escape");
  await page.locator("#details").waitFor({ state: "hidden" });
  await page.mouse.move(x, box!.y + box!.height + 50);
  await page.mouse.move(x, box!.y + box!.height * 0.4);
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
});
test("known private transition through comment read clears prior board and detail", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page.route("**/api/issues/*/comments*", (route) =>
    route.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await page.locator("#comments-refresh").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".task")).toHaveCount(0);
});
test("older first comment page never hides confirmed new post during overlapping GET", async ({
  page,
}) => {
  await setup(page);
  let release;
  const gate = new Promise<void>((r) => (release = r));
  const old = Array.from({ length: 50 }, (_, i) => ({
    ...comment,
    id: i + 1,
    body: `以前のコメント${i + 1}`,
  }));
  await page.route("**/api/issues/*/comments*", async (route) => {
    if (route.request().method() === "GET") {
      await gate;
      return route.fulfill({ json: { comments: old, nextPage: 2 } });
    }
    return route.fulfill({
      status: 201,
      json: {
        ok: true,
        comment: { ...comment, id: 100, body: "今投稿した内容" },
      },
    });
  });
  await open(page);
  await page.locator("#comment-body").fill("今投稿した内容");
  await page.locator("#post-comment").click();
  await expect(page.locator("#comment-state")).toContainText("投稿しました");
  release();
  await expect(page.locator(".issue-comment")).toHaveCount(51);
  await expect(page.locator("#comments-list")).toContainText("今投稿した内容");
  await expect(page.locator("#comments-list")).toContainText("投稿時の内容");
  await expect(page.locator("#comment-state")).toContainText("投稿しました");
});
test("post acknowledgement with private transition clears previous content and media immediately", async ({
  page,
}) => {
  await setup(page);
  await open(page);
  await page.route("**/api/issues/*/comments*", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 502,
          json: { error: "scope_not_public", ambiguous: true },
        })
      : route.fulfill({ json: { comments: [], nextPage: null } }),
  );
  await page.locator("#comment-body").fill("投稿時に公開範囲変更");
  await page.locator("#post-comment").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".task")).toHaveCount(0);
  await expect(page.locator("#comment-body")).toHaveValue("");
  await expect(page.locator("video")).toHaveCount(0);
});
