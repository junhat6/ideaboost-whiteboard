import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
const firstCell = '[data-lane="p0"][data-status="ToDo"]';

test("continued sticky returns to the same position across detail, poll and resize", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const cell = page.locator(firstCell);
  await cell.locator('[data-cell-step="1"]').click();
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  const last = cell.locator('[data-open="t0-0-4"]');
  const before = await last.boundingBox();
  await last.click();
  await expect(page.locator("#details")).toBeVisible();
  s.board.tasks.find((t) => t.id === "t0-0-4")!.title = "同期しても位置を維持";
  await page.clock.fastForward(46000);
  await expect(page.locator("#detail-heading")).toHaveText(
    "同期しても位置を維持",
  );
  await page.locator("#close-detail").click();
  await page.clock.fastForward(200);
  await expect(last).toBeFocused();
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  expect((await last.boundingBox())!.y).toBeCloseTo(before!.y, 0);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 40 });
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  await cell.locator(".cell-viewport").focus();
  await page.keyboard.press("PageUp");
  await expect(cell.locator(".cell-range")).toHaveText("1–4 / 5");
  await page.keyboard.press("PageDown");
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  await expect(last).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#details")).toBeVisible();
  expect(s.posts()).toBe(0);
});

test("native wheel continues cards, fifth card can drag to Doing, same-column is a no-op", async ({
  page,
}) => {
  const s = await setup(page);
  const cell = page.locator(firstCell);
  const box = await cell.locator(".cell-viewport").boundingBox();
  await page.mouse.move(box!.x + box!.width - 4, box!.y + box!.height / 2);
  await page.mouse.wheel(0, 500);
  await expect(cell.locator(".cell-range")).toHaveText("5–5 / 5");
  await cell
    .locator('[data-task="t0-0-4"]')
    .dragTo(page.locator('[data-lane="p0"][data-status="Doing"]'));
  await expect(
    page.locator('[data-lane="p0"][data-status="Doing"] [data-task="t0-0-4"]'),
  ).toHaveCount(1);
  expect(s.posts()).toBe(1);
  expect(s.board.tasks.find((t) => t.id === "t0-0-4")!.status).toBe("作業中");
  await page.locator('[data-task="t0-0-0"]').dragTo(cell);
  expect(s.posts()).toBe(1);
  await page
    .locator('[data-task="t0-0-0"]')
    .dragTo(page.locator('[data-lane="p1"][data-status="Doing"]'));
  expect(s.posts()).toBe(1);
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#details")).toBeVisible();
  await page.locator("#close-detail").click();
  await expect(page.locator('[data-open="t0-0-0"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#details")).toBeVisible();
});

test("PBI assignees are canonical and independent from task assignees", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page, { longPbi: true });
  s.board.lanes[0].assignees = [
    {
      login: "pbi-owner",
      name: "PBI専任担当者",
      avatarUrl: "https://avatars.githubusercontent.com/u/2",
    },
  ];
  await page.clock.fastForward(46000);
  const pbi = page.locator('[data-pbi-row="p0"]');
  await expect(pbi.locator(".pbi-assignees")).toContainText("PBI専任担当者");
  await expect(
    page.locator(firstCell).locator(".person").first(),
  ).toContainText("検証担当者");
  const layout = await pbi.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return [
      ...el.querySelectorAll(".pbi-title,.pbi-assignees,.lane-progress"),
    ].every((n) => {
      const r = n.getBoundingClientRect();
      return r.top >= b.top && r.bottom <= b.bottom;
    });
  });
  expect(layout).toBe(true);
  await pbi.locator(".pbi-assignees").click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#assignee-tiles")).toContainText("PBI専任担当者");
  expect(s.posts()).toBe(0);
});

test("0/1/4/5/9/20 cards keep four complete first notes and stable anchors after insert/remove/filter", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const template = s.board.tasks[0];
  const replace = (count: number) => {
    s.board.tasks = s.board.tasks.filter(
      (t) => t.lane !== "p0" || t.status !== "未整理",
    );
    s.board.tasks.unshift(
      ...Array.from({ length: count }, (_, i) => ({
        ...template,
        id: `extra${i}`,
        nodeId: `extra${i}`,
        number: 2000 + i,
        title: `続きの付箋 ${i + 1}`,
      })),
    );
  };
  const cell = page.locator(firstCell);
  for (const count of [0, 1, 4, 5, 9, 20]) {
    replace(count);
    await page.clock.fastForward(46000);
    await expect(cell.locator(".task")).toHaveCount(count);
    if (count > 4) {
      await cell.locator(".cell-viewport").focus();
      await page.keyboard.press("Home");
    }
    const fits = await cell.evaluate((el) => {
      const b = (
        el.querySelector(".cell-viewport") || el
      ).getBoundingClientRect();
      return [...el.querySelectorAll(".task")].slice(0, 4).every((n) => {
        const r = n.getBoundingClientRect();
        return r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
      });
    });
    expect(fits).toBe(true);
  }
  await cell.locator('[data-cell-step="1"]').click();
  await cell.locator('[data-cell-step="1"]').click();
  await expect(cell.locator(".cell-range")).toHaveText("9–12 / 20");
  s.board.tasks.unshift({
    ...template,
    id: "inserted",
    nodeId: "inserted",
    number: 3000,
  });
  s.board.tasks = s.board.tasks.filter((t) => t.id !== "extra8");
  await page.clock.fastForward(46000);
  await expect(cell.locator(".cell-range")).toHaveText("9–12 / 20");
  await page.locator("#operations").click();
  await page.locator("#search").fill("続きの付箋 20");
  await expect(cell.locator(".task")).toHaveCount(1);
  await page.locator("#search").fill("");
  await expect(cell.locator(".cell-range")).toHaveText("9–12 / 20");
  expect(s.posts()).toBe(0);
  await page.screenshot({
    path: `test-results/overflow-${page.viewportSize()!.width}.png`,
  });
});

