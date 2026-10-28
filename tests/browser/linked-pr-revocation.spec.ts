import { test, expect, type Page } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}
const pr = (number: number, title: string) => ({
  number,
  title,
  url: `https://github.com/engineer-first/idea-boost/pull/${number}`,
  state: "OPEN",
  isDraft: false,
});
const oldPr = pr(700, "古いAのPR"),
  currentPr = pr(701, "BのPR");
async function open(page: Page, id: string) {
  await page.locator(`[data-open="${id}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
function oldReply(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname.endsWith(
        "/api/issues/100/pull-requests",
      ),
  );
}
async function assertCleared(page: Page) {
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".task, .pbi-title")).toHaveCount(0);
  await expect(page.locator("#linked-prs")).toBeEmpty();
  await expect(page.locator("#linked-prs")).toBeHidden();
  await expect(page.locator("#detail-body")).toHaveValue("");
  await expect(page.locator("#detail-title")).toHaveValue("");
  await expect(page.locator("#markdown-editor")).toBeEmpty();
  await expect(page.locator("#comment-body")).toHaveValue("");
  await expect(page.locator(".issue-comment")).toHaveCount(0);
  const snapshot = await page.evaluate(() =>
    (window as any).Whiteboard.getSnapshot(),
  );
  expect(snapshot.tasks).toHaveLength(0);
  expect(snapshot.lanes).toHaveLength(0);
}

for (const next of ["closed", "same-source-B", "new-source-B"] as const)
  test(`関連PR遅着403: ${next}でsource所有権に従い失効する`, async ({
    page,
  }) => {
    const fixture = await setup(page),
      pending = gate();
    let oldReads = 0;
    await page.route("**/api/issues/*/pull-requests*", async (route) => {
      expect(route.request().method()).toBe("GET");
      if (
        new URL(route.request().url()).pathname.endsWith("/100/pull-requests")
      ) {
        oldReads++;
        await pending.promise;
        return route.fulfill({
          status: 403,
          json: { error: "scope_not_public" },
        });
      }
      return route.fulfill({ json: { prs: [currentPr], nextCursor: null } });
    });
    try {
      await open(page, "t0-0-0");
      await expect.poll(() => oldReads).toBe(1);
      await page.locator("#close-detail").click();
      await expect(page.locator("#details")).not.toBeVisible();
      if (next === "new-source-B") {
        const snapshot = structuredClone(fixture.board);
        snapshot.lanes[0].title = "新しい接続のPBI";
        await page.evaluate(
          async ({ board, pullRequest }) => {
            await (window as any).Whiteboard.setAdapter({
              load: async () => structuredClone(board),
              saveIssue: async () => {
                throw Error("fixture forbids Issue writes");
              },
              loadComments: async () => ({ comments: [], nextPage: null }),
              loadPullRequests: async () => ({
                prs: [pullRequest],
                nextCursor: null,
              }),
            });
          },
          { board: snapshot, pullRequest: currentPr },
        );
        await expect(page.locator(".pbi-title").first()).toHaveText(
          "新しい接続のPBI",
        );
      }
      if (next !== "closed") {
        await open(page, "t0-0-1");
        await expect(page.locator("#linked-prs a")).toHaveText("#701 BのPR");
        await fillEditor(page, "Bの未保存本文");
        await page.locator("#comment-body").fill("Bの未送信コメント");
      }
      const response = oldReply(page);
      pending.release();
      await (await response).finished();
      await frames(page);
      if (next === "new-source-B") {
        await expect(page.locator("#details")).toBeVisible();
        await expect(page.locator(".pbi-title")).toHaveCount(6);
        await expect(page.locator(".pbi-title").first()).toHaveText(
          "新しい接続のPBI",
        );
        await expect(page.locator("#detail-body")).toHaveValue("Bの未保存本文");
        await expect(page.locator("#comment-body")).toHaveValue(
          "Bの未送信コメント",
        );
        await expect(page.locator("#linked-prs a")).toHaveText("#701 BのPR");
        await expect(page.locator("#detail-error")).toBeHidden();
      } else await assertCleared(page);
      expect(oldReads).toBe(1);
      expect(fixture.posts()).toBe(0);
    } finally {
      pending.release();
    }
  });

for (const status of [200, 503])
  test(`関連PRの遅い${status}はBのPRと未保存入力へ混入しない`, async ({
    page,
  }) => {
    const fixture = await setup(page),
      pending = gate();
    let oldReads = 0;
    await page.route("**/api/issues/*/pull-requests*", async (route) => {
      expect(route.request().method()).toBe("GET");
      if (
        new URL(route.request().url()).pathname.endsWith("/100/pull-requests")
      ) {
        oldReads++;
        await pending.promise;
        return route.fulfill(
          status === 200
            ? { json: { prs: [oldPr], nextCursor: null } }
            : { status, json: { error: "github_unavailable" } },
        );
      }
      return route.fulfill({ json: { prs: [currentPr], nextCursor: null } });
    });
    try {
      await open(page, "t0-0-0");
      await expect.poll(() => oldReads).toBe(1);
      await page.locator("#close-detail").click();
      await expect(page.locator("#details")).not.toBeVisible();
      await open(page, "t0-0-1");
      const current = page.locator("#linked-prs a");
      await expect(current).toHaveText("#701 BのPR");
      await current.evaluate((element) => (element.dataset.retained = "B"));
      await fillEditor(page, "Bの未保存本文");
      await page.locator("#comment-body").fill("Bの未送信コメント");
      const response = oldReply(page);
      pending.release();
      await (await response).finished();
      await frames(page);
      await expect(page.locator("#details")).toBeVisible();
      await expect(page.locator("#detail-meta")).toContainText("#101");
      await expect(page.locator("#detail-body")).toHaveValue("Bの未保存本文");
      await expect(page.locator("#comment-body")).toHaveValue(
        "Bの未送信コメント",
      );
      await expect(current).toHaveCount(1);
      await expect(current).toHaveText("#701 BのPR");
      await expect(current).toHaveAttribute("data-retained", "B");
      await expect(page.locator("#linked-prs")).not.toContainText("古いAのPR");
      await expect(page.locator("#linked-prs")).not.toContainText(
        "取得できません",
      );
      await expect(page.locator("#detail-error")).toBeHidden();
      expect(oldReads).toBe(1);
      expect(fixture.posts()).toBe(0);
    } finally {
      pending.release();
    }
  });
