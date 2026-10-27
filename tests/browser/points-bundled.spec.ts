import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("board projection displays points together without the separate endpoint and refresh replaces them", async ({
  page,
}) => {
  const f = await setup(page);
  let pointReads = 0;
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", (r) => {
    pointReads++;
    return r.fulfill({ json: { values: { 1: 99 } } });
  });
  (f.board as any).storyPoints = {
    values: { 1: 0.1, 2: 1, 3: 2, 4: 3, 5: 5, 6: null },
  };
  await page.reload();
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveText([
    "0.1",
    "1",
    "2",
    "3",
    "5",
  ]);
  expect(pointReads).toBe(0);
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await expect(page.locator("#story-point-editor")).toBeVisible();
  (f.board as any).storyPoints = {
    values: { 1: 13, 2: null, 3: 2, 4: 3, 5: 5 },
  };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  await expect(page.locator('#board [data-story-points="p1"]')).toBeHidden();
  expect(pointReads).toBe(0);
  (f.board as any).storyPoints = { values: {} };
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveCount(
    0,
    { timeout: 10000 },
  );
  await expect(page.locator("#story-point-editor")).toBeHidden();
});

test("bundled point autosave retains siblings and manual body draft, then reflects canonical refresh", async ({
  page,
}) => {
  const f = await setup(page);
  let pointReads = 0;
  const writes: any[] = [];
  (f.board as any).storyPoints = {
    values: { 1: 5, 2: 1, 3: 2, 4: 3, 5: 5, 6: 8 },
  };
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", (r) => {
    pointReads++;
    return r.fulfill({ json: { values: {} } });
  });
  await page.route("**/api/issues/1", (r) => {
    const patch = r.request().postDataJSON();
    writes.push(patch);
    (f.board as any).storyPoints.values[1] = patch.storyPoints;
    f.board.lanes[0].revision = "new";
    return r.fulfill({
      json: {
        ok: true,
        issue: { ...f.board.lanes[0], storyPoints: patch.storyPoints },
      },
    });
  });
  await page.reload();
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await page.locator(".cm-content").fill("未保存の本文");
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty("body");
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("1");
  await expect(page.locator(".cm-content")).toContainText("未保存の本文");
  expect(pointReads).toBe(0);
});
