import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const prose =
  "日本語の長いコメントでも、内容の種類によらず読みやすい行の幅を保ちます。".repeat(
    5,
  );
const image =
  "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000042";
const bodies = [
  prose,
  prose.slice(0, 60) + "\n" + prose.slice(60),
  "- " + prose,
  "> " + prose,
  "```text\n" + prose + "\nコードの次の行\n```",
  `| 項目 | 本文 |\n| --- | --- |\n| 比較 | ${prose} |`,
  `![表示幅のfixture](${image})`,
  "明示改行の前  \n明示改行の後\\\n最後の行",
];

async function comments(page: Page) {
  const f = await setup(page);
  await page.route(image, (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3k0AAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/issues/100/comments*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      json: {
        comments: bodies.map((body, index) => ({
          id: index + 1,
          body,
          createdAt: "2026-10-28T00:00:00Z",
          author: { login: "tester", type: "User" },
        })),
        nextPage: null,
      },
    });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".issue-comment")).toHaveCount(bodies.length);
  await expect(page.locator('[data-comment-id="7"] .media-shell')).toHaveCount(
    1,
  );
  return f;
}

const content = (page: Page, number: number) =>
  page.locator(`[data-comment-id="${number}"] .comment-content`);

test("paragraph, soft-line prose, list, quote, code, table and media share one readable comment column", async ({
  page,
}) => {
  const f = await comments(page);
  const selectors = [
    "p",
    "p",
    "ul",
    "blockquote",
    "pre",
    "table",
    ".media-shell",
    "p",
  ];
  const metrics = await page.locator(".comment-content").evaluateAll(
    (nodes, selectors) =>
      nodes.map((node, index) => {
        const root = node.getBoundingClientRect(),
          child = node.querySelector(selectors[index])!.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          type: selectors[index],
          width: root.width,
          right: root.right,
          childWidth: child.width,
          childRight: child.right,
          maxWidth: style.maxWidth,
          fontSize: style.fontSize,
          articleWidth: node.parentElement!.getBoundingClientRect().width,
        };
      }),
    selectors,
  );
  const width = metrics[0].width;
  expect(width).toBeGreaterThan(500);
  expect(width).toBeLessThan(metrics[0].articleWidth - 100);
  for (const metric of metrics) {
    expect(metric.fontSize).toBe("16px");
    expect(
      Math.abs(metric.width - parseFloat(metric.maxWidth)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(metric.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(metric.childWidth - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(metric.childRight - metric.right)).toBeLessThanOrEqual(1);
  }
  for (const selector of [
    '[data-comment-id="1"] p',
    '[data-comment-id="3"] li',
    '[data-comment-id="4"] blockquote p',
  ]) {
    await expect(page.locator(selector)).toHaveCSS("font-size", "16px");
    await expect(page.locator(selector)).toHaveCSS("line-height", "29.6px");
  }
  const code = page.locator('[data-comment-id="5"] pre');
  expect(
    await code.evaluate((node) => node.scrollWidth > node.clientWidth),
  ).toBe(true);
  await expect(code).toHaveCSS("overflow-x", "auto");
  await expect(content(page, 7).locator(".media-frame")).toHaveCSS(
    "overflow-x",
    "hidden",
  );
  console.log(
    "comment-column-layout",
    JSON.stringify({ viewport: page.viewportSize(), metrics }),
  );
  for (const [number, label] of [
    [1, "prose"],
    [3, "list-quote"],
    [5, "code-table"],
    [7, "media"],
  ] as const) {
    await content(page, number).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/comment-columns-${label}-${page.viewportSize()!.width}.png`,
      animations: "disabled",
    });
  }
  expect(f.posts()).toBe(0);
});

test("soft line breaks wrap naturally while explicit hard breaks and code whitespace keep their meaning", async ({
  page,
}) => {
  const f = await comments(page);
  for (const number of [1, 2]) {
    const paragraph = content(page, number).locator("p");
    await expect(paragraph).toHaveCSS("white-space", "normal");
    await expect(paragraph.locator("br")).toHaveCount(0);
    expect(
      await paragraph.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getClientRects().length;
      }),
    ).toBeGreaterThan(1);
  }
  const hard = content(page, 8).locator("p");
  await expect(hard.locator("br")).toHaveCount(2);
  expect(await hard.innerText()).toBe("明示改行の前\n明示改行の後\n最後の行");
  const code = content(page, 5).locator("pre code");
  await expect(code).toHaveCSS("white-space", "pre");
  expect(await code.textContent()).toBe(prose + "\nコードの次の行\n");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#comment-body")).toHaveValue("");
  expect(f.posts()).toBe(0);
});
