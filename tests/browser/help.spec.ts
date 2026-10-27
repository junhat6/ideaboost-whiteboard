import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("help concentrates on non-obvious editing and status behavior", async ({
  page,
}) => {
  await setup(page);
  await page.locator("#operations").click();
  await page.locator("#about").click();
  const dialog = page.locator("#about-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("h3")).toHaveText([
    "選ぶ変更と、書く変更",
    "列とステータス",
    "Demo goalを直したいとき",
  ]);
  await expect(dialog).not.toContainText(/最大6|Fで|Escape/);
  await expect(dialog).toContainText("本文・タイトル");
  const box = await dialog.boundingBox();
  expect(box!.height).toBeLessThan(page.viewportSize()!.height - 40);
  await page.screenshot({
    path: `.wrangler/help-after-${page.viewportSize()!.width}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#about")).toBeFocused();
});
