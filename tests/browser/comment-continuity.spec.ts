import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

function comment(number: number, id: number, body: string) {
  return {
    id,
    body,
    url: `https://github.com/engineer-first/idea-boost/issues/${number}#issuecomment-${id}`,
    createdAt: "2026-10-28T00:00:00Z",
    author: { login: "tester", type: "User" },
  };
}

async function openIssue(page: Page, id: string) {
  await page.locator(`[data-open="${id}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#comments-refresh")).toBeEnabled();
}

async function twoFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function protectsUnload(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

async function closeIssue(page: Page, discardDraft = false) {
  if (discardDraft) page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
}

async function refreshDone(page: Page) {
  await expect(page.locator("#comments-list")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#comments-refresh")).toBeEnabled();
}

function commentReply(page: Page, number = 100, method = "POST") {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === `/api/issues/${number}/comments`,
  );
}

test("pending comments allow normal close and Escape without overwriting another Issue draft", async ({
  page,
}) => {
  const fixture = await setup(page);
  const gates = new Map([
    [100, gate()],
    [101, gate()],
  ]);
  const posts: { number: number; body: string }[] = [];
  const inflight: Promise<void>[] = [];
  let unavailableA = false;
  await page.route("**/api/issues/*/comments*", (route) => {
    const number = Number(
      new URL(route.request().url()).pathname.split("/")[3],
    );
    if (route.request().method() !== "POST")
      return unavailableA && number === 100
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fallback();
    const work = (async () => {
      const { body } = route.request().postDataJSON();
      posts.push({ number, body });
      await gates.get(number)!.promise;
      await route.fulfill({
        json: { ok: true, comment: comment(number, number + 1000, body) },
      });
    })();
    inflight.push(work);
    return work;
  });
  try {
    await openIssue(page, "t0-0-0");
    await page.locator("#comment-body").fill("A の送信済みコメント");
    await page.locator("#post-comment").click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(page.locator("#post-comment")).toHaveText("投稿中…");

    // Actual close control, not dialog.close(): a submitted POST must not lock
    // the entire drawer until the network acknowledges it.
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    await openIssue(page, "t0-0-1");
    await page.locator("#comment-body").fill("B の未送信コメント");
    const acknowledged = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/issues/100/comments",
    );
    gates.get(100)!.release();
    await (await acknowledged).finished();
    await twoFrames(page);
    await expect(page.locator("#comment-body")).toHaveValue(
      "B の未送信コメント",
    );
    await expect(page.locator("#comments-list .issue-comment")).toHaveCount(0);
    await expect(page.locator("#post-comment")).toBeEnabled();

    await page.locator("#post-comment").click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(page.locator("#post-comment")).toHaveText("投稿中…");
    await page.keyboard.press("Escape");
    await expect(page.locator("#details")).not.toBeVisible();
    gates.get(101)!.release();
    await Promise.all(inflight);
    await twoFrames(page);
    unavailableA = true;
    await openIssue(page, "t0-0-0");
    await expect(page.locator("#comments-status")).toContainText(
      "取得できませんでした",
    );
    await expect(page.locator(".issue-comment")).toHaveCount(1);
    await expect(page.locator("#comments-list")).toContainText(
      "A の送信済みコメント",
    );
    await expect(page.locator("#comments-list")).toContainText("投稿時の内容");
    await expect(page.locator("#comment-body")).toHaveValue("");
    expect(await protectsUnload(page)).toBe(false);
    expect(posts).toEqual([
      { number: 100, body: "A の送信済みコメント" },
      { number: 101, body: "B の未送信コメント" },
    ]);
    expect(fixture.posts()).toBe(0);
  } finally {
    for (const pending of gates.values()) pending.release();
    await Promise.allSettled(inflight);
  }
});

test("refresh revalidates both loaded comment pages instead of dropping the last ten", async ({
  page,
}) => {
  const fixture = await setup(page);
  const reads: number[] = [];
  let secondPageReads = 0;
  await page.route("**/api/issues/100/comments*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const requestedPage = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    reads.push(requestedPage);
    if (requestedPage === 2) secondPageReads++;
    return route.fulfill({
      json: {
        comments: Array.from(
          { length: requestedPage === 1 ? 50 : 10 },
          (_, i) => {
            const id = (requestedPage === 1 ? 0 : 50) + i + 1;
            return comment(
              100,
              id,
              `コメント ${id}${id === 60 && secondPageReads > 1 ? "（更新済み）" : ""}`,
            );
          },
        ),
        nextPage: requestedPage === 1 ? 2 : null,
      },
    });
  });
  await openIssue(page, "t0-0-0");
  await expect(page.locator("#comments-list .issue-comment")).toHaveCount(50);
  await page.locator("#comments-more").click();
  await expect(page.locator("#comments-list .issue-comment")).toHaveCount(60);
  await expect(page.locator("#comments-more")).toBeHidden();
  expect(reads).toEqual([1, 2]);

  await page.locator("#comments-refresh").click();
  await expect.poll(() => reads.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator("#comments-refresh")).toBeEnabled();
  await expect(page.locator("#comments-list .issue-comment")).toHaveCount(60);
  await expect(
    page.locator('#comments-list [data-comment-id="60"]'),
  ).toContainText("コメント 60（更新済み）");
  await expect(page.locator("#comments-status")).toHaveText("60件のコメント");
  await expect(page.locator("#comments-more")).toBeHidden();
  expect(reads).toEqual([1, 2, 1, 2]);
  expect(fixture.posts()).toBe(0);
});

test("A to B to A restores the pending comment and a late acknowledgement completes the reopened view", async ({
  page,
}) => {
  const fixture = await setup(page),
    pending = gate();
  let posts = 0;
  const entries: ReturnType<typeof comment>[] = [];
  await page.route("**/api/issues/100/comments*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { comments: entries, nextPage: null } });
    posts++;
    const body = route.request().postDataJSON().body;
    await pending.promise;
    const posted = comment(100, 1, body);
    entries.push(posted);
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await openIssue(page, "t0-0-0");
    await page.locator("#comment-body").fill("A の保留中コメント");
    await page.locator("#post-comment").click();
    await expect.poll(() => posts).toBe(1);
    await closeIssue(page);
    await openIssue(page, "t0-0-1");
    await expect(page.locator("#comment-body")).toHaveValue("");
    expect(await protectsUnload(page)).toBe(true);
    await closeIssue(page);
    await openIssue(page, "t0-0-0");
    await expect(page.locator("#comment-body")).toHaveValue(
      "A の保留中コメント",
    );
    await expect(page.locator("#comment-body")).toBeDisabled();
    await expect(page.locator("#post-comment")).toHaveText("投稿中…");
    const reply = commentReply(page);
    pending.release();
    await (await reply).finished();
    await expect(page.locator("#comment-body")).toBeEnabled();
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator("#comments-list .issue-comment")).toHaveCount(1);
    await refreshDone(page);
    expect(await protectsUnload(page)).toBe(false);
    expect(posts).toBe(1);
    expect(fixture.posts()).toBe(0);
  } finally {
    pending.release();
  }
});

test("late safe HTTP400 stays with A, preserves its draft on reopen, and allows only an explicit retry", async ({
  page,
}) => {
  const fixture = await setup(page),
    pending = gate();
  const posts: { body: string; requestId: string }[] = [];
  const entries: ReturnType<typeof comment>[] = [];
  await page.route("**/api/issues/100/comments*", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { comments: entries, nextPage: null } });
    const payload = route.request().postDataJSON();
    posts.push(payload);
    if (posts.length === 1) {
      await pending.promise;
      return route.fulfill({ status: 400, json: { error: "invalid_comment" } });
    }
    const posted = comment(100, 1, payload.body);
    entries.push(posted);
    return route.fulfill({ status: 201, json: { ok: true, comment: posted } });
  });
  try {
    await openIssue(page, "t0-0-0");
    await page.locator("#comment-body").fill("A の再試行するコメント");
    await page.locator("#post-comment").click();
    await expect.poll(() => posts.length).toBe(1);
    await closeIssue(page);
    await openIssue(page, "t0-0-1");
    await closeIssue(page);
    await openIssue(page, "t0-0-0");
    await expect(page.locator("#comment-body")).toBeDisabled();
    await expect(page.locator("#comment-body")).toHaveValue(
      "A の再試行するコメント",
    );
    await closeIssue(page);
    await openIssue(page, "t0-0-1");
    await page.locator("#comment-body").fill("B の下書きは別です");
    const reply = commentReply(page);
    pending.release();
    await (await reply).finished();
    await twoFrames(page);
    await expect(page.locator("#comment-body")).toHaveValue(
      "B の下書きは別です",
    );
    await expect(page.locator("#comment-error")).toBeHidden();
    await expect(page.locator("#comment-state")).toHaveText("");
    await page.locator("#comment-body").fill("");
    expect(await protectsUnload(page)).toBe(true);
    await closeIssue(page);
    await openIssue(page, "t0-0-0");
    await expect(page.locator("#comment-body")).toHaveValue(
      "A の再試行するコメント",
    );
    await expect(page.locator("#post-comment")).toBeEnabled();
    await expect(page.locator("#comment-state")).toContainText(
      "投稿できませんでした",
    );
    await page.locator("#comment-body").fill("");
    await expect(page.locator("#comment-state")).toHaveText("");
    expect(await protectsUnload(page)).toBe(false);
    await page.locator("#comment-body").fill("A の再試行するコメント");
    expect(await protectsUnload(page)).toBe(true);
    await page.locator("#comments-refresh").click();
    await refreshDone(page);
    expect(posts).toHaveLength(1);
    await page.locator("#post-comment").click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator("#comments-list .issue-comment")).toHaveCount(1);
    await refreshDone(page);
    expect(posts.map((post) => post.body)).toEqual([
      "A の再試行するコメント",
      "A の再試行するコメント",
    ]);
    expect(posts[0].requestId).toBeTruthy();
    expect(posts[1].requestId).toBeTruthy();
    expect(posts[1].requestId).not.toBe(posts[0].requestId);
    expect(await protectsUnload(page)).toBe(false);
    expect(fixture.posts()).toBe(0);
  } finally {
    pending.release();
  }
});

for (const failure of ["connectionreset", "timedout"])
  test(`late ${failure} retains the sent draft and blocks replay across refresh and reopen`, async ({
    page,
  }) => {
    const fixture = await setup(page),
      pending = gate();
    const posts: { body: string; requestId: string }[] = [];
    await page.route("**/api/issues/100/comments*", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { comments: [], nextPage: null } });
      posts.push(route.request().postDataJSON());
      await pending.promise;
      return route.abort(failure);
    });
    try {
      await openIssue(page, "t0-0-0");
      await page
        .locator("#comment-body")
        .fill("結果不明でも保持する A のコメント");
      await page.locator("#post-comment").click();
      await expect.poll(() => posts.length).toBe(1);
      await closeIssue(page);
      await openIssue(page, "t0-0-1");
      expect(await protectsUnload(page)).toBe(true);
      const failed = page.waitForEvent(
        "requestfailed",
        (request) =>
          request.method() === "POST" &&
          request.url().includes("/issues/100/comments"),
      );
      pending.release();
      await failed;
      await twoFrames(page);
      await expect(page.locator("#comment-error")).toBeHidden();
      await expect(page.locator("#comment-state")).toHaveText("");
      expect(await protectsUnload(page)).toBe(true);
      await closeIssue(page);
      await openIssue(page, "t0-0-0");
      await expect(page.locator("#comment-error")).toContainText(
        "再投稿を停止",
      );
      await expect(page.locator("#comment-body")).toHaveValue(
        "結果不明でも保持する A のコメント",
      );
      await expect(page.locator("#post-comment")).toBeDisabled();
      await page.locator("#comment-body").fill("");
      await expect(page.locator("#comment-error")).toContainText(
        "再投稿を停止",
      );
      expect(await protectsUnload(page)).toBe(true);
      await page
        .locator("#comment-body")
        .fill("結果不明でも保持する A のコメント");
      await page.locator("#comments-refresh").click();
      await refreshDone(page);
      await closeIssue(page);
      await openIssue(page, "t0-0-0");
      await expect(page.locator("#comment-body")).toHaveValue(
        "結果不明でも保持する A のコメント",
      );
      await expect(page.locator("#post-comment")).toBeDisabled();
      await page.evaluate(() =>
        (
          document.querySelector("#comment-form") as HTMLFormElement
        ).requestSubmit(),
      );
      await twoFrames(page);
      expect(posts).toHaveLength(1);
      expect(posts[0].requestId).toBeTruthy();
      expect(posts[0].body).toBe("結果不明でも保持する A のコメント");
      expect(fixture.posts()).toBe(0);
    } finally {
      pending.release();
    }
  });

for (const replaceSource of [false, true])
  test(`late comment POST403 ${replaceSource ? "cannot revoke a new adapter" : "clears every view on the same source"}`, async ({
    page,
  }) => {
    const fixture = await setup(page),
      pending = gate();
    let posts = 0;
    await page.route("**/api/issues/100/comments*", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { comments: [], nextPage: null } });
      posts++;
      await pending.promise;
      return route.fulfill({
        status: 403,
        json: { error: "scope_not_public" },
      });
    });
    try {
      await openIssue(page, "t0-0-0");
      await page.locator("#comment-body").fill("古い A の送信コメント");
      await page.locator("#post-comment").click();
      await expect.poll(() => posts).toBe(1);
      await closeIssue(page);
      if (replaceSource)
        await page.evaluate(async (snapshot) => {
          await (window as any).Whiteboard.setAdapter({
            load: async () => structuredClone(snapshot),
            saveIssue: async () => {
              throw Error("fixture forbids Issue writes");
            },
            loadComments: async () => ({ comments: [], nextPage: null }),
            postComment: async () => {
              throw Error("fixture forbids new-source POST");
            },
          });
        }, fixture.board);
      await openIssue(page, "t0-0-1");
      await page.locator("#comment-body").fill("B の表示中下書き");
      const reply = commentReply(page);
      pending.release();
      await (await reply).finished();
      await twoFrames(page);
      if (replaceSource) {
        await expect(page.locator("#details")).toBeVisible();
        await expect(page.locator(".pbi-title")).toHaveCount(6);
        await expect(page.locator("#comment-body")).toHaveValue(
          "B の表示中下書き",
        );
        await expect(page.locator("#comment-error")).toBeHidden();
      } else {
        await expect(page.locator("#details")).not.toBeVisible();
        await expect(page.locator(".task")).toHaveCount(0);
        await expect(page.locator("#comment-body")).toHaveValue("");
        await expect(page.locator(".issue-comment")).toHaveCount(0);
        expect(await protectsUnload(page)).toBe(false);
      }
      expect(posts).toBe(1);
      expect(fixture.posts()).toBe(0);
    } finally {
      pending.release();
    }
  });

test("three loaded pages refresh atomically with canonical edits, deletions and duplicate boundaries, without reading page four", async ({
  page,
}) => {
  const fixture = await setup(page),
    third = gate();
  const reads: number[] = [];
  const original = Array.from({ length: 120 }, (_, i) => i + 1);
  const canonical = original.filter((id) => id !== 5);
  let phase = 0,
    active = 0,
    maximumActive = 0;
  await page.route("**/api/issues/100/comments*", async (route) => {
    const requested = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    reads.push(requested);
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      if (phase === 1 && requested === 3) await third.promise;
      const ids = (phase ? canonical : original).slice(
        (requested - 1) * 50,
        requested * 50,
      );
      // A later refresh separately models a boundary shifting between source
      // reads. Every response still obeys the server's 50-item page contract.
      if (phase === 2 && requested === 2) ids[0] = canonical[49];
      await route.fulfill({
        json: {
          comments: ids.map((id) =>
            comment(
              100,
              id,
              `コメント ${id}${phase && id === 70 ? "（編集済み）" : ""}`,
            ),
          ),
          nextPage: ids.length === 50 ? requested + 1 : null,
        },
      });
    } finally {
      active--;
    }
  });
  try {
    await openIssue(page, "t0-0-0");
    await expect(page.locator(".issue-comment")).toHaveCount(50);
    await page.locator("#comments-more").click();
    await expect(page.locator(".issue-comment")).toHaveCount(100);
    await page.locator("#comments-more").click();
    await expect(page.locator(".issue-comment")).toHaveCount(120);
    expect(reads).toEqual([1, 2, 3]);
    phase = 1;
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.filter((n) => n === 3).length).toBe(2);
    await expect(page.locator("#comments-list")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator(".issue-comment")).toHaveCount(120);
    await expect(page.locator('[data-comment-id="5"]')).toHaveCount(1);
    await expect(page.locator('[data-comment-id="70"]')).not.toContainText(
      "編集済み",
    );
    third.release();
    await refreshDone(page);
    await expect(page.locator(".issue-comment")).toHaveCount(119);
    await expect(page.locator('[data-comment-id="5"]')).toHaveCount(0);
    await expect(page.locator('[data-comment-id="50"]')).toHaveCount(1);
    await expect(page.locator('[data-comment-id="70"]')).toContainText(
      "編集済み",
    );
    await expect(page.locator('[data-comment-id="120"]')).toHaveCount(1);
    expect(
      await page
        .locator(".issue-comment")
        .evaluateAll((nodes) =>
          nodes.map((node) => Number((node as HTMLElement).dataset.commentId)),
        ),
    ).toEqual(canonical);
    expect(reads.slice(3).sort()).toEqual([1, 2, 3]);
    expect(maximumActive).toBeLessThanOrEqual(2);
    await expect(page.locator("#comments-more")).toBeHidden();
    phase = 2;
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.length).toBe(9);
    await refreshDone(page);
    await expect(page.locator('[data-comment-id="51"]')).toHaveCount(1);
    await expect(page.locator(".issue-comment")).toHaveCount(118);
    expect(reads.slice(6).sort()).toEqual([1, 2, 3]);
    expect(reads).not.toContain(4);
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(fixture.posts()).toBe(0);
  } finally {
    third.release();
  }
});

test("503 preserves sixty old comments; the shared read pool queues B and a late page two403 clears it", async ({
  page,
}) => {
  const fixture = await setup(page),
    unavailable = gate(),
    denied = gate();
  const reads: { number: number; page: number }[] = [];
  let attempt = 0,
    active = 0,
    maximumActive = 0;
  await page.route("**/api/issues/*/comments*", async (route) => {
    const url = new URL(route.request().url());
    const number = Number(url.pathname.split("/")[3]);
    const requested = Number(url.searchParams.get("page"));
    reads.push({ number, page: requested });
    active++;
    maximumActive = Math.max(maximumActive, active);
    try {
      if (number === 101)
        return await route.fulfill({
          json: {
            comments: [comment(101, 201, "B の公開コメント")],
            nextPage: null,
          },
        });
      if (attempt === 2) {
        await (requested === 1 ? unavailable.promise : denied.promise);
        return await route.fulfill({
          status: requested === 1 ? 503 : 403,
          json: { error: requested === 1 ? "unavailable" : "scope_not_public" },
        });
      }
      if (attempt === 1 && requested === 1)
        return await route.fulfill({
          status: 503,
          json: { error: "unavailable" },
        });
      return await route.fulfill({
        json: {
          comments: Array.from({ length: requested === 1 ? 50 : 10 }, (_, i) =>
            comment(
              100,
              (requested - 1) * 50 + i + 1,
              `${attempt === 1 ? "未確定の変更" : "以前のコメント"} ${(requested - 1) * 50 + i + 1}`,
            ),
          ),
          nextPage: requested === 1 ? 2 : null,
        },
      });
    } finally {
      active--;
    }
  });
  try {
    await openIssue(page, "t0-0-0");
    await page.locator("#comments-more").click();
    await expect(page.locator(".issue-comment")).toHaveCount(60);
    await page
      .locator('[data-comment-id="60"]')
      .evaluate((node) => node.setAttribute("data-old-node", "kept"));
    attempt = 1;
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.length).toBe(4);
    await refreshDone(page);
    await expect(page.locator("#comments-status")).toContainText(
      "取得できませんでした",
    );
    await expect(page.locator(".issue-comment")).toHaveCount(60);
    await expect(page.locator('[data-comment-id="60"]')).toHaveAttribute(
      "data-old-node",
      "kept",
    );
    await expect(page.locator("#comments-list")).not.toContainText(
      "未確定の変更",
    );

    attempt = 2;
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.length).toBe(6);
    await closeIssue(page);
    await page.locator('[data-open="t0-0-1"]').click();
    await expect(page.locator("#details")).toBeVisible();
    await page.locator("#comment-body").fill("失効とともに消す B の下書き");
    await twoFrames(page);
    expect(reads.filter((read) => read.number === 101)).toHaveLength(0);
    expect(maximumActive).toBeLessThanOrEqual(2);
    const failed = page.waitForResponse(
      (response) =>
        response.status() === 503 &&
        response.url().includes("/issues/100/comments"),
    );
    unavailable.release();
    await (await failed).finished();
    await expect(page.locator("#comments-list")).toContainText(
      "B の公開コメント",
    );
    await expect(page.locator("#comment-body")).toHaveValue(
      "失効とともに消す B の下書き",
    );
    const revoked = page.waitForResponse(
      (response) =>
        response.status() === 403 &&
        response.url().includes("/issues/100/comments"),
    );
    denied.release();
    await (await revoked).finished();
    await expect(page.locator("#details")).not.toBeVisible();
    await expect(page.locator(".task")).toHaveCount(0);
    await expect(page.locator(".issue-comment")).toHaveCount(0);
    await expect(page.locator("#comment-body")).toHaveValue("");
    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(reads).toEqual([
      { number: 100, page: 1 },
      { number: 100, page: 2 },
      { number: 100, page: 1 },
      { number: 100, page: 2 },
      { number: 100, page: 1 },
      { number: 100, page: 2 },
      { number: 101, page: 1 },
    ]);
    expect(fixture.posts()).toBe(0);
  } finally {
    unavailable.release();
    denied.release();
  }
});

test("unchanged refresh preserves nodes, text selection, draft and reading position; confirmed posts graduate then obey deletion", async ({
  page,
}) => {
  const fixture = await setup(page),
    unchanged = gate();
  const reads: number[] = [];
  let phase = "initial",
    posts = 0;
  let entries = Array.from({ length: 60 }, (_, i) =>
    comment(100, i + 1, `コメント ${i + 1}`),
  );
  await page.route("**/api/issues/100/comments*", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      const posted = comment(100, 61, route.request().postDataJSON().body);
      entries.push(posted);
      return route.fulfill({
        status: 201,
        json: { ok: true, comment: posted },
      });
    }
    const requested = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    reads.push(requested);
    if (phase === "unchanged" && requested === 2) await unchanged.promise;
    return route.fulfill({
      json: {
        comments: entries.slice((requested - 1) * 50, requested * 50),
        nextPage: requested * 50 < entries.length ? requested + 1 : null,
      },
    });
  });
  try {
    await openIssue(page, "t0-0-0");
    await expect(page.locator(".cm-content")).toBeVisible();
    await page.locator("#comments-more").click();
    await expect(page.locator(".issue-comment")).toHaveCount(60);
    await page.locator("#comment-body").fill("更新でも残る下書き");
    phase = "unchanged";
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.length).toBe(4);
    const anchor = page.locator('[data-comment-id="10"] .comment-content');
    await anchor.scrollIntoViewIfNeeded();
    await anchor.evaluate((node) => {
      node.setAttribute("data-retained", "yes");
      const range = document.createRange();
      range.selectNodeContents(node.querySelector("p") || node);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
    });
    await twoFrames(page);
    const selected = await page.evaluate(() =>
      window.getSelection()!.toString(),
    );
    const top = (await anchor.boundingBox())!.y;
    expect(selected).toBe("コメント 10");
    expect(
      await page.locator("#details").evaluate((node) => node.scrollTop),
    ).toBeGreaterThan(0);
    unchanged.release();
    await refreshDone(page);
    await twoFrames(page);
    await expect(anchor).toHaveAttribute("data-retained", "yes");
    expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(
      selected,
    );
    expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThanOrEqual(
      2,
    );
    await expect(page.locator("#comment-body")).toHaveValue(
      "更新でも残る下書き",
    );
    expect(reads).toEqual([1, 2, 1, 2]);

    phase = "posted";
    await page
      .locator("#comment-body")
      .fill("サーバーで確認後は削除も反映する投稿");
    await page.locator("#post-comment").click();
    await expect.poll(() => reads.length).toBe(6);
    await refreshDone(page);
    await expect(page.locator("#comment-body")).toHaveValue("");
    await expect(page.locator(".issue-comment")).toHaveCount(61);
    await expect(page.locator('[data-comment-id="61"]')).not.toContainText(
      "投稿時の内容",
    );
    entries = entries.filter((entry) => entry.id !== 61);
    await page.locator("#comments-refresh").click();
    await expect.poll(() => reads.length).toBe(8);
    await refreshDone(page);
    await expect(page.locator(".issue-comment")).toHaveCount(60);
    await expect(page.locator('[data-comment-id="61"]')).toHaveCount(0);
    await expect(anchor).toHaveAttribute("data-retained", "yes");
    expect(reads).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    expect(posts).toBe(1);
    expect(fixture.posts()).toBe(0);
  } finally {
    unchanged.release();
  }
});
