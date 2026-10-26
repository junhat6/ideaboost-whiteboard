import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("safe disclosure renders whole Markdown only on expansion, keeps source and blocks hostile HTML", async ({
  page,
}) => {
  const s = await setup(page);
  const raw =
    '<details id="pwned" name="details" onclick="window.pwned=1" style="color:red"><summary>更新前 <strong>本文</strong><img src="https://evil.invalid/x"></summary>\n\n## 受け入れ条件\n\n- 原文の保持\n\n![画像](https://user-images.githubusercontent.com/1/fixture.png)\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n<iframe src="https://evil.invalid/frame"></iframe><script>window.pwned=1</script>\n\n<details><summary>内側</summary>\n\n**内側本文**\n\n</details>\n</details>';
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  let media = 0,
    evil = 0;
  await page.route("https://user-images.githubusercontent.com/**", (r) => {
    media++;
    return r.abort();
  });
  await page.route("https://evil.invalid/**", (r) => {
    evil++;
    return r.abort();
  });
  await page.locator(".task-title").first().click();
  const detail = page.locator(".cm-content .safe-disclosure").first();
  await expect(detail).toBeVisible();
  await expect(detail).not.toHaveAttribute("open");
  expect(media).toBe(0);
  await expect(detail.locator(".diagram-shell")).toHaveCount(0);
  await detail.locator(":scope > summary").click();
  await expect(detail.locator("h2")).toHaveText("受け入れ条件");
  await expect(detail.locator(".diagram-canvas svg")).toBeVisible();
  await expect(detail.locator(".safe-disclosure")).toHaveCount(1);
  await expect(
    detail.locator(
      "[onclick],[name],iframe,script,details[style],summary[style]",
    ),
  ).toHaveCount(0);
  expect(evil).toBe(0);
  expect(await page.evaluate(() => (window as any).pwned)).toBeUndefined();
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await detail.locator(":scope > summary").click();
  await expect(detail.locator(":scope > .disclosure-body")).toBeEmpty();
  await page.locator("#markdown-preview").click();
  await expect(page.locator("#detail-body-view .safe-disclosure")).toHaveCount(
    1,
  );
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  expect(s.posts()).toBe(0);
  await page.screenshot({
    path: `.wrangler/disclosure-${page.viewportSize()!.width}.png`,
  });
});
test("open disclosure and malformed/source code use safe fallback without dirtying", async ({
  page,
}) => {
  const s = await setup(page);
  const raw =
    "<details open><summary>最初から開く</summary>\n\n本文\n\n</details>\n\n```html\n<details><summary>コード</summary>code</details>\n```\n\n<details>summaryなし</details>";
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content .safe-disclosure")).toHaveCount(1);
  await expect(page.locator(".cm-content .safe-disclosure")).toHaveAttribute(
    "open",
  );
  await expect(page.locator(".cm-content .disclosure-body")).toContainText(
    "本文",
  );
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(0);
});
