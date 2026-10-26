import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("live surface hides syntax until selected, preserves original CRLF, undo and source mode", async ({
  page,
}) => {
  const s = await setup(page);
  const raw =
    '## 見出し\r\n\r\n**太字** と [リンク](https://example.com)\r\n\r\n- [x] タスク\r\n\r\n| A | B |\r\n|---|---|\r\n| 一 | 二 |\r\n\r\n```js\r\nconst x = "**保持**";\r\n```';
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".cm-content")).not.toContainText("##");
  await expect(page.locator(".cm-content")).not.toContainText("**太字**");
  await expect(page.locator(".cm-content table")).toHaveCount(1);
  await expect(page.locator("#detail-body")).toHaveValue(
    raw.replaceAll("\r\n", "\n"),
  );
  await page.locator(".cm-line").filter({ hasText: "見出し" }).click();
  await expect(page.locator(".cm-content")).toContainText("##");
  await page.keyboard.press("End");
  await page.keyboard.type("Z");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#detail-body")).toHaveValue(
    raw.replaceAll("\r\n", "\n"),
  );
  await page.locator("#markdown-source").click();
  await expect(page.locator(".cm-content")).toContainText("**太字**");
  await expect(page.locator(".cm-content table")).toHaveCount(0);
  await page.locator("#markdown-source").click();
  await expect(page.locator(".cm-content table")).toHaveCount(1);
  expect(s.posts()).toBe(0);
  await page.screenshot({
    path: `.wrangler/live-${page.viewportSize()!.width}.png`,
  });
});
test("live attachment defers video requests and remains stable while unrelated text is edited", async ({
  page,
}) => {
  const s = await setup(page);
  const url =
    "https://github.com/user-attachments/assets/00000000-0000-4000-8000-000000000001";
  let requests = 0;
  await page.route("https://github.com/user-attachments/**", (r) => {
    requests++;
    return r.abort();
  });
  s.board.tasks[0].body = `## 本文\n\n${url}\n\n最後の段落`;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content .media-shell")).toHaveCount(1);
  expect(requests).toBe(0);
  await expect(page.locator("video")).toHaveCount(0);
  await page.locator(".cm-line").filter({ hasText: "最後の段落" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("追記");
  await expect(page.locator(".cm-content .media-shell")).toHaveCount(1);
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "動画として再生" }).click();
  await expect.poll(() => requests).toBe(1);
  await page.locator("video").evaluate((v) => (v.dataset.retained = "yes"));
  await page.locator(".cm-line").filter({ hasText: "最後の段落" }).click();
  await page.keyboard.press("End");
  await page.keyboard.type("さらに");
  await expect(page.locator("video")).toHaveAttribute("data-retained", "yes");
  expect(requests).toBe(1);
  page.on("dialog", (d) => d.accept());
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator("video")).toHaveCount(0);
  expect(s.posts()).toBe(0);
});

test("undo and redo of newline deletion preserve exact mixed raw Markdown", async ({
  page,
}) => {
  const s = await setup(page);
  const raw = "## 原文\r\n\r\n段落\n次の行\r\n";
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText("置換した本文");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.locator("#detail-body")).toHaveValue("置換した本文");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("原文を保持して改名");
  const request = page.waitForRequest((r) => r.method() === "POST");
  await page.locator("#save-issue").click();
  expect((await request).postDataJSON()).not.toHaveProperty("body");
  expect(s.board.tasks[0].body).toBe(raw);
});

test("compact toolbar fits one row and its icon actions are not covered by operations toggle", async ({
  page,
}) => {
  await setup(page);
  const h = await page.locator(".board-head").boundingBox();
  await page.mouse.move(400, h!.y + h!.height + 50);
  await page.mouse.move(400, h!.y + h!.height * 0.4);
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await page.waitForTimeout(200);
  const panel = await page.locator(".control-panel").boundingBox(),
    toggle = await page.locator("#operations").boundingBox(),
    about = await page.locator("#about").boundingBox();
  expect(panel!.height).toBeLessThan(100);
  expect(about!.x + about!.width).toBeLessThan(toggle!.x);
  await expect(page.locator(".control-panel .help")).toHaveCount(0);
  await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
  await expect(page.locator("#about-dialog")).toBeVisible();
});
