import { test, expect, type Page, type Locator } from "@playwright/test";
import { setup } from "./fixtures";

const card = (page: Page, id: string) => page.locator(`[data-task="${id}"]`);
const cell = (page: Page, status: string, lane = "p0") =>
  page.locator(`[data-lane="${lane}"][data-status="${status}"]`);

async function beginDrag(page: Page, source: Locator) {
  await expect(source).toHaveAttribute("draggable", "true");
  await source.scrollIntoViewIfNeeded();
  const box = (await source.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  // Real pointer movement crosses the native HTML drag threshold. No DragEvent
  // dispatch, DataTransfer injection, force option or application-state mutation.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 8, y + 3, { steps: 4 });
  await page.mouse.move(x + 18, y + 6, { steps: 4 });
  await expect(source).toHaveClass(/dragging/);
}

async function pointAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  });
  // Native browsers can require a second mousemove to deliver dragover.
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2, {
    steps: 2,
  });
}

async function cleanGesture(page: Page) {
  await expect(page.locator(".dragging,.drag-over")).toHaveCount(0);
  await expect(page.locator("#details")).not.toBeVisible();
}

async function move(page: Page, id: string, status: string) {
  await card(page, id).dragTo(cell(page, status));
  await expect(cell(page, status).locator(`[data-task="${id}"]`)).toHaveCount(
    1,
  );
  await cleanGesture(page);
}

async function overflowFixture(page: Page, count = 12) {
  const f = await setup(page),
    template = f.board.tasks[0];
  f.board.tasks = f.board.tasks.filter(
    (task) => task.lane !== "p0" || task.status !== "未整理",
  );
  f.board.tasks.unshift(
    ...Array.from({ length: count }, (_, index) => ({
      ...template,
      id: `continued-${index}`,
      nodeId: `continued-${index}`,
      number: 3000 + index,
      title: `続きの付箋 ${index + 1}`,
    })),
  );
  await page.reload();
  await expect(cell(page, "ToDo").locator(".task")).toHaveCount(count);
  return f;
}

for (const cancellation of ["outside", "Escape"] as const)
  test(`native dragを${cancellation}で取り消した後も次の別付箋と元付箋を移動できる`, async ({
    page,
  }) => {
    const f = await setup(page);
    try {
      await beginDrag(page, card(page, "t0-0-0"));
      if (cancellation === "Escape") {
        await pointAt(page, cell(page, "Doing"));
        await expect(cell(page, "Doing")).toHaveClass(/drag-over/);
        await page.keyboard.press("Escape");
      } else {
        // The outer canvas margin is outside every Status drop target.
        await page.mouse.move(2, page.viewportSize()!.height - 2, {
          steps: 10,
        });
      }
      await page.mouse.up();
      await cleanGesture(page);
      expect(f.posts()).toBe(0);
      await expect(
        cell(page, "ToDo").locator('[data-task="t0-0-0"]'),
      ).toHaveCount(1);
      await move(page, "t0-0-1", "Doing");
      await expect.poll(f.posts).toBe(1);
      await move(page, "t0-0-0", "Wait");
      await expect.poll(f.posts).toBe(2);
      expect(f.board.tasks.find((task) => task.id === "t0-0-1")!.status).toBe(
        "作業中",
      );
      expect(f.board.tasks.find((task) => task.id === "t0-0-0")!.status).toBe(
        "レビュー中",
      );
    } finally {
      await page.mouse.up();
    }
  });

test("同列と別PBIへのnative dropは書込せず、続く同PBIの別付箋dragを阻害しない", async ({
  page,
}) => {
  const f = await setup(page);
  f.board.tasks.find((task) => task.id === "t0-1-0")!.status = "壁打ち中";
  await page.reload();
  await card(page, "t0-1-0").dragTo(cell(page, "Doing"));
  await cleanGesture(page);
  expect(f.posts()).toBe(0);
  expect(f.board.tasks.find((task) => task.id === "t0-1-0")!.status).toBe(
    "壁打ち中",
  );
  await card(page, "t0-0-0").dragTo(cell(page, "Doing", "p1"));
  await cleanGesture(page);
  expect(f.posts()).toBe(0);
  await expect(cell(page, "ToDo").locator('[data-task="t0-0-0"]')).toHaveCount(
    1,
  );
  await move(page, "t0-0-1", "Wait");
  await expect.poll(f.posts).toBe(1);
  await move(page, "t0-0-0", "Doing");
  await expect.poll(f.posts).toBe(2);
});

