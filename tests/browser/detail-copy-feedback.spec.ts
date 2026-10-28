import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const feedback = (page: Page) => page.locator("#detail-copy-feedback");
async function clipboard(page: Page) {
  await page.addInitScript(() => {
    const state = {
      mode: "pending",
      calls: [] as string[],
      pending: [] as { resolve: () => void; reject: () => void }[],
    };
    (window as any).__copyFeedback = state;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText(url: string) {
          state.calls.push(url);
          if (state.mode === "success") return Promise.resolve();
          if (state.mode === "failure")
            return Promise.reject(
              new DOMException("Denied", "NotAllowedError"),
            );
          return new Promise<void>((resolve, reject) =>
            state.pending.push({
              resolve,
              reject: () =>
                reject(new DOMException("Denied", "NotAllowedError")),
            }),
          );
        },
      },
    });
  });
}
async function open(page: Page, index = 0) {
  await page.locator(`[data-open="t0-0-${index}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator("#comments-refresh")).toBeEnabled();
}
async function settle(page: Page, index: number, success: boolean) {
  await page.evaluate(
    ({ index, success }) => {
      const pending = (window as any).__copyFeedback.pending[index];
      (success ? pending.resolve : pending.reject)();
    },
    { index, success },
  );
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function calls(page: Page) {
  return page.evaluate(() => (window as any).__copyFeedback.calls as string[]);
}

test("keyboard copy confirms beside the number only after success, stays in the modal without layout shift, and resets its brief timer", async ({
  page,
}) => {
  await clipboard(page);
  const f = await setup(page);
  await open(page);
  await page.clock.install();
  const number = page.locator("#detail-meta");
  await expect(feedback(page)).toBeEmpty();
  await expect(number.locator("svg")).toHaveCount(0);
  const before = await Promise.all([
    number.boundingBox(),
    page.locator("#close-detail").boundingBox(),
    page.locator("#detail-heading").boundingBox(),
  ]);
  const reads = f.reads();
  await number.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => calls(page)).toHaveLength(1);
  await expect(feedback(page)).toBeEmpty();
  await settle(page, 0, true);
  await expect(feedback(page)).toHaveText("コピーしました");
  await expect(feedback(page)).toHaveAttribute("data-state", "success");
  await expect(feedback(page)).toHaveAttribute("role", "status");
  await expect(feedback(page)).toHaveAttribute("aria-atomic", "true");
  await expect(feedback(page).locator('svg[aria-hidden="true"]')).toHaveCount(
    1,
  );
  expect(
    await feedback(page).evaluate((node) => node.closest("dialog")?.id),
  ).toBe("details");
  const after = await Promise.all([
    number.boundingBox(),
    page.locator("#close-detail").boundingBox(),
    page.locator("#detail-heading").boundingBox(),
  ]);
  expect(after).toEqual(before);
  const statusBox = (await feedback(page).boundingBox())!;
  expect(statusBox.x).toBeGreaterThanOrEqual(
    before[0]!.x + before[0]!.width + 8,
  );
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(before[1]!.x - 8);
  await expect(number).toBeFocused();
  await page.screenshot({
    path: `test-results/detail-copy-feedback-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  await page.clock.fastForward(1500);
  await page.evaluate(() => {
    (window as any).__copyFeedback.mode = "success";
  });
  await page.keyboard.press("Space");
  await expect.poll(() => calls(page)).toHaveLength(2);
  await expect(feedback(page)).toHaveText("コピーしました");
  await page.clock.fastForward(1000);
  await expect(feedback(page)).toHaveText("コピーしました");
  await page.clock.fastForward(1100);
  await expect(feedback(page)).toBeEmpty();
  expect(await feedback(page).getAttribute("data-state")).toBeNull();
  await expect(feedback(page).locator("svg")).toHaveCount(0);
  await expect(number).toBeFocused();
  expect(f.reads()).toBe(reads);
  expect(f.posts()).toBe(0);
});

