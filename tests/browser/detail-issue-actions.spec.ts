import { test, expect, type Page } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";

const issueUrl = (number: number) =>
  `https://github.com/engineer-first/idea-boost/issues/${number}`;

async function clipboardFixture(page: Page) {
  await page.addInitScript(() => {
    const harness = {
      mode: "success",
      calls: [] as string[],
      pending: [] as { resolve: () => void; reject: () => void }[],
    };
    (window as any).__issueClipboard = harness;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(text: string) {
          harness.calls.push(text);
          if (harness.mode === "reject")
            return Promise.reject(
              new DOMException("Denied", "NotAllowedError"),
            );
          if (harness.mode === "pending")
            return new Promise<void>((resolve, reject) =>
              harness.pending.push({
                resolve,
                reject: () =>
                  reject(new DOMException("Denied", "NotAllowedError")),
              }),
            );
          return Promise.resolve();
        },
      },
    });
  });
}
async function copied(page: Page) {
  return page.evaluate(
    () => (window as any).__issueClipboard.calls as string[],
  );
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function open(page: Page, index = 0) {
  await page.locator(`[data-open="t0-0-${index}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("#comments-refresh")).toBeEnabled();
}
async function close(page: Page) {
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
}

test("the larger plain Issue number copies its canonical URL by click, Enter and Space without extra API calls", async ({
  page,
}) => {
  await clipboardFixture(page);
  const f = await setup(page);
  await open(page);
  const number = page.getByRole("button", {
    name: "#100 のリンクをコピー",
    exact: true,
  });
  await expect(number).toHaveText("#100");
  await expect(number).toHaveCSS("font-size", "16px");
  await expect(number).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  expect((await number.boundingBox())!.height).toBeGreaterThanOrEqual(32);
  await expect(number.locator("svg")).toHaveCount(0);
  expect(await number.getAttribute("title")).toBeNull();
  expect(await number.getAttribute("data-tooltip")).toBeNull();
  const reads = f.reads();
  const extraRequests: string[] = [];
  const watch = (request: any) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      extraRequests.push(request.url());
  };
  page.on("request", watch);
  await number.click();
  await expect(page.locator("#announcement")).toHaveText(
    "#100 のリンクをコピーしました。",
  );
  await number.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect
    .poll(() => copied(page))
    .toEqual([issueUrl(100), issueUrl(100), issueUrl(100)]);
  await expect(number).toBeFocused();
  await expect(number).toHaveCSS("outline-style", "solid");
  await frames(page);
  page.off("request", watch);
  expect(extraRequests).toEqual([]);
  expect(f.reads()).toBe(reads);
  expect(f.posts()).toBe(0);
  await page.screenshot({
    path: `test-results/detail-issue-number-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
});

test("clipboard rejection and unavailable API never announce copied", async ({
  page,
}) => {
  await clipboardFixture(page);
  const f = await setup(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).__issueClipboard.mode = "reject";
  });
  await page.locator("#detail-meta").click();
  await expect(page.locator("#announcement")).toHaveText(
    "リンクをコピーできませんでした。",
  );
  expect(await copied(page)).toEqual([issueUrl(100)]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.locator("#detail-meta").click();
  await frames(page);
  await expect(page.locator("#announcement")).toHaveText(
    "リンクをコピーできませんでした。",
  );
  await expect(page.locator("#announcement")).not.toContainText(
    "コピーしました",
  );
  expect(await copied(page)).toHaveLength(1);
  expect(f.posts()).toBe(0);
});

test("unknown, mismatched and unsafe Issue URLs disable the number instead of inventing a copy target", async ({
  page,
}) => {
  await clipboardFixture(page);
  const f = await setup(page);
  for (const url of [
    undefined,
    "javascript:alert(1)",
    "http://github.com/engineer-first/idea-boost/issues/100",
    "https://example.com/issues/100",
    issueUrl(101),
    `${issueUrl(100)}?secret=fixture`,
    `${issueUrl(100)}#issuecomment-1`,
    "https://user:password@github.com/engineer-first/idea-boost/issues/100",
  ]) {
    (f.board.tasks[0] as any).url = url;
    await page.evaluate(
      (snapshot) => (window as any).Whiteboard.applySnapshot(snapshot),
      f.board,
    );
    await open(page);
    await expect(page.locator("#detail-meta")).toHaveText("#100");
    await expect(page.locator("#detail-meta")).toBeDisabled();
    await expect(page.locator("#detail-meta")).toHaveAccessibleName(
      "#100（リンク未確認のためコピーできません）",
    );
    await page
      .locator("#detail-meta")
      .evaluate((button: HTMLButtonElement) => button.click());
    await close(page);
  }
  expect(await copied(page)).toEqual([]);
  expect(f.posts()).toBe(0);
});