for (const navigation of ["page-button", "wheel"] as const)
  test(`2×2とoverflowの${navigation}操作後も続きの付箋と別セルの付箋をdragできる`, async ({
    page,
  }) => {
    const f = await overflowFixture(page),
      todo = cell(page, "ToDo"),
      port = todo.locator(".cell-viewport");
    await expect(todo.locator(".cell-range")).toHaveText("1–4 / 12");
    const geometry = await port.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll(".task")]
        .slice(0, 4)
        .map((task) => task.getBoundingClientRect());
      return {
        contained: boxes.every(
          (box) => box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1,
        ),
        columns: boxes[0].left < boxes[1].left,
        rows: boxes[0].top < boxes[2].top,
      };
    });
    expect(geometry).toEqual({ contained: true, columns: true, rows: true });
    let id: string;
    if (navigation === "page-button") {
      await todo.locator('[data-cell-step="1"]').click();
      await expect(todo.locator(".cell-range")).toHaveText("5–8 / 12");
      id = "continued-4";
    } else {
      const left = (await card(page, "continued-0").boundingBox())!,
        right = (await card(page, "continued-1").boundingBox())!;
      const gutter = {
        x: (left.x + left.width + right.x) / 2,
        y: left.y + left.height / 2,
      };
      expect(
        await page.evaluate(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          return (
            !!target?.closest(".cell-viewport") && !target.closest(".task")
          );
        }, gutter),
      ).toBe(true);
      await page.mouse.move(gutter.x, gutter.y);
      await page.mouse.wheel(0, 10000);
      await expect(todo.locator(".cell-range")).toHaveText("9–12 / 12");
      id = "continued-8";
    }
    await move(page, id, "Doing");
    await expect.poll(f.posts).toBe(1);
    await move(page, "t0-2-0", "Doing");
    await expect.poll(f.posts).toBe(2);
    expect(f.board.tasks.find((task) => task.id === id)!.status).toBe("作業中");
    expect(f.board.tasks.find((task) => task.id === "t0-2-0")!.status).toBe(
      "作業中",
    );
  });

test("保存後の再取得と明示refresh再描画の後も別付箋を連続dragできる", async ({
  page,
}) => {
  const f = await setup(page);
  await move(page, "t0-0-0", "Doing");
  await expect.poll(f.posts).toBe(1);
  f.board.tasks.find((task) => task.id === "t0-0-1")!.title =
    "再描画で更新された付箋";
  await page.locator("#operations").click();
  await page.locator("#refresh").click();
  await expect(card(page, "t0-0-1")).toContainText("再描画で更新された付箋");
  await page.locator("#operations").click();
  await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
  await move(page, "t0-0-1", "Wait");
  await expect.poll(f.posts).toBe(2);
  await move(page, "t0-0-2", "Doing");
  await expect.poll(f.posts).toBe(3);
});

test("開いたままの操作バーはnative drag開始で閉じ、次の付箋も正常に移動できる", async ({
  page,
}) => {
  const f = await setup(page);
  await page.locator("#operations").click();
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  try {
    await beginDrag(page, card(page, "t0-0-0"));
    await expect(page.locator("#chrome")).not.toHaveClass(/controls-open/);
    await pointAt(page, cell(page, "Doing"));
    await page.mouse.up();
    await expect.poll(f.posts).toBe(1);
    await expect(
      cell(page, "Doing").locator('[data-task="t0-0-0"]'),
    ).toHaveCount(1);
    await cleanGesture(page);
    await move(page, "t0-0-1", "Wait");
    await expect.poll(f.posts).toBe(2);
  } finally {
    await page.mouse.up();
  }
});

test("native drag端auto-scrollはdragendで途中停止し、次の別付箋dragを妨げない", async ({
  page,
}) => {
  const f = await overflowFixture(page, 20),
    port = cell(page, "ToDo").locator(".cell-viewport");
  await port.evaluate((element) => {
    const trace = { writes: [] as object[], events: [] as object[] };
    (window as any).__dragScrollTrace = trace;
    const descriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    )!;
    Object.defineProperty(element, "scrollTop", {
      configurable: true,
      get() {
        return descriptor.get!.call(this);
      },
      set(value) {
        trace.writes.push({
          at: performance.now(),
          value,
          dragging: !!document.querySelector(".dragging"),
          caller: new Error().stack?.split("\n").slice(1, 4),
        });
        descriptor.set!.call(this, value);
      },
    });
    for (const type of ["dragend", "drop", "blur", "scroll", "scrollend"])
      window.addEventListener(
        type,
        () =>
          trace.events.push({
            type,
            at: performance.now(),
            top: element.scrollTop,
            connected: element.isConnected,
          }),
        true,
      );
  });
  try {
    await beginDrag(page, card(page, "t0-1-0"));
    const box = (await port.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3, {
      steps: 8,
    });
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height - 3, {
      steps: 2,
    });
    await expect
      .poll(() => port.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(
      await port.evaluate(
        (element) =>
          element.scrollTop < element.scrollHeight - element.clientHeight,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await cleanGesture(page);
    expect(f.posts()).toBe(0);
    const positions = await port.evaluate(
      (element) =>
        new Promise<number[]>((resolve) => {
          const samples = [element.scrollTop];
          const sample = () => {
            samples.push(element.scrollTop);
            if (samples.length === 7) resolve(samples);
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    console.log(
      JSON.stringify({
        metric: "native-scroll-cancellation",
        width: page.viewportSize()!.width,
        positions,
        trace: await page.evaluate(() => (window as any).__dragScrollTrace),
      }),
    );
    expect(new Set(positions).size).toBe(1);
    await move(page, "t0-1-1", "Wait");
    await expect.poll(f.posts).toBe(1);
    await expect(
      cell(page, "Doing").locator('[data-task="t0-1-0"]'),
    ).toHaveCount(1);
  } finally {
    await page.mouse.up();
  }
});
