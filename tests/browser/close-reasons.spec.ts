import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

// DOM/keyboard ownership and API wiring cannot be covered by the server tests.
test("理由メニューはキーボード・外クリック・Issue切替で閉じ、主操作を変更しない", async ({
  page,
}) => {
  const f = await setup(page);
  await page.locator('[data-open="t0-0-0"]').click();
  const trigger = page.getByRole("button", { name: "Close理由を選ぶ" });
  const menu = page.getByRole("menu", { name: "Close理由", exact: true });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("menuitem").last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("#details")).toBeVisible();
  await trigger.click();
  await page.keyboard.press("Shift+Tab");
  await expect(menu).toBeHidden();
  await expect(page.locator("#close-issue")).toBeFocused();
  await trigger.click();
  await page.locator("#comment-body").click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#comment-body")).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(menu).toBeHidden();
  await trigger.click();
  await page.locator("#close-detail").click();
  await page.locator('[data-open="t0-0-1"]').click();
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#close-issue")).toHaveText("IssueをClose");
  expect(f.posts()).toBe(0);
});

for (const [reason, label] of [
  ["not_planned", "見送り"],
  ["duplicate", "重複"],
])
  test(`${label}は一度だけ送信し、再取得後も理由を保持、別Issueの主ボタンは完了`, async ({
    page,
  }) => {
    const f = await setup(page);
    const posts: Record<string, unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/issues\/(100|101)$/, async (route) => {
      const patch = route.request().postDataJSON();
      posts.push(patch);
      const number = Number(
        new URL(route.request().url()).pathname.split("/").pop(),
      );
      if (number === 100) await gate;
      const issue = f.board.tasks.find((task) => task.number === number)!;
      Object.assign(issue, {
        state: "CLOSED",
        stateReason: String(patch.closeReason ?? "completed").toUpperCase(),
      });
      await route.fulfill({ json: { ok: true, issue } });
    });
    try {
      await page.locator('[data-open="t0-0-0"]').click();
      await page.getByRole("button", { name: "Close理由を選ぶ" }).click();
      await page
        .getByRole("menuitem", { name: `${label}としてClose` })
        .click();
      await expect.poll(() => posts.length).toBe(1);
      await expect(page.locator("#close-issue-options")).toBeDisabled();
      await expect(page.locator("#close-issue")).toBeDisabled();
      await expect(page.locator("#close-issue-menu")).toBeHidden();
      await page.locator("#close-issue").dispatchEvent("click");
      await page
        .locator(`[data-close-reason="${reason}"]`)
        .dispatchEvent("click");
      expect(posts).toHaveLength(1);
      release();
      await expect(page.locator("#issue-state")).toHaveText(
        `Closed · ${label}`,
      );
      expect(posts[0].closeReason).toBe(reason);
      expect(posts[0].close).toBe(true);
      for (const key of ["title", "body", "status", "assignees"])
        expect(posts[0]).not.toHaveProperty(key);
      await page.reload();
      await page.locator('[data-open="t0-0-0"]').click();
      await expect(page.locator("#issue-state")).toHaveText(
        `Closed · ${label}`,
      );
      await expect(page.locator("#close-issue-options")).toBeHidden();
      await page.locator("#close-detail").click();
      await page.locator('[data-open="t0-0-1"]').click();
      await page
        .getByRole("button", { name: "IssueをClose", exact: true })
        .click();
      await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
      expect(posts).toHaveLength(2);
      expect(posts[1].closeReason ?? "completed").toBe("completed");
    } finally {
      release();
    }
  });

test("選択理由と異なる成功応答は成功扱いせず、再取得でも自動再送しない", async ({
  page,
}) => {
  const f = await setup(page);
  let posts = 0;
  await page.route("**/api/issues/100", (route) => {
    posts++;
    return route.fulfill({
      json: {
        ok: true,
        issue: {
          ...f.board.tasks[0],
          state: "CLOSED",
          stateReason: "COMPLETED",
        },
      },
    });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.getByRole("button", { name: "Close理由を選ぶ" }).click();
  await page.getByRole("menuitem", { name: "重複としてClose" }).click();
  await expect(page.locator("#detail-error")).toBeVisible();
  await expect(page.locator("#issue-state")).toHaveText("Open");
  await expect(page.locator("#close-issue-options")).toBeDisabled();
  await page.locator("#recover-edit").click();
  await expect(page.locator("#detail-error")).toContainText("管理者");
  await expect(page.locator("#close-issue-options")).toBeDisabled();
  expect(posts).toBe(1);
});
