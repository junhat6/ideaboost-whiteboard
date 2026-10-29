import { test, expect, type Page } from "@playwright/test";
import { setup, chooseToolbarOption } from "./fixtures";

const scope = JSON.stringify([
  "github",
  "engineer-first",
  "idea-boost",
  3,
  16,
  "default",
]);
const selectionKey = `idea-boost-whiteboard-display-v2:${scope}`;
const rowsKey = `idea-boost-whiteboard-rows-v1:${scope}`;
const badges = (page: Page) => page.locator("#board .story-points:visible");
const valueMap = (value: number) =>
  Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, value]));
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function counts(page: Page) {
  return page.evaluate(() => {
    const f = (window as any).__managedPoints;
    return {
      reads: f.reads.length,
      writes: f.writes.length,
      maximum: f.maximum,
      sizes: f.reads.map((read: any) => read.pbis.length),
    };
  });
}
async function settle(page: Page, index: number, values?: any, code?: string) {
  await page.evaluate(
    ({ index, values, code }) => {
      const read = (window as any).__managedPoints.reads[index];
      if (!read || read.done)
        throw Error(`invalid fixture settlement: ${index}`);
      read.done = true;
      if (code) read.reject(Object.assign(Error(code), { code }));
      else
        read.resolve({ values: values === undefined ? read.snapshot : values });
    },
    { index, values, code },
  );
  await frames(page);
}
async function chooseRows(page: Page, value: number | "all") {
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) !== "true"
  )
    await page.locator("#operations").click();
  await chooseToolbarOption(page, "fit-mode", String(value));
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) === "true"
  )
    await page.locator("#operations").click();
}
async function refresh(page: Page) {
  expect(
    await page.evaluate(() => {
      const w = window as any;
      return w.Whiteboard.applySnapshot(
        structuredClone(w.__managedPoints.board),
      );
    }),
  ).toBe(true);
  await frames(page);
}
async function prepare(page: Page, bundled = false) {
  await page.addInitScript(
    ({ selectionKey, rowsKey }) => {
      localStorage.setItem(
        selectionKey,
        JSON.stringify({
          mode: "manual",
          ids: Array.from({ length: 12 }, (_, i) => `p${i}`),
          topN: 6,
        }),
      );
      localStorage.setItem(rowsKey, JSON.stringify({ value: 6, lastRows: 6 }));
    },
    { selectionKey, rowsKey },
  );
  const fixture = await setup(page);
  const lanes = Array.from({ length: 12 }, (_, i) => ({
    ...structuredClone(fixture.board.lanes[0]),
    id: `p${i}`,
    nodeId: `p${i}`,
    number: i + 1,
    url: `https://github.com/engineer-first/idea-boost/issues/${i + 1}`,
    title: `管理対象PBI ${i + 1}`,
  }));
  const board: any = {
    ...fixture.board,
    lanes,
    tasks: lanes.map((lane, i) => ({
      ...structuredClone(fixture.board.tasks[0]),
      id: `t${i}`,
      nodeId: `t${i}`,
      lane: lane.id,
      number: 100 + i,
      url: `https://github.com/engineer-first/idea-boost/issues/${100 + i}`,
    })),
    scope: { ...fixture.board.scope, storyPointsField: true },
  };
  if (bundled)
    board.storyPoints = { values: { ...valueMap(5), 1: 0, 2: null } };
  // Existing public adapter seam; all reads/saves below are synthetic promises.
  await page.evaluate(async (board) => {
    const w = window as any;
    const f = (w.__managedPoints = {
      board,
      reads: [] as any[],
      writes: [] as any[],
      active: 0,
      maximum: 0,
      values: Object.fromEntries(
        board.lanes.map((lane: any) => [lane.number, lane.number]),
      ),
    });
    await w.Whiteboard.setAdapter({
      load: async () => structuredClone(f.board),
      loadComments: async () => ({ comments: [], nextPage: null }),
      loadPullRequests: async () => ({ prs: [], nextCursor: null }),
      loadStoryPoints: (pbis: any[]) => {
        f.active++;
        f.maximum = Math.max(f.maximum, f.active);
        const snapshot = Object.fromEntries(
          pbis.map((p) => [p.number, f.values[p.number]]),
        );
        return new Promise((resolve, reject) =>
          f.reads.push({ pbis, snapshot, resolve, reject, done: false }),
        ).finally(() => f.active--);
      },
      saveIssue: async ({ id, patch }: any) => {
        if (
          Object.keys(patch).length !== 1 ||
          !Object.hasOwn(patch, "storyPoints")
        )
          throw Error("fixture only permits synthetic point ACK");
        f.writes.push({ id, patch: structuredClone(patch) });
        const lane = f.board.lanes.find((lane: any) => lane.id === id);
        f.values[lane.number] = patch.storyPoints;
        lane.revision = `synthetic-ack-${f.writes.length}`;
        return { ...structuredClone(lane), storyPoints: patch.storyPoints };
      },
    });
  }, board);
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await expect(page.locator("#fit-mode-trigger")).toBeAttached();
  if (!bundled)
    await expect.poll(async () => (await counts(page)).reads).toBe(1);
  return fixture;
}
async function readyAll(page: Page) {
  await settle(page, 0);
  await expect(badges(page)).toHaveCount(6);
  await chooseRows(page, "all");
  await expect(page.locator(".pbi-title")).toHaveCount(12);
  await expect.poll(async () => (await counts(page)).reads).toBe(3);
  await settle(page, 1);
  await settle(page, 2);
  await expect(badges(page)).toHaveCount(12);
}

