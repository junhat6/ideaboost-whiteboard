import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
async function prepare(page: any) {
  const s = await setup(page);
  const values: any = { 1: 0.1, 2: 1, 3: 2, 4: 3, 5: 5, 6: 8 };
  let reads = 0;
  let hold = false;
  const waiting: any[] = [];
  const writes: any[] = [];
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", async (r) => {
    reads++;
    const saved = { ...values };
    if (hold) await new Promise((resolve) => waiting.push(() => resolve(null)));
    await r.fulfill({ json: { values: saved } });
  });
  await page.route("**/api/issues/1", async (r) => {
    const p = r.request().postDataJSON();
    writes.push(p);
    values[1] = p.storyPoints;
    Object.assign(s.board.lanes[0], { revision: `new-${writes.length}` });
    await r.fulfill({
      json: {
        ok: true,
        issue: { ...s.board.lanes[0], storyPoints: values[1] },
      },
    });
  });
  await page.reload();
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveText([
    "0.1",
    "1",
    "2",
    "3",
    "5",
    "8",
  ]);
  return {
    s,
    values,
    writes,
    waiting,
    reads: () => reads,
    hold: () => (hold = true),
  };
}
test("one point save keeps all other badges and sidebar without a new full point read", async ({
  page,
}) => {
  const f = await prepare(page);
  f.hold();
  const before = f.s.reads();
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  await expect.poll(f.s.reads).toBeGreaterThan(before);
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("1");
  await expect(page.locator('#board [data-story-points="p1"]')).toBeVisible();
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveText([
    "13",
    "1",
    "2",
    "3",
    "5",
    "8",
  ]);
  expect(f.reads()).toBe(1);
  await page.locator("#close-detail").click();
  await page.locator('.pbi-title[data-pbi="p1"]').click();
  await expect(page.locator("#story-point-editor")).toBeVisible();
  await expect(
    page.locator('#story-point-choices button[aria-pressed="true"]'),
  ).toHaveText("1");
});
test("point read started before ack updates other PBIs but never downgrades the saved point", async ({
  page,
}) => {
  const f = await prepare(page);
  f.values[2] = 5;
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(f.reads).toBe(2);
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  await expect(page.locator("#save-issue")).toBeDisabled();
  f.waiting.shift()();
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("5");
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  await expect(
    page.locator('#story-point-choices button[aria-pressed="true"]'),
  ).toHaveText("13");
  expect(f.reads()).toBe(2);
});

test("completed partial projection removes unavailable and unset values, while pending preserves them", async ({
  page,
}) => {
  const f = await prepare(page);
  delete f.values[2];
  f.values[3] = null;
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(f.reads).toBe(2);
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("1");
  f.waiting.shift()();
  await expect(page.locator('#board [data-story-points="p1"]')).toBeHidden();
  await expect(page.locator('#board [data-story-points="p2"]')).toBeHidden();
  await expect(page.locator('#board [data-story-points="p3"]')).toHaveText("3");
});

test("public field revocation clears even a newer local ack", async ({
  page,
}) => {
  const f = await prepare(page);
  for (const key of Object.keys(f.values)) delete f.values[key];
  f.hold();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(f.reads).toBe(2);
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect.poll(() => f.writes.length).toBe(1);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  f.waiting.shift()();
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveCount(
    0,
  );
  await expect(page.locator("#story-point-editor")).toBeHidden();
});

test("failed autosave leaves other PBI values intact", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/issues/1", (r) =>
    r.fulfill({
      status: 409,
      json: { error: "conflict", message: "変更を確認してください" },
    }),
  );
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect(page.locator("#detail-sync")).toContainText(/変更|競合|確認/);
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("1");
  await expect(page.locator('#board [data-story-points="p5"]')).toHaveText("8");
});

test("rapid point choices coalesce and clearing affects only its own PBI", async ({
  page,
}) => {
  const f = await prepare(page);
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  const choices = page.locator("#story-point-choices");
  await choices.getByRole("button", { name: "13", exact: true }).click();
  await choices.getByRole("button", { name: "8", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].storyPoints).toBe(8);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText("8");
  await choices.getByRole("button", { name: "解除", exact: true }).click();
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].storyPoints).toBeNull();
  await expect(page.locator('#board [data-story-points="p0"]')).toBeHidden();
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("1");
  await expect(choices.locator('[aria-pressed="true"]')).toHaveText("解除");
  expect(f.reads()).toBe(1);
});
