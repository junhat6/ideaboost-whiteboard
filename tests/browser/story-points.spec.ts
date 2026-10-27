import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

async function prepare(page: any) {
  const fixture = await setup(page, { longPbi: true });
  await page.evaluate(async (board: any) => {
    const w = window as any;
    w.pointsReads = [];
    w.pointsBoard = board;
    w.pointsWrites = 0;
    await w.Whiteboard.setAdapter({
      load: async () => structuredClone(w.pointsBoard),
      saveIssue: async () => {
        w.pointsWrites++;
        throw new Error("QA write forbidden");
      },
      loadStoryPoints: (pbis: any) =>
        new Promise((resolve, reject) =>
          w.pointsReads.push({ pbis, resolve, reject }),
        ),
    });
  }, fixture.board);
}

test("late points never block board or editor; every scale value uses a compact neutral badge", async ({
  page,
}) => {
  await prepare(page);
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator(".task").first()).toBeVisible();
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await page.locator('[data-pbi="p0"]').first().click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#save-issue")).toBeVisible();
  await page.evaluate(() =>
    (window as any).pointsReads[0].resolve({
      values: { 1: 0.1, 2: 1, 3: 2, 4: 3, 5: 5, 6: 8, 101: 13 },
    }),
  );
  await expect(page.locator("#detail-story-points")).toHaveText("SP 0.1");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".pbi-context .story-points:visible")).toHaveText([
    "0.1",
    "1",
    "2",
    "3",
    "5",
    "8",
  ]);
  expect(
    await page.locator(".pbi-cell").evaluateAll((cells) =>
      cells.every((cell) => {
        const b = cell.getBoundingClientRect();
        return [
          ...cell.querySelectorAll(
            ".pbi-title,.pbi-context,.lane-progress,.story-points",
          ),
        ].every((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left >= b.left &&
            r.right <= b.right &&
            r.top >= b.top &&
            r.bottom <= b.bottom
          );
        });
      }),
    ),
  ).toBe(true);
  await page.screenshot({
    path: `.wrangler/story-points-${page.viewportSize()!.width}.png`,
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#detail-story-points")).toBeHidden();
  expect(await page.evaluate(() => (window as any).pointsWrites)).toBe(0);
});

test("poll replaces points, unset/private/failed reads hide badges and stale responses cannot restore them", async ({
  page,
}) => {
  await page.clock.install();
  await prepare(page);
  await page.evaluate(() =>
    (window as any).pointsReads[0].resolve({ values: { 1: 13 } }),
  );
  await expect(page.locator('[data-story-points="p0"]')).toHaveText("13");
  await page.clock.fastForward(46000);
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await page.clock.fastForward(46000);
  await page.evaluate(() => {
    const w = window as any;
    w.pointsReads[1].resolve({ values: { 1: 8 } });
    w.pointsReads[2].resolve({
      values: { 1: null, 2: "13", 3: {}, 4: Infinity },
    });
  });
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await page.clock.fastForward(46000);
  await page.evaluate(() =>
    (window as any).pointsReads[3].reject(new Error("403")),
  );
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await page.clock.fastForward(46000);
  await page.evaluate(() =>
    (window as any).pointsReads[4].resolve({ values: {} }),
  );
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).pointsWrites)).toBe(0);
});

test("current production adapter never requests an unconfigured points endpoint", async ({
  page,
}) => {
  const s = await setup(page);
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  expect(s.posts()).toBe(0);
});

