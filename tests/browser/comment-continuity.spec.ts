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
  await page.route("**/api/issues/*/comments*", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const work = (async () => {
      const number = Number(
        new URL(route.request().url()).pathname.split("/")[3],
      );
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
