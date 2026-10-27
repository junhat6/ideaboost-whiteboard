import { test, expect } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";
async function open(page: any, id = "t0-0-0") {
  await page.locator(`[data-open="${id}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
}
test("closing a pending save releases the board immediately and A success never overwrites B draft", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  let posts = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    const payload = route.request().postDataJSON();
    await gate;
    Object.assign(s.board.tasks[0], {
      body: payload.body,
      revision: "2026-10-27T00:00:00Z",
    });
    await route.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await fillEditor(page, "Aの送信本文");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(1);
  const started = Date.now();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  expect(Date.now() - started).toBeLessThan(1000);
  await open(page, "t0-0-1");
  await fillEditor(page, "Bの未保存本文");
  release();
  await expect.poll(() => s.board.tasks[0].body).toBe("Aの送信本文");
  await expect(page.locator("#detail-body")).toHaveValue("Bの未保存本文");
  await expect(page.locator("#save-issue")).toBeEnabled();
  expect(posts).toBe(1);
});
test("failure after close remains discoverable and restores the sent draft without automatic retry", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  let posts = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    await gate;
    await route.fulfill({
      status: 503,
      json: { error: "mutation_outcome_unresolved", ambiguous: true },
    });
  });
  await open(page);
  await fillEditor(page, "復元する本文");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(1);
  await page.locator("#close-detail").click();
  release();
  await expect(page.locator("#save-problems")).toBeVisible();
  await page.locator("#save-problems button").click();
  await expect(page.locator("#detail-body")).toHaveValue("復元する本文");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#recover-edit")).toBeDisabled();
  expect(posts).toBe(1);
});
test("explicit X to Y then X during POST remains dirty after success and saves only on next explicit save", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  let posts = 0;
  const original = s.board.tasks[0].body,
    gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    const payload = route.request().postDataJSON();
    if (posts === 1) await gate;
    Object.assign(s.board.tasks[0], {
      body: payload.body,
      revision: `2026-10-27T00:00:0${posts}Z`,
    });
    await route.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await fillEditor(page, "Y");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(1);
  await fillEditor(page, original);
  await expect(page.locator("#save-issue")).toBeDisabled();
  release();
  await expect(page.locator("#save-issue")).toBeEnabled();
  await expect(page.locator("#detail-body")).toHaveValue(original);
  expect(posts).toBe(1);
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(2);
  await expect.poll(() => s.board.tasks[0].body).toBe(original);
});
test("a GET started before a confirmed save cannot downgrade the board or open editor", async ({
  page,
}) => {
  const s = await setup(page);
  const old = structuredClone(s.board);
  let release!: () => void;
  let reads = 0;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (route) => {
    reads++;
    if (reads === 1) {
      await gate;
      await route.fulfill({ json: old });
    } else await route.fulfill({ json: s.board });
  });
  await open(page);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => reads).toBe(1);
  await fillEditor(page, "確定した新本文");
  await page.locator("#save-issue").click();
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#save-issue")).toBeDisabled();
  release();
  await expect(page.locator("#detail-body")).toHaveValue("確定した新本文");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[0].body,
      ),
    )
    .toBe("確定した新本文");
});

test("two Issue saves may finish in reverse order without a global lock or draft cross-talk", async ({
  page,
}) => {
  const s = await setup(page);
  const release: any = {};
  let posts = 0;
  for (const [number, index] of [
    [100, 0],
    [101, 1],
  ])
    await page.route(`**/api/issues/${number}`, async (route) => {
      posts++;
      const body = route.request().postDataJSON().body;
      await new Promise<void>((r) => (release[number] = r));
      Object.assign(s.board.tasks[index], {
        body,
        revision: `2026-10-27T00:00:0${index + 1}Z`,
      });
      await route.fulfill({ json: { ok: true, issue: s.board.tasks[index] } });
    });
  await open(page);
  await fillEditor(page, "Aの保存");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(1);
  await page.locator("#close-detail").click();
  await open(page, "t0-0-1");
  await fillEditor(page, "Bの保存");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(2);
  release[101]();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await fillEditor(page, "Bの次の下書き");
  release[100]();
  await expect.poll(() => s.board.tasks[0].body).toBe("Aの保存");
  await expect(page.locator("#detail-body")).toHaveValue("Bの次の下書き");
  await expect(page.locator("#save-issue")).toBeEnabled();
  expect(posts).toBe(2);
});
