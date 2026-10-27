import { test, expect } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";
const status = (page: any, name: string) =>
  page.locator(`#status-choices [data-status="${name}"]`).click();

test("queued points retain the verified expected value after a status-only response", async ({
  page,
}) => {
  const s = await setup(page);
  let points: number | null = null;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const writes: any[] = [];
  await page.route("**/api/health", (r) =>
    r.fulfill({ json: { configured: true, storyPoints: true } }),
  );
  await page.route("**/api/story-points?*", (r) =>
    r.fulfill({ json: { values: { 1: points } } }),
  );
  await page.route("**/api/issues/1", async (r) => {
    const p = r.request().postDataJSON();
    writes.push(p);
    if (writes.length === 1) await gate;
    if (p.status) s.board.lanes[0].status = p.status;
    if (Object.hasOwn(p, "storyPoints")) points = p.storyPoints;
    s.board.lanes[0].revision = `rev-${writes.length}`;
    await r.fulfill({
      json: {
        ok: true,
        issue: {
          ...s.board.lanes[0],
          ...(Object.hasOwn(p, "storyPoints") ? { storyPoints: points } : {}),
        },
      },
    });
  });
  await page.reload();
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await expect(page.locator("#story-point-editor")).toBeVisible();
  await status(page, "レビュー中");
  await expect.poll(() => writes.length).toBe(1);
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "8", exact: true })
    .click();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  release();
  await expect.poll(() => writes.length).toBe(2);
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(writes[1].storyPoints).toBe(13);
  expect(writes[1].expectedStoryPoints).toBeNull();
  expect(writes[1].expectedRevision).toBe("rev-1");
  expect(writes[1]).not.toHaveProperty("body");
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
});

test("external conflict stops the pending latest intent without retry or body loss", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let posts = 0;
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    await gate;
    await r.fulfill({ status: 409, json: { error: "conflict" } });
  });
  await open(page);
  await fillEditor(page, "自分の本文");
  await status(page, "作業中");
  await expect.poll(() => posts).toBe(1);
  await status(page, "レビュー中");
  release();
  await expect(page.locator("#detail-error")).toBeVisible();
  await expect(page.locator("#detail-body")).toHaveValue("自分の本文");
  await expect(page.locator("#detail-status")).toHaveValue("レビュー中");
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(posts).toBe(1);
});
async function open(page: any) {
  await page.locator('[data-open="t0-0-0"]').click();
}

test("a rapid local selection burst is one request and a return to original is no request", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await page.evaluate(() => {
    for (const name of ["作業中", "レビュー中", "完了", "未整理"])
      (
        document.querySelector(
          `#status-choices [data-status="${name}"]`,
        ) as HTMLButtonElement
      ).click();
  });
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.waitForTimeout(250);
  expect(s.posts()).toBe(0);
  const start = Date.now();
  await page.evaluate(() => {
    for (const name of ["作業中", "レビュー中", "完了", "レビュー中"])
      (
        document.querySelector(
          `#status-choices [data-status="${name}"]`,
        ) as HTMLButtonElement
      ).click();
  });
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#save-issue")).toBeDisabled();
  console.log(
    JSON.stringify({
      viewport: page.viewportSize(),
      burstSelections: 4,
      posts: s.posts(),
      fixtureAckMs: Date.now() - start,
    }),
  );
  await expect(page.locator("#detail-status")).toHaveValue("レビュー中");
  await page.screenshot({
    path: `.wrangler/autosave-after-${page.viewportSize()!.width}.png`,
  });
});

