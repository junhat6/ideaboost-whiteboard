import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
for (const platform of ["MacIntel", "Win32"])
  test(`live links edit normally and open safely with modifier on ${platform}`, async ({
    page,
  }) => {
    await page.addInitScript((p) => {
      Object.defineProperty(navigator, "platform", { get: () => p });
      (window as any).opened = [];
      window.open = ((...args) => (window as any).opened.push(args)) as any;
    }, platform);
    const s = await setup(page);
    const raw =
      "[Open](https://example.com/path)\n\n[reference][r]\n\n[r]: https://example.com/reference\n\n[bad](javascript:alert(1))\n\n```\nhttps://example.com/fenced\n```";
    s.board.tasks[0].body = raw;
    await page.evaluate(
      (b) => (window as any).Whiteboard.applySnapshot(b),
      s.board,
    );
    await page.locator(".task-title").first().click();
    const link = page.locator(".cm-content .live-link").first();
    await expect(link).toBeVisible();
    await link.hover();
    await expect(
      page.getByRole("link", { name: "リンクを開く（新しいタブ）" }),
    ).toBeVisible();
    await link.click({
      modifiers: [platform === "MacIntel" ? "Meta" : "Control"],
    });
    expect(await page.evaluate(() => (window as any).opened)).toEqual([
      ["https://example.com/path", "_blank", "noopener,noreferrer"],
    ]);
    await page
      .locator(".cm-content .cm-line")
      .first()
      .click({ position: { x: 15, y: 10 } });
    await expect(page.locator("#detail-body")).toHaveValue(raw);
    await expect(page.locator("#save-issue")).toBeDisabled();
    expect(await page.evaluate(() => (window as any).opened.length)).toBe(1);
    const control = page.getByRole("link", {
      name: "リンクを開く（新しいタブ）",
    });
    await expect(control).toHaveAttribute("href", "https://example.com/path");
    await expect(control).toHaveAttribute("rel", "noopener noreferrer");
    await control.focus();
    await expect(control).toBeFocused();
    await page.screenshot({
      path: `.wrangler/live-links-${platform}-${page.viewportSize()!.width}.png`,
    });
    expect(s.posts()).toBe(0);
  });
