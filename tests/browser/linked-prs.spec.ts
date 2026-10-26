import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
const pr = (number, state = "OPEN", isDraft = false) => ({
  number,
  title: `関連する変更 ${number}`,
  url: `https://github.com/engineer-first/idea-boost/pull/${number}`,
  state,
  isDraft,
});
test("linked PRs load after body, paginate all states and ignore unsafe URLs", async ({
  page,
}) => {
  const s = await setup(page);
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/*/pull-requests*", async (r) => {
    await gate;
    await r.fulfill({
      json: r.request().url().includes("after=")
        ? { prs: [pr(5)], nextCursor: null }
        : {
            prs: [
              pr(1),
              pr(2, "OPEN", true),
              pr(3, "MERGED"),
              pr(4, "CLOSED"),
              { ...pr(6), url: "javascript:alert(1)" },
            ],
            nextCursor: "next==",
          },
    });
  });
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("#detail-fields")).toBeEnabled();
  expect(await page.locator("#linked-prs a").count()).toBe(0);
  release();
  await expect(page.locator("#linked-prs a")).toHaveCount(4);
  for (const kind of ["open", "draft", "merged", "closed"])
    await expect(page.locator(`.pr-${kind}`)).toBeVisible();
  await expect(page.locator(".pr-merged")).toHaveAttribute("target", "_blank");
  await expect(page.locator(".pr-merged")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page.getByRole("button", { name: "ほかのPR" }).click();
  await expect(page.locator("#linked-prs a")).toHaveCount(5);
  await page.screenshot({
    path: `.wrangler/linked-pr-${page.viewportSize()!.width}.png`,
  });
  expect(s.posts()).toBe(0);
});
test("linked PR late response cannot populate next Issue and private error clears the board", async ({
  page,
}) => {
  const s = await setup(page);
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/*/pull-requests*", async (r) => {
    if (r.request().url().includes("/100/")) {
      await gate;
      return r.fulfill({ json: { prs: [pr(1)], nextCursor: null } });
    }
    return r.fulfill({ json: { prs: [], nextCursor: null } });
  });
  await page.locator(".task-title").first().click();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator(".task-title").nth(1).click();
  release();
  await expect(page.locator("#linked-prs")).toBeHidden();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await page.route("**/api/issues/*/pull-requests*", (r) =>
    r.fulfill({ status: 403, json: { error: "scope_not_public" } }),
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".task")).toHaveCount(0);
  expect(s.posts()).toBe(0);
});
