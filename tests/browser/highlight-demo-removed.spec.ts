import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

test("選択済み強調の比較デモを配信せず、Uの閲覧補助だけを保つ", async ({
  page,
  request,
}) => {
  const demoRequests: string[] = [];
  page.on("request", (r) => {
    if (/highlight-demo\.(js|css)$/.test(new URL(r.url()).pathname))
      demoRequests.push(r.url());
  });
  const f = await setup(page);
  Object.assign(f.board.scope, { estimateHoursField: true });
  f.board.tasks.forEach((task) =>
    Object.assign(task, {
      estimateHours: null,
      subIssueCount: 0,
      parentId: task.lane,
    }),
  );
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.locator("#operations").click();
  await expect(page.locator("#operations")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    page.locator("#highlight-demo-open, #highlight-demo"),
  ).toHaveCount(0);
  const reads = f.reads(),
    posts = f.posts();
  await page.locator("#highlight-unestimated").click();
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".unestimated-highlight").first()).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(f.reads()).toBe(reads);
  expect(f.posts()).toBe(posts);
  expect(demoRequests).toEqual([]);
  // The synthetic preview's exact allowlist must also drop both retired assets.
  for (const asset of ["highlight-demo.js", "highlight-demo.css"])
    expect((await request.get(`/${asset}`)).status()).toBe(404);
});