test("remote estimate refresh does not reset the PBI draft and private scope clears immediately", async ({
  page,
}) => {
  await page.clock.install();
  await prepare(page);
  await page.evaluate(() =>
    (window as any).pointsReads[0].resolve({ values: { 1: 8 } }),
  );
  await page.locator('[data-pbi="p0"]').first().click();
  await expect(page.locator("#detail-story-points")).toHaveText("SP 8");
  // Title draft is independent of the optional read-only estimate.
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("下書きを保持");
  await page.keyboard.press("Enter");
  await page.clock.fastForward(46000);
  await page.evaluate(() =>
    (window as any).pointsReads[1].resolve({ values: { 1: 13 } }),
  );
  await expect(page.locator("#detail-story-points")).toHaveText("SP 13");
  await expect(page.locator("#detail-title")).toHaveValue("下書きを保持");
  await expect(page.locator("#save-issue")).toBeEnabled();
  await page.clock.fastForward(46000);
  await page.evaluate(() =>
    (window as any).pointsReads[2].reject(
      Object.assign(new Error("公開範囲を確認できません"), {
        code: "scope_not_public",
      }),
    ),
  );
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await expect(page.locator("#detail-story-points")).toHaveText("");
  expect(await page.evaluate(() => (window as any).pointsWrites)).toBe(0);
});

test("enabled API capability connects the separate late-read endpoint without delaying the board", async ({
  page,
}) => {
  const f = await setup(page);
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = "";
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: {
        configured: true,
        accessMode: "public-temporary",
        storyPoints: true,
      },
    }),
  );
  await page.route("**/api/story-points?*", async (route) => {
    requested = new URL(route.request().url()).searchParams.get("issues") || "";
    await gate;
    await route.fulfill({ json: { values: { 1: 0.1, 2: 13 } } });
  });
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect.poll(() => requested).toBe("1,2,3,4,5,6");
  await expect(page.locator(".story-points:visible")).toHaveCount(0);
  await page.locator('[data-pbi="p0"]').first().click();
  await expect(page.locator("#details")).toBeVisible();
  release!();
  await expect(page.locator("#detail-story-points")).toHaveText("SP 0.1");
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText(
    "13",
  );
  expect(f.posts()).toBe(0);
});

test("PBI sidebar edits only an explicit point choice or clear, preserving unknown original values", async ({
  page,
}) => {
  const f = await setup(page);
  let points: number | null = 4;
  const writes: any[] = [];
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", (r) =>
    r.fulfill({ json: { values: { 1: points } } }),
  );
  await page.route("**/api/issues/1", (r) => {
    const data = r.request().postDataJSON();
    writes.push(data);
    if (Object.hasOwn(data, "storyPoints")) points = data.storyPoints;
    Object.assign(f.board.lanes[0], {
      title: data.title || f.board.lanes[0].title,
      revision: `2026-10-27T00:00:0${writes.length}Z`,
    });
    return r.fulfill({
      json: { ok: true, issue: { ...f.board.lanes[0], storyPoints: points } },
    });
  });
  await page.reload();
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText("4");
  await page.locator('[data-pbi="p0"]').first().click();
  await expect(page.locator("#story-point-choices button")).toHaveCount(8);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("タイトルだけ");
  await page.keyboard.press("Enter");
  await page.locator("#save-issue").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty("storyPoints");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "8", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].storyPoints).toBe(8);
  expect(writes[1].expectedStoryPoints).toBe(4);
  expect(writes[1]).not.toHaveProperty("body");
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText("8");
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "解除", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].storyPoints).toBeNull();
  expect(writes[2].expectedStoryPoints).toBe(8);
  await expect(page.locator('#board [data-story-points="p0"]')).toBeHidden();
});

test("verified unset points allow first assignment while missing values stay unavailable", async ({
  page,
}) => {
  const f = await setup(page);
  const writes: any[] = [];
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", (r) =>
    r.fulfill({ json: { values: { 1: null } } }),
  );
  await page.route("**/api/issues/1", (r) => {
    const data = r.request().postDataJSON();
    writes.push(data);
    return r.fulfill({
      json: {
        ok: true,
        issue: { ...f.board.lanes[0], storyPoints: data.storyPoints },
      },
    });
  });
  await page.reload();
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await expect(page.locator("#story-point-editor")).toBeVisible();
  await expect(page.locator('#board [data-story-points="p0"]')).toBeHidden();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "0.1", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].storyPoints).toBe(0.1);
  expect(writes[0].expectedStoryPoints).toBeNull();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#close-detail").click();
  await page.locator('.pbi-title[data-pbi="p1"]').click();
  await expect(page.locator("#story-point-editor")).toBeHidden();
});
