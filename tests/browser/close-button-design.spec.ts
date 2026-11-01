import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

for (const theme of ["light", "dark"])
  test(`${theme}: Close is a quiet violet completion action, separate from posting in idle, busy and retry states`, async ({
    page,
  }) => {
    const f = await setup(page);
    if (theme === "dark") {
      await page.locator("#operations").click();
      await page.locator("#theme").click();
      await page.locator("#operations").click();
    }
    const posts: Record<string, unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/issues/100", async (route) => {
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) {
        await gate;
        return route.fulfill({
          status: 502,
          json: {
            ok: false,
            error: "github_error",
            ambiguous: false,
            partial: false,
            issue: f.board.tasks[0],
          },
        });
      }
      Object.assign(f.board.tasks[0], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      return route.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
    });
    try {
      await page.locator('[data-open="t0-0-0"]').click();
      await expect(page.locator("#comments-refresh")).toBeEnabled();
      const button = page.getByRole("button", {
        name: "IssueをClose",
        exact: true,
      });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeEnabled();
      await expect(button.locator("svg.octicon-issue-closed")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await expect(button.locator("svg")).toHaveCount(1);
      const style = await button.evaluate((element) => {
        const css = getComputedStyle(element);
        const rgba = (value: string) => {
          const canvas = document.createElement("canvas"),
            context = canvas.getContext("2d")!;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
        };
        const luminance = (rgb: number[]) =>
          rgb
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const contrast = (a: string, b: string) => {
          const values = [luminance(rgba(a)), luminance(rgba(b))].sort(
            (x, y) => y - x,
          );
          return (values[0] + 0.05) / (values[1] + 0.05);
        };
        return {
          background: css.backgroundColor,
          postBackground: getComputedStyle(
            document.querySelector("#post-comment")!,
          ).backgroundColor,
          textContrast: contrast(css.color, css.backgroundColor),
          borderContrast: contrast(css.borderTopColor, css.backgroundColor),
          height: element.getBoundingClientRect().height,
        };
      });
      expect(style.background).not.toBe(style.postBackground);
      expect(style.textContrast).toBeGreaterThanOrEqual(4.5);
      expect(style.borderContrast).toBeGreaterThanOrEqual(3);
      expect(style.height).toBeGreaterThanOrEqual(36);
      // Programmatic focus after a mouse click is not keyboard focus-visible.
      await button.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(button).toBeFocused();
      await expect(button).toHaveCSS("outline-style", "solid");
      const capture = async (state: string) => {
        await page.locator("#close-issue").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/close-button-${page.viewportSize()!.width}-${theme}-${state}.png`,
          animations: "disabled",
        });
      };
      await capture("idle");
      await page.keyboard.press("Space");
      await expect.poll(() => posts.length).toBe(1);
      await expect(page.locator("#close-issue")).toHaveText("Close中…");
      await expect(page.locator("#close-issue")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await expect(page.locator("#close-issue")).toBeDisabled();
      await expect(page.locator("#close-issue svg")).toHaveCount(1);
      await capture("busy");
      release();
      await expect(page.locator("#recover-edit")).toBeEnabled();
      await page.locator("#recover-edit").click();
      await expect(page.locator("#close-issue")).toHaveText("Closeを再試行");
      await expect(page.locator("#close-issue")).toBeEnabled();
      await expect(page.locator("#close-issue svg")).toHaveCount(1);
      await capture("retry");
      await page.locator("#close-issue").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
      await expect(page.locator("#close-issue")).toBeHidden();
      expect(posts).toHaveLength(2);
      for (const post of posts) {
        expect(post.close).toBe(true);
        for (const field of ["status", "body", "title", "assignees"])
          expect(post).not.toHaveProperty(field);
      }
      expect(f.posts()).toBe(0);
    } finally {
      release();
    }
  });
