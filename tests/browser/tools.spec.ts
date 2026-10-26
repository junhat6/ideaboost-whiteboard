import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("live only with exceptional F8 source and immediate hoverable accessible tooltips", async ({
  page,
}) => {
  const s = await setup(page);
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("#detail-body")).toBeHidden();
  await expect(page.locator("#markdown-preview,#markdown-write")).toHaveCount(
    0,
  );
  await expect(page.locator("#markdown-source")).toBeHidden();
  const button = page.locator("#editor-options");
  await page.waitForTimeout(220); // Wait only for the opening layout animation, not tooltip delay.
  await page.mouse.move(0, 0);
  const start = Date.now();
  await button.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible({ timeout: 700 });
  expect(Date.now() - start).toBeLessThan(1200);
  await expect(button).not.toHaveAttribute("title");
  await expect(button).toHaveAttribute(
    "aria-describedby",
    (await tip.getAttribute("id")) || "",
  );
  const box = await tip.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await tip.hover();
  await page.waitForTimeout(180);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
  await expect(page.locator("#details")).toBeVisible();
  await button.focus(); // New focus cycle is allowed.
  await expect(tip).toBeVisible();
  await button.click();
  await expect(page.locator("#markdown-source")).toBeVisible();
  await page.locator("#markdown-source").click();
  await expect(page.locator("#markdown-source")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const raw = await page.locator("#detail-body").inputValue();
  await page.keyboard.press("F8");
  await expect(page.locator("#markdown-source")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator(".cm-content").dispatchEvent("compositionstart");
  await page.keyboard.press("F8");
  await expect(page.locator("#markdown-source")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator(".cm-content").dispatchEvent("compositionend");
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(0);
  await page.screenshot({
    path: `.wrangler/live-tools-${page.viewportSize()!.width}.png`,
  });
});
test("deep raw HTML safely falls back inside live editor", async ({ page }) => {
  const s = await setup(page);
  const raw =
    "<details><summary>x</summary>" +
    "<div>".repeat(3000) +
    "x" +
    "</div>".repeat(3000) +
    "</details>";
  s.board.tasks[0].body = raw;
  await page.evaluate(
    (b) => (window as any).Whiteboard.applySnapshot(b),
    s.board,
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(errors).toEqual([]);
  expect(s.posts()).toBe(0);
});