test("a remote change to a queued field stops after first success rather than rebasing blindly", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let posts = 0;
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    const p = r.request().postDataJSON();
    await gate;
    Object.assign(s.board.tasks[0], {
      body: p.body,
      status: "完了",
      revision: "external",
    });
    await r.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await fillEditor(page, "送信本文");
  await page.locator("#save-issue").click();
  await expect.poll(() => posts).toBe(1);
  await status(page, "レビュー中");
  release();
  await expect(page.locator("#detail-error")).toContainText("次の選択");
  await expect(page.locator("#detail-status")).toHaveValue("レビュー中");
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(posts).toBe(1);
});
test("automatic status ack never sends or replaces an unsaved body/title", async ({
  page,
}) => {
  const s = await setup(page);
  const writes: any[] = [];
  const original = s.board.tasks[0].body;
  await page.route("**/api/issues/100", (r) => {
    const p = r.request().postDataJSON();
    writes.push(p);
    Object.assign(s.board.tasks[0], { status: p.status, revision: "new-1" });
    return r.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await fillEditor(page, "未保存の本文");
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("未保存タイトル");
  await page.keyboard.press("Enter");
  await status(page, "レビュー中");
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.locator("#save-issue")).toBeEnabled();
  expect(writes[0]).not.toHaveProperty("body");
  expect(writes[0]).not.toHaveProperty("title");
  expect(s.board.tasks[0].body).toBe(original);
  await expect(page.locator("#detail-body")).toHaveValue("未保存の本文");
  await expect(page.locator("#detail-title")).toHaveValue("未保存タイトル");
});
test("rapid selections serialize the last intent across close/reopen and preserve completed state", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const writes: any[] = [];
  let active = 0,
    max = 0;
  await page.route("**/api/issues/100", async (r) => {
    const p = r.request().postDataJSON();
    writes.push(p);
    max = Math.max(max, ++active);
    if (writes.length === 1) await gate;
    Object.assign(s.board.tasks[0], {
      status: p.status,
      revision: `new-${writes.length}`,
      ...(p.status === "完了" ? { state: "CLOSED" } : {}),
    });
    active--;
    await r.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await status(page, "完了");
  await expect.poll(() => writes.length).toBe(1);
  await status(page, "レビュー中");
  await status(page, "未整理");
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await open(page);
  await expect(page.locator("#detail-status")).toHaveValue("未整理");
  release();
  await expect.poll(() => writes.length).toBe(2);
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(writes.map((p) => p.status)).toEqual(["完了", "未整理"]);
  expect(writes[1].expectedRevision).toBe("new-1");
  expect(max).toBe(1);
  expect(s.board.tasks[0].state).toBe("CLOSED");
});
test("uncertain autosave stops queued choices and restores latest intent after closing", async ({
  page,
}) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let posts = 0;
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    await gate;
    await r.fulfill({
      status: 503,
      json: { error: "mutation_outcome_unresolved", ambiguous: true },
    });
  });
  await open(page);
  await status(page, "レビュー中");
  await expect.poll(() => posts).toBe(1);
  await status(page, "完了");
  await page.locator("#close-detail").click();
  release();
  await expect(page.locator("#save-problems")).toBeVisible();
  await page.locator("#save-problems button").click();
  await expect(page.locator("#detail-status")).toHaveValue("完了");
  await expect(page.locator("#recover-edit")).toBeDisabled();
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(posts).toBe(1);
});
test("assignee selection saves only assignees and preserves body typed during flight", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const writes: any[] = [];
  await page.route("**/api/issues/100", async (r) => {
    const p = r.request().postDataJSON();
    writes.push(p);
    await gate;
    s.board.tasks[0].assignees = p.assignees.map((login: string) => ({
      login,
    }));
    s.board.tasks[0].revision = "new";
    await r.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  await open(page);
  await page.locator('#assignee-tiles [data-login="tester"]').click();
  await expect.poll(() => writes.length).toBe(1);
  await fillEditor(page, "保存中の追加本文");
  release();
  await expect(page.locator("#save-issue")).toBeEnabled();
  await expect(page.locator("#detail-body")).toHaveValue("保存中の追加本文");
  expect(writes[0].assignees).toEqual([]);
  expect(writes[0]).not.toHaveProperty("body");
});
