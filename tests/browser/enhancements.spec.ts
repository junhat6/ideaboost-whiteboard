import { test, expect, type Page } from "@playwright/test";
import {
  setup,
  fillEditor,
  renderReadHarness,
  closeReadHarness,
} from "./fixtures";
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
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
function postedComment(id: number, body: string, issue = 100) {
  return {
    ...comment,
    id,
    body,
    url: `https://github.com/engineer-first/idea-boost/issues/${issue}#issuecomment-${id}`,
    author: { ...comment.author, login: "app[bot]", type: "Bot" },
  };
}
async function selectCommentDraft(page: Page, body: string) {
  const input = page.locator("#comment-body");
  await input.fill(body);
  await input.focus();
  await input.evaluate((element: HTMLTextAreaElement) =>
    element.setSelectionRange(2, 7),
  );
}
async function expectCommentDraft(page: Page, body: string) {
  const input = page.locator("#comment-body");
  await expect(input).toHaveValue(body);
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element: HTMLTextAreaElement) => [
      element.selectionStart,
      element.selectionEnd,
    ]),
  ).toEqual([2, 7]);
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
  await renderReadHarness(page);
  await expect(page.locator("#detail-body-view p").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  await expect(page.locator("#detail-body-view p").first()).toHaveCSS(
    "color",
    "rgb(24, 43, 73)",
  );
  await closeReadHarness(page);
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
  await expect(page.locator("#comment-state")).toHaveText("");
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
  await expect(page.locator("#comment-body")).toHaveValue("不明の下書き");
  await expect(page.locator("#post-comment")).toBeDisabled();
  expect(posts).toBe(1);
});
test("comment POST acknowledgement unlocks input and close before background GET, preserving the next draft selection", async ({
  page,
}) => {
  const s = await setup(page),
    refreshGate = deferred(),
    closeGate = deferred();
  let reads = 0,
    posts = 0,
    entries = [comment];
  await page.route("**/api/issues/*/comments*", async (route) => {
    if (route.request().method() === "GET") {
      const n = ++reads;
      if (n === 2) await refreshGate.promise;
      if (n === 3) await closeGate.promise;
      return route.fulfill({ json: { comments: entries, nextPage: null } });
    }
    posts++;
    const posted = postedComment(2, route.request().postDataJSON().body);
    entries = [...entries, posted];
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await open(page);
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await page.locator("#comment-body").fill("投稿済みのコメント");
    await page.locator("#post-comment").click();
    await expect.poll(() => reads).toBe(2);
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("#comment-body")).toBeEnabled();
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator("#post-comment")).toHaveText("コメントを投稿");
    await expect(page.locator(".issue-comment")).toHaveCount(2);
    const draft = "次のコメントを編集中です";
    await selectCommentDraft(page, draft);
    refreshGate.release();
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expectCommentDraft(page, draft);
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads).toBe(3);
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    const closedRefresh = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/issues/100/comments",
    );
    closeGate.release();
    await (await closedRefresh).finished();
    await expect(page.locator("#details")).not.toBeVisible();
    expect(posts).toBe(1);
    expect(s.posts()).toBe(0);
  } finally {
    refreshGate.release();
    closeGate.release();
  }
});
test("an older comment GET cannot unlock a newer POST or allow duplicate submission", async ({
  page,
}) => {
  const s = await setup(page),
    readGate = deferred(),
    postGate = deferred();
  let reads = 0,
    posts = 0,
    entries = [comment];
  await page.route("**/api/issues/*/comments*", async (route) => {
    if (route.request().method() === "GET") {
      const snapshot = [...entries];
      if (++reads === 2) await readGate.promise;
      return route.fulfill({ json: { comments: snapshot, nextPage: null } });
    }
    const n = ++posts,
      posted = postedComment(n + 1, route.request().postDataJSON().body);
    if (n === 2) await postGate.promise;
    entries = [...entries, posted];
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await open(page);
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await page.locator("#comment-body").fill("1件目");
    await page.locator("#post-comment").click();
    await expect.poll(() => reads).toBe(2);
    await page.locator("#comment-body").fill("2件目はPOST待機中");
    await page.evaluate(() => {
      const form = document.querySelector("#comment-form") as HTMLFormElement;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => posts).toBe(2);
    await expect(page.locator("#comment-body")).toBeDisabled();
    readGate.release();
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("#comment-body")).toBeDisabled();
    await expect(page.locator("#comment-body")).toHaveValue(
      "2件目はPOST待機中",
    );
    await expect(page.locator("#post-comment")).toBeDisabled();
    await expect(page.locator("#post-comment")).toHaveText("投稿中…");
    await page.evaluate(() =>
      (
        document.querySelector("#comment-form") as HTMLFormElement
      ).requestSubmit(),
    );
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    await open(page);
    await expect(page.locator("#comment-body")).toBeDisabled();
    await expect(page.locator("#comment-body")).toHaveValue(
      "2件目はPOST待機中",
    );
    await expect(page.locator("#post-comment")).toHaveText("投稿中…");
    expect(posts).toBe(2);
    postGate.release();
    await expect(page.locator("#comment-body")).toBeEnabled();
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator(".issue-comment")).toHaveCount(3);
    await expect.poll(() => reads).toBe(4);
    expect(posts).toBe(2);
    expect(s.posts()).toBe(0);
  } finally {
    readGate.release();
    postGate.release();
  }
});
for (const staleReadStatus of [200, 503])
  test(`comment acknowledgements during GET ${staleReadStatus} coalesce into one fresh read and retain confirmed posts and the next draft`, async ({
    page,
  }) => {
    const s = await setup(page),
      readGate = deferred();
    let reads = 0,
      posts = 0,
      entries = [comment];
    await page.route("**/api/issues/*/comments*", async (route) => {
      if (route.request().method() === "GET") {
        const snapshot = [...entries];
        if (++reads === 2) {
          await readGate.promise;
          if (staleReadStatus === 503)
            return route.fulfill({
              status: 503,
              json: { error: "unavailable" },
            });
        }
        return route.fulfill({ json: { comments: snapshot, nextPage: null } });
      }
      const posted = postedComment(
        ++posts + 1,
        route.request().postDataJSON().body,
      );
      entries = [...entries, posted];
      return route.fulfill({
        status: 201,
        json: { ok: true, comment: posted },
      });
    });
    try {
      await open(page);
      await expect(page.locator(".issue-comment")).toHaveCount(1);
      await page.locator("#comment-body").fill("1件目の確定コメント");
      await page.locator("#post-comment").click();
      await expect.poll(() => reads).toBe(2);
      await page.locator("#comment-body").fill("2件目の確定コメント");
      await page.locator("#post-comment").click();
      await expect(page.locator("#comment-body")).toBeEnabled();
      await expect(page.locator("#comment-body")).toHaveValue("");
      await expect(page.locator(".issue-comment")).toHaveCount(3);
      await expect(page.locator("#comments-list")).toContainText(
        "2件目の確定コメント",
      );
      expect(reads).toBe(2);
      expect(posts).toBe(2);
      const draft = "次の未送信コメントを選択中";
      await selectCommentDraft(page, draft);
      readGate.release();
      await expect.poll(() => reads).toBe(3);
      await expect(page.locator("#comments-list")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(page.locator("#comments-status")).toHaveText(
        "3件のコメント",
      );
      await expect(page.locator(".issue-comment")).toHaveCount(3);
      await expect(page.locator('[data-comment-id="2"]')).toHaveCount(1);
      await expect(page.locator('[data-comment-id="3"]')).toHaveCount(1);
      await expectCommentDraft(page, draft);
      expect(reads).toBe(3);
      expect(posts).toBe(2);
      expect(s.posts()).toBe(0);
    } finally {
      readGate.release();
    }
  });
test("switching Issue discards the old comment refresh queue without changing the new draft or loading state", async ({
  page,
}) => {
  const s = await setup(page),
    oldGate = deferred(),
    nextGate = deferred();
  let oldReads = 0,
    nextReads = 0,
    posts = 0,
    entries = [comment];
  await page.route("**/api/issues/*/comments*", async (route) => {
    const number = Number(
      new URL(route.request().url()).pathname.split("/").at(-2),
    );
    if (route.request().method() === "GET") {
      if (number === 101) {
        nextReads++;
        await nextGate.promise;
        return route.fulfill({
          json: {
            comments: [postedComment(101, "別Issueのコメント", 101)],
            nextPage: null,
          },
        });
      }
      const snapshot = [...entries];
      if (++oldReads === 2) await oldGate.promise;
      return route.fulfill({ json: { comments: snapshot, nextPage: null } });
    }
    const posted = postedComment(
      ++posts + 1,
      route.request().postDataJSON().body,
    );
    entries = [...entries, posted];
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await open(page);
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await page.locator("#comment-body").fill("旧Issueの1件目");
    await page.locator("#post-comment").click();
    await expect.poll(() => oldReads).toBe(2);
    await page.locator("#comment-body").fill("旧Issueの2件目");
    await page.locator("#post-comment").click();
    await expect(page.locator("#comment-body")).toBeEnabled();
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator(".issue-comment")).toHaveCount(3);
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    await page.locator(".task-title").nth(1).click();
    await expect.poll(() => nextReads).toBe(1);
    const draft = "別Issueで編集中のコメント";
    await selectCommentDraft(page, draft);
    const oldResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/issues/100/comments",
    );
    oldGate.release();
    await (await oldResponse).finished();
    // Let the stale response's promise and finally run before asserting no effects.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(".issue-comment")).toHaveCount(0);
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("#comments-refresh")).toBeDisabled();
    await expect(page.locator("#comments-status")).toContainText("読み込み中");
    await expectCommentDraft(page, draft);
    expect(oldReads).toBe(2);
    expect(nextReads).toBe(1);
    nextGate.release();
    await expect(page.locator("#comments-list")).toContainText(
      "別Issueのコメント",
    );
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await expect(page.locator("#comments-list")).not.toContainText("旧Issue");
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expectCommentDraft(page, draft);
    expect(oldReads).toBe(2);
    expect(nextReads).toBe(1);
    expect(posts).toBe(2);
    expect(s.posts()).toBe(0);
  } finally {
    oldGate.release();
    nextGate.release();
  }
});
test("a stale comment GET 403 clears public content and pending refreshes even after switching Issue", async ({
  page,
}) => {
  const s = await setup(page),
    privateGate = deferred();
  let oldReads = 0,
    nextReads = 0,
    posts = 0;
  await page.route("**/api/issues/*/comments*", async (route) => {
    const number = Number(
      new URL(route.request().url()).pathname.split("/").at(-2),
    );
    if (route.request().method() === "GET") {
      if (number === 101) {
        nextReads++;
        return route.fulfill({
          json: {
            comments: [postedComment(101, "別Issueの公開コメント", 101)],
            nextPage: null,
          },
        });
      }
      if (++oldReads === 2) {
        await privateGate.promise;
        return route.fulfill({
          status: 403,
          json: { error: "scope_not_public" },
        });
      }
      return route.fulfill({ json: { comments: [comment], nextPage: null } });
    }
    const posted = postedComment(
      ++posts + 1,
      route.request().postDataJSON().body,
    );
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await open(page);
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await page.locator("#comment-body").fill("公開中の1件目");
    await page.locator("#post-comment").click();
    await expect.poll(() => oldReads).toBe(2);
    await page.locator("#comment-body").fill("公開中の2件目");
    await page.locator("#post-comment").click();
    await expect(page.locator("#comment-body")).toBeEnabled();
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator(".issue-comment")).toHaveCount(3);
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    await page.locator(".task-title").nth(1).click();
    await expect(page.locator("#comments-list")).toContainText(
      "別Issueの公開コメント",
    );
    await page.locator("#comment-body").fill("失効時に破棄する下書き");
    privateGate.release();
    await expect(page.locator("#details")).not.toBeVisible();
    await expect(page.locator(".task")).toHaveCount(0);
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator(".issue-comment")).toHaveCount(0);
    expect(oldReads).toBe(2);
    expect(nextReads).toBe(1);
    expect(posts).toBe(2);
    expect(s.posts()).toBe(0);
  } finally {
    privateGate.release();
  }
});
test("safe lazy media never delays text; video previews without autoplay and stops on close", async ({
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
  await renderReadHarness(page);
  await expect(page.locator("#detail-body-view")).toContainText(
    "本文は先に表示",
  );
  await expect(page.locator(".media-shell")).toHaveCount(2);
  await expect(page.locator('#detail-body-view img[src*="evil"]')).toHaveCount(
    0,
  );
  // The live surface and the explicitly opened reading surface may each start
  // their own lazy image before the first surface is destroyed. Scheduling must
  // not decide whether this test passes; video still has zero pre-click requests.
  await expect.poll(() => imageRequests).toBeGreaterThanOrEqual(1);
  expect(imageRequests).toBeLessThanOrEqual(2);
  release();
  await expect
    .poll(() =>
      page
        .locator(".media-frame img")
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBe(1);
  await page
    .locator("#detail-body-view .media-shell")
    .last()
    .scrollIntoViewIfNeeded();
  await expect.poll(() => videoRequests).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(true);
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
  await expect(
    page.locator('[data-lane="p0"][data-status="Doing"] [data-task="t0-0-0"]'),
  ).toHaveCount(1);
  await expect(card.locator(".raw-status, .type-cue")).toHaveCount(0);
  expect(await card.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(
    color,
  );
  s.board.tasks[0].type = "競合調査";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card).toHaveClass(/type-research/, { timeout: 8000 });
  await expect(card).toHaveAttribute("data-issue-type", "競合調査");
  await expect(card.locator(".type-cue")).toHaveCount(0);
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
  await fillEditor(page, "f");
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
  await expect(page.locator("#comment-state")).toHaveText("");
  release();
  await expect(page.locator(".issue-comment")).toHaveCount(51);
  await expect(page.locator("#comments-list")).toContainText("今投稿した内容");
  await expect(page.locator("#comments-list")).toContainText("投稿時の内容");
  await expect(page.locator("#comment-state")).toHaveText("");
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
