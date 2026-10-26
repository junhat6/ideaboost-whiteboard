import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
for (const platform of ["MacIntel", "Win32"])
  test(`official icons and equal keycaps on ${platform}`, async ({ page }) => {
    await page.addInitScript(
      (p) => Object.defineProperty(navigator, "platform", { get: () => p }),
      platform,
    );
    const s = await setup(page);
    await page.locator(".task-title").first().click();
    const keys = page.locator("#save-issue kbd");
    await expect(keys).toHaveCount(2);
    await expect(keys.first()).toHaveText(
      platform === "MacIntel" ? "⌘" : "Ctrl",
    );
    for (const k of await keys.all()) {
      await expect(k).toHaveCSS("width", "22px");
      await expect(k).toHaveCSS("height", "22px");
    }
    const refresh = page.locator("#comments-refresh"),
      svg = refresh.locator("svg");
    await expect(svg).toHaveAttribute("viewBox", "0 0 16 16");
    await expect(svg).toHaveCSS("fill", "rgb(71, 85, 105)");
    await expect(refresh).toBeEnabled();
    let release;
    const gate = new Promise<void>((r) => (release = r));
    let reads = 0;
    await page.route("**/api/issues/*/comments*", async (r) => {
      reads++;
      await gate;
      return r.fulfill({ json: { comments: [], nextPage: null } });
    });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(refresh).toHaveAttribute("aria-busy", "true");
    await expect(svg).toHaveCSS("width", "16px");
    await expect(svg).toHaveCSS("height", "16px");
    expect(reads).toBe(1);
    release();
    await expect(refresh).toBeEnabled();
    await page.screenshot({
      path: `.wrangler/icons-${platform}-${page.viewportSize()!.width}.png`,
    });
    expect(s.posts()).toBe(0);
    await page.unroute("**/api/issues/*/comments*");
  });