test("All12のlegacy SPは6件ずつ、page変更後の古い要求を含め同source並列2以内", async ({
  page,
}) => {
  const f = await prepare(page);
  await settle(page, 0);
  await chooseRows(page, "all");
  await expect.poll(async () => (await counts(page)).reads).toBe(3);
  await chooseRows(page, 1);
  expect((await counts(page)).reads).toBe(3);
  await settle(page, 1);
  await expect.poll(async () => (await counts(page)).reads).toBe(4);
  await settle(page, 2);
  await settle(page, 3);
  await expect(page.locator(".pbi-title")).toHaveCount(1);
  await expect(badges(page)).toHaveText(["1"]);
  expect(await counts(page)).toEqual({
    reads: 4,
    writes: 0,
    maximum: 2,
    sizes: [6, 6, 6, 1],
  });
  expect(f.posts()).toBe(0);
});

test("All12の一部成功は未完了中に混ぜず、他chunkの503終端で既知値を消す", async ({
  page,
}) => {
  const f = await prepare(page);
  await readyAll(page);
  const before = await badges(page).allTextContents();
  await refresh(page);
  await expect.poll(async () => (await counts(page)).reads).toBe(5);
  await settle(page, 3, valueMap(99));
  await expect(badges(page)).toHaveText(before);
  await settle(page, 4, undefined, "github_unavailable");
  await expect(badges(page)).toHaveCount(0);
  expect((await counts(page)).reads).toBe(5);
  expect((await counts(page)).writes).toBe(0);
  expect(f.posts()).toBe(0);
});

for (const replace of [false, true])
  test(`Allの遅いscope403は${replace ? "別sourceを消去しない" : "page変更後も同sourceを即消去"}`, async ({
    page,
  }) => {
    const f = await prepare(page);
    await settle(page, 0);
    await chooseRows(page, "all");
    await expect.poll(async () => (await counts(page)).reads).toBe(3);
    await chooseRows(page, 1);
    if (replace)
      await page.evaluate(async () => {
        const w = window as any,
          board = structuredClone(w.__managedPoints.board);
        board.lanes[0].title = "新しい接続のPBI";
        board.storyPoints = {
          values: Object.fromEntries(
            board.lanes.map((lane: any) => [lane.number, 8]),
          ),
        };
        await w.Whiteboard.setAdapter({
          load: async () => structuredClone(board),
          saveIssue: async () => {
            throw Error("new source forbids writes");
          },
          loadStoryPoints: async () => {
            throw Error("bundled source must not read");
          },
        });
        await Promise.resolve();
      });
    await settle(page, 1, undefined, "scope_not_public");
    if (replace) {
      await expect(page.locator(".pbi-title")).toHaveCount(1);
      await expect(page.locator(".pbi-title")).toHaveText("新しい接続のPBI");
      await expect(badges(page)).toHaveText(["8"]);
    } else {
      await expect(page.locator(".pbi-title, .task")).toHaveCount(0);
      await expect(page.locator("#details")).not.toBeVisible();
      await expect(badges(page)).toHaveCount(0);
    }
    await settle(page, 2);
    if (replace) await expect(badges(page)).toHaveText(["8"]);
    else await expect(page.locator(".pbi-title, .task")).toHaveCount(0);
    expect((await counts(page)).reads).toBe(3);
    expect((await counts(page)).writes).toBe(0);
    expect(f.posts()).toBe(0);
  });

test("All12のempty field projectionは別chunk未完了でも即消去し遅い値で復活しない", async ({
  page,
}) => {
  const f = await prepare(page);
  await readyAll(page);
  await refresh(page);
  await expect.poll(async () => (await counts(page)).reads).toBe(5);
  await settle(page, 3, {});
  await expect(badges(page)).toHaveCount(0);
  await settle(page, 4, valueMap(13));
  await expect(badges(page)).toHaveCount(0);
  expect((await counts(page)).reads).toBe(5);
  expect((await counts(page)).writes).toBe(0);
  expect(f.posts()).toBe(0);
});

test("All12の遅いGETはnative選択のcanonical ACKを戻さず別PBIの更新を保つ", async ({
  page,
}) => {
  const f = await prepare(page);
  await readyAll(page);
  await refresh(page);
  await expect.poll(async () => (await counts(page)).reads).toBe(5);
  await page.locator('.pbi-title[data-pbi="p0"]').click();
  await expect(page.locator("#story-point-editor")).toBeVisible();
  await page
    .locator("#story-point-choices")
    .getByRole("button", { name: "13", exact: true })
    .click();
  await expect.poll(async () => (await counts(page)).writes).toBe(1);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  await settle(page, 3, { 1: 1, 2: 8, 3: 3, 4: 4, 5: 5, 6: 6 });
  await settle(page, 4);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText(
    "13",
  );
  await expect(page.locator('#board [data-story-points="p1"]')).toHaveText("8");
  await expect(
    page.locator('#story-point-choices button[aria-pressed="true"]'),
  ).toHaveText("13");
  expect((await counts(page)).reads).toBe(5);
  expect((await counts(page)).writes).toBe(1);
  expect(f.posts()).toBe(0);
});

test("同梱SPはAll12でも追加GETゼロ、0/nullを区別し背景更新を反映", async ({
  page,
}) => {
  const f = await prepare(page, true);
  await chooseRows(page, "all");
  await expect(page.locator(".pbi-title")).toHaveCount(12);
  await expect(badges(page)).toHaveCount(11);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText("0");
  await expect(page.locator('#board [data-story-points="p1"]')).toBeHidden();
  await page.evaluate(
    () => ((window as any).__managedPoints.board.storyPoints.values[1] = 8),
  );
  await refresh(page);
  await expect(page.locator('#board [data-story-points="p0"]')).toHaveText("8");
  expect(await counts(page)).toEqual({
    reads: 0,
    writes: 0,
    maximum: 0,
    sizes: [],
  });
  expect(f.posts()).toBe(0);
});