test("PBI multiple, unassigned and failed-avatar fallbacks remain compact", async ({
  page,
}) => {
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.abort(),
  );
  await page.clock.install();
  const s = await setup(page);
  s.board.lanes[0].assignees = Array.from({ length: 4 }, (_, i) => ({
    login: `outside${i}`,
    name: `候補外の長い担当者名${i}`.repeat(3),
    avatarUrl: `https://avatars.githubusercontent.com/u/${i + 30}`,
  }));
  s.board.lanes[1].assignees = [];
  await page.clock.fastForward(46000);
  const people = page.locator('[data-pbi-row="p0"] .pbi-assignees');
  await expect(people.locator(".avatar-count")).toHaveText("+2");
  await expect(people.locator("img")).toHaveCount(0);
  await expect(
    page.locator('[data-pbi-row="p1"] .pbi-assignees'),
  ).toContainText("未割り当て");
  expect(
    await people.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(s.posts()).toBe(0);
});

test("drag edge scroll cancels on blur without posting or blocking later detail", async ({
  page,
}) => {
  const s = await setup(page);
  const cell = page.locator(firstCell),
    port = cell.locator(".cell-viewport");
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await cell
    .locator('[data-task="t0-0-0"]')
    .dispatchEvent("dragstart", { dataTransfer: dt });
  const box = await port.boundingBox();
  await port.dispatchEvent("dragover", {
    dataTransfer: dt,
    clientY: box!.y + box!.height - 3,
  });
  await expect
    .poll(() => port.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const stopped = await port.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(80);
  expect(await port.evaluate((el) => el.scrollTop)).toBe(stopped);
  await port.focus();
  await page.keyboard.press("Home");
  await cell.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#details")).toBeVisible();
  expect(s.posts()).toBe(0);
});

test("mid-cell visible anchor survives pure insertion and deletion before it", async ({
  page,
}) => {
  await page.clock.install();
  const s = await setup(page);
  const base = s.board.tasks[0];
  s.board.tasks = s.board.tasks.filter(
    (t) => t.lane !== "p0" || t.status !== "未整理",
  );
  s.board.tasks.unshift(
    ...Array.from({ length: 20 }, (_, i) => ({
      ...base,
      id: `anchor${i}`,
      nodeId: `anchor${i}`,
      number: 4000 + i,
      title: `位置確認 ${i}`,
    })),
  );
  await page.clock.fastForward(46000);
  const port = page.locator(firstCell).locator(".cell-viewport");
  await expect(page.locator(firstCell).locator(".task")).toHaveCount(20);
  await port.evaluate((el) => {
    el.scrollTop = el.clientHeight * 1.5 + 7;
  });
  const anchor = await port.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const card = [...el.querySelectorAll<HTMLElement>("[data-task]")].find(
      (n) => n.getBoundingClientRect().bottom > top + 1,
    )!;
    return {
      id: card.dataset.task!,
      offset: card.getBoundingClientRect().top - top,
    };
  });
  const offset = () =>
    port.evaluate(
      (el, id) =>
        el.querySelector(`[data-task="${id}"]`)!.getBoundingClientRect().top -
        el.getBoundingClientRect().top,
      anchor.id,
    );
  s.board.tasks.unshift(
    ...Array.from({ length: 2 }, (_, i) => ({
      ...base,
      id: `insert${i}`,
      nodeId: `insert${i}`,
      number: 5000 + i,
    })),
  );
  await page.clock.fastForward(46000);
  await expect(page.locator(firstCell).locator(".task")).toHaveCount(22);
  await expect.poll(offset).toBeCloseTo(anchor.offset, 0);
  s.board.tasks = s.board.tasks.filter(
    (t) => !["anchor0", "anchor1"].includes(t.id),
  );
  await page.clock.fastForward(46000);
  await expect(page.locator(firstCell).locator(".task")).toHaveCount(20);
  await expect.poll(offset).toBeCloseTo(anchor.offset, 0);
  const oldHeight = await port.evaluate((el) => el.clientHeight);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height + 80 });
  await expect
    .poll(async () => {
      const h = await port.evaluate((el) => el.clientHeight);
      return Math.abs((await offset()) - (anchor.offset * h) / oldHeight);
    })
    .toBeLessThan(1.5);
  const beforeOpen = await offset();
  const bounds = await port.boundingBox();
  const card = await port.locator(`[data-task="${anchor.id}"]`).boundingBox();
  await page.mouse.click(card!.x + 20, bounds!.y + 10);
  await expect(page.locator("#details")).toBeVisible();
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  expect(await offset()).toBeCloseTo(beforeOpen, 0);
  expect(s.posts()).toBe(0);
});