test("a late clipboard acknowledgement from A cannot replace B feedback or copy target", async ({
  page,
}) => {
  await clipboardFixture(page);
  const f = await setup(page);
  await open(page);
  await page.evaluate(() => {
    (window as any).__issueClipboard.mode = "pending";
  });
  await page.locator("#detail-meta").click();
  await expect.poll(() => copied(page)).toEqual([issueUrl(100)]);
  await close(page);
  await open(page, 1);
  await page.evaluate(() => {
    (window as any).__issueClipboard.mode = "success";
  });
  await page.locator("#detail-meta").click();
  await expect(page.locator("#announcement")).toHaveText(
    "#101 のリンクをコピーしました。",
  );
  await page.evaluate(() =>
    (window as any).__issueClipboard.pending.shift().resolve(),
  );
  await frames(page);
  await expect(page.locator("#detail-meta")).toHaveText("#101");
  await expect(page.locator("#announcement")).toHaveText(
    "#101 のリンクをコピーしました。",
  );
  expect(await copied(page)).toEqual([issueUrl(100), issueUrl(101)]);
  expect(f.posts()).toBe(0);
});

test("late Issue A save readback cannot change B's number or canonical copy URL", async ({
  page,
}) => {
  await clipboardFixture(page);
  const f = await setup(page);
  let release!: () => void,
    posts = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    const patch = route.request().postDataJSON();
    await gate;
    Object.assign(f.board.tasks[0], {
      body: patch.body,
      revision: "2026-10-28T14:00:00Z",
    });
    await route.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  try {
    await open(page);
    await fillEditor(page, "A の送信した本文");
    await page.locator("#save-issue").click();
    await expect.poll(() => posts).toBe(1);
    await close(page);
    await open(page, 1);
    await fillEditor(page, "B の編集中本文");
    await page.locator("#detail-meta").click();
    await expect.poll(() => copied(page)).toEqual([issueUrl(101)]);
    release();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).Whiteboard.getSnapshot().tasks[0].body,
        ),
      )
      .toBe("A の送信した本文");
    await frames(page);
    await expect(page.locator("#detail-meta")).toHaveText("#101");
    await expect(page.locator("#detail-body")).toHaveValue("B の編集中本文");
    await page.locator("#detail-meta").click();
    await expect
      .poll(() => copied(page))
      .toEqual([issueUrl(101), issueUrl(101)]);
    expect(posts).toBe(1);
    expect(f.posts()).toBe(0);
  } finally {
    release();
  }
});

test("Close stays separate at the bottom left while the canonical state remains in the header", async ({
  page,
}) => {
  const f = await setup(page);
  let commentPosts = 0;
  await page.route("**/api/issues/100/comments*", (route) => {
    if (route.request().method() === "POST") {
      commentPosts++;
      return route.fulfill({
        status: 400,
        json: { error: "unexpected_fixture_write" },
      });
    }
    return route.fulfill({
      json: {
        comments: Array.from({ length: 8 }, (_, i) => ({
          id: i + 1,
          body: `離して表示する既存コメント ${i + 1}`,
          createdAt: "2026-10-28T00:00:00Z",
          author: { login: "tester", type: "User" },
        })),
        nextPage: null,
      },
    });
  });
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/issues/100", (route) => {
    payloads.push(route.request().postDataJSON());
    Object.assign(f.board.tasks[0], {
      state: "CLOSED",
      stateReason: "COMPLETED",
      revision: "2026-10-28T14:00:00Z",
    });
    return route.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await open(page);
  await expect(page.locator("#issue-state")).toHaveText("Open");
  await expect(page.locator("#issue-state")).toBeInViewport();
  await expect(page.locator(".issue-state-row #close-issue")).toHaveCount(0);
  await expect(page.locator("#comment-form #close-issue")).toHaveCount(0);
  const closeButton = page.locator(".detail-footer > #close-issue");
  await expect(closeButton).not.toBeInViewport();
  await fillEditor(page, "クローズに便乗させない本文");
  await page.locator("#comment-body").fill("クローズに便乗させないコメント");
  await closeButton.scrollIntoViewIfNeeded();
  const bounds = (await closeButton.boundingBox())!,
    postBounds = (await page.locator("#post-comment").boundingBox())!;
  expect(bounds.x).toBeLessThan(postBounds.x);
  expect(bounds.y - (postBounds.y + postBounds.height)).toBeGreaterThanOrEqual(
    24,
  );
  await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.screenshot({
    path: `test-results/detail-issue-footer-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  await closeButton.click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  await expect(closeButton).toBeHidden();
  await expect(page.locator(".detail-footer")).toBeHidden();
  await expect(page.locator("#detail-body")).toHaveValue(
    "クローズに便乗させない本文",
  );
  await expect(page.locator("#comment-body")).toHaveValue(
    "クローズに便乗させないコメント",
  );
  expect(payloads).toHaveLength(1);
  expect(payloads[0].close).toBe(true);
  for (const field of ["body", "title", "status", "assignees"])
    expect(payloads[0]).not.toHaveProperty(field);
  expect(commentPosts).toBe(0);
  expect(f.posts()).toBe(0);
});