test("reversed clipboard completions cannot turn a newer denial into copied or hide a newer success", async ({
  page,
}) => {
  await clipboard(page);
  const f = await setup(page);
  await open(page);
  for (const [offset, latestSuccess] of [
    [0, false],
    [2, true],
  ] as const) {
    await page.locator("#detail-meta").click();
    await expect(feedback(page)).toBeEmpty();
    await page.locator("#detail-meta").click();
    await expect.poll(() => calls(page)).toHaveLength(offset + 2);
    await settle(page, offset + 1, latestSuccess);
    const text = latestSuccess ? "コピーしました" : "コピーできませんでした";
    await expect(feedback(page)).toHaveText(text);
    await expect(feedback(page)).toHaveAttribute(
      "data-state",
      latestSuccess ? "success" : "failure",
    );
    await expect(feedback(page).locator("svg")).toHaveCount(
      latestSuccess ? 1 : 0,
    );
    await settle(page, offset, !latestSuccess);
    await frames(page);
    await expect(feedback(page)).toHaveText(text);
    await expect(feedback(page)).toHaveAttribute(
      "data-state",
      latestSuccess ? "success" : "failure",
    );
  }
  await expect(page.locator("#announcement")).not.toContainText(
    "コピーしました",
  );
  expect(f.posts()).toBe(0);
});

test("closing and switching to B clears feedback immediately and old A success cannot replace B failure", async ({
  page,
}) => {
  await clipboard(page);
  const f = await setup(page);
  await open(page);
  await page.locator("#detail-meta").click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(feedback(page)).toBeEmpty();
  await open(page, 1);
  await expect(feedback(page)).toBeEmpty();
  await page.evaluate(() => {
    (window as any).__copyFeedback.mode = "failure";
  });
  await page.locator("#detail-meta").click();
  await expect(feedback(page)).toHaveText("コピーできませんでした");
  await settle(page, 0, true);
  await frames(page);
  await expect(page.locator("#detail-meta")).toHaveText("#101");
  await expect(feedback(page)).toHaveText("コピーできませんでした");
  await expect(feedback(page).locator("svg")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(feedback(page)).toBeEmpty();
  await open(page);
  await expect(feedback(page)).toBeEmpty();
  expect(await calls(page)).toEqual([
    "https://github.com/engineer-first/idea-boost/issues/100",
    "https://github.com/engineer-first/idea-boost/issues/101",
  ]);
  expect(f.posts()).toBe(0);
});

test("adapter replacement and public revocation clear nearby feedback and invalidate pending clipboard completions", async ({
  page,
}) => {
  await clipboard(page);
  const f = await setup(page);
  await open(page);
  await page.locator("#detail-meta").click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  await page.evaluate(async (snapshot) => {
    const w = window as any;
    w.__copyPrivate = false;
    await w.Whiteboard.setAdapter({
      load: async () => structuredClone(snapshot),
      saveIssue: async () => {
        throw Error("fixture forbids Issue writes");
      },
      loadComments: async () => {
        if (w.__copyPrivate)
          throw Object.assign(Error("Scope unavailable"), {
            code: "scope_not_public",
          });
        return { comments: [], nextPage: null };
      },
    });
  }, f.board);
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(feedback(page)).toBeEmpty();
  await settle(page, 0, true);
  await frames(page);
  await expect(feedback(page)).toBeEmpty();
  await open(page, 1);
  await page.locator("#detail-meta").click();
  await expect.poll(() => calls(page)).toHaveLength(2);
  await settle(page, 1, true);
  await expect(feedback(page)).toHaveText("コピーしました");
  // Start another request; revocation must invalidate it as well as the display.
  await page.locator("#detail-meta").click();
  await expect.poll(() => calls(page)).toHaveLength(3);
  await page.evaluate(() => {
    (window as any).__copyPrivate = true;
  });
  await page.locator("#comments-refresh").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".task")).toHaveCount(0);
  await expect(feedback(page)).toBeEmpty();
  await settle(page, 2, true);
  await frames(page);
  await expect(feedback(page)).toBeEmpty();
  expect(await feedback(page).getAttribute("data-state")).toBeNull();
  expect(f.posts()).toBe(0);
});
