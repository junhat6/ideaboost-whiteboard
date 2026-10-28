import { test, expect, type Page, type Locator } from "@playwright/test";
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { setup } from "./fixtures";

// Already shipped/exported by the installed Playwright package; no new PNG dependency.
const { PNG } = createRequire(import.meta.url)(
  "playwright-core/lib/utilsBundle",
);
const card = (page: Page, id = "t0-0-0") => page.locator(`[data-task="${id}"]`);
const toggle = (page: Page) => page.locator("#highlight-unestimated");
const orbit = "unestimated-orbit";

async function ready(page: Page, allEligible = false) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="12" fill="#3159c9"/><circle cx="12" cy="9" r="4" fill="white"/></svg>',
    }),
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  const f = await setup(page);
  await page.route(/\/api\/burndown(?:\?.*)?$/, (route) =>
    route.fulfill({ status: 404, json: { error: "sprint_unavailable" } }),
  );
  (f.board.scope as any).estimateHoursField = true;
  for (const task of f.board.tasks)
    Object.assign(task, {
      estimateHours: null,
      subIssueCount: 0,
      parentId: task.lane,
    });
  if (!allEligible) {
    (f.board.tasks[1] as any).estimateHours = 0;
    delete (f.board.tasks[2] as any).estimateHours;
  }
  f.board.tasks[5].type = "競合調査";
  f.board.tasks[9].type = "Bug";
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect
    .poll(() =>
      page
        .locator("#board .person img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  return { ...f, requests };
}
async function theme(page: Page, value: string) {
  if (value === "dark") {
    await page.locator("#operations").click();
    await page.locator("#theme").click();
    await page.locator("#operations").click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
  await page.mouse.move(2, page.viewportSize()!.height - 2);
}
async function enable(page: Page) {
  await page.locator("#operations").focus();
  await page.keyboard.press("u");
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(2, page.viewportSize()!.height - 2);
  await expect(card(page)).toHaveClass(/unestimated-visible/);
}
async function twoFrames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function motion(target: Locator) {
  return target.evaluate((element) => {
    const span = element.querySelector(".unestimated-motion")!,
      style = getComputedStyle(span, "::after"),
      animation = element
        .getAnimations({ subtree: true })
        .find(
          (value) =>
            (value as CSSAnimation).animationName === "unestimated-orbit",
        );
    return {
      name: style.animationName,
      playState: style.animationPlayState,
      offsetDistance: style.offsetDistance,
      currentTime:
        animation && typeof animation.currentTime === "number"
          ? animation.currentTime
          : null,
      opacity: style.opacity,
      outline: getComputedStyle(element).outlineWidth,
    };
  });
}
async function geometry(page: Page) {
  return page.locator("#board [data-task]").evaluateAll((elements) =>
    elements.map((element) => ({
      id: (element as HTMLElement).dataset.task,
      card: element.getBoundingClientRect().toJSON(),
      title: element
        .querySelector(".task-title")!
        .getBoundingClientRect()
        .toJSON(),
      titleText: element.querySelector(".task-title")!.textContent,
      avatar: element
        .querySelector(".person")!
        .getBoundingClientRect()
        .toJSON(),
      hours: element
        .querySelector(".task-estimate")!
        .getBoundingClientRect()
        .toJSON(),
      hoursLabel: element
        .querySelector(".task-estimate")!
        .getAttribute("aria-label"),
      fill: getComputedStyle(element).backgroundColor,
    })),
  );
}
function diffPng(first: Buffer, second: Buffer) {
  const a = PNG.sync.read(first),
    b = PNG.sync.read(second);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  const output = new PNG({ width: a.width, height: a.height });
  let boundary = 0,
    center = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const offset = (y * a.width + x) * 4,
        changed = [0, 1, 2, 3].some(
          (channel) => a.data[offset + channel] !== b.data[offset + channel],
        );
      if (changed) {
        if (x < 6 || y < 6 || x >= a.width - 6 || y >= a.height - 6) boundary++;
        else center++;
      }
      output.data[offset] = changed ? 220 : 245;
      output.data[offset + 1] = changed ? 35 : 245;
      output.data[offset + 2] = changed ? 70 : 245;
      output.data[offset + 3] = 255;
    }
  return {
    boundary,
    center,
    total: boundary + center,
    image: PNG.sync.write(output) as Buffer,
  };
}
function paperPixels(
  first: Buffer,
  second: Buffer,
  fill: number[],
  estimate: { left: number; top: number; right: number; bottom: number },
) {
  const a = PNG.sync.read(first),
    b = PNG.sync.read(second);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let checked = 0,
    changed = 0;
  for (let y = 6; y < a.height - 6; y++)
    for (let x = 6; x < a.width - 6; x++) {
      // U changes the three-character unset label, not the paper behind the title.
      if (
        x >= estimate.left - 2 &&
        x <= estimate.right + 2 &&
        y >= estimate.top - 2 &&
        y <= estimate.bottom + 2
      )
        continue;
      const offset = (y * a.width + x) * 4;
      if (
        fill.every((value, channel) => a.data[offset + channel] === value) &&
        a.data[offset + 3] === 255
      ) {
        checked++;
        if (
          fill.some((value, channel) => b.data[offset + channel] !== value) ||
          b.data[offset + 3] !== 255
        )
          changed++;
      }
    }
  return { checked, changed };
}
async function frame(target: Locator, path: string) {
  // Never disable animation or seek currentTime: these pixels reflect real elapsed time.
  return target.screenshot({ path, animations: "allow", scale: "css" });
}

for (const appearance of ["light", "dark"])
  test(`${appearance}の6PBI・2×2で紙面geometryを変えず境界の光が実時間で移動する`, async ({
    page,
  }) => {
    const f = await ready(page);
    await theme(page, appearance);
    const stem = `test-results/unestimated-motion-${page.viewportSize()!.width}-${appearance}`,
      before = await geometry(page),
      requests = f.requests.length;
    const offFrame = await frame(card(page), `${stem}-off.png`);
    const port = card(page).locator(
      "xpath=ancestor::*[contains(@class,'cell-viewport')]",
    );
    expect(
      await port.locator(".cell-page").first().locator(".task").count(),
    ).toBe(4);
    await enable(page);
    expect(await geometry(page)).toEqual(before);
    await expect(card(page, "t0-0-1")).not.toHaveClass(/unestimated-highlight/);
    await expect(card(page, "t0-0-1").locator(".task-estimate")).toContainText(
      "0h",
    );
    await expect(card(page, "t0-0-2")).not.toHaveClass(/unestimated-highlight/);
    await expect(card(page).locator(".unestimated-cue")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(card(page)).toHaveCSS("outline-width", "1px");
    await expect(card(page).locator(".unestimated-motion")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect
      .poll(async () => (await motion(card(page))).playState)
      .toBe("running");
    await twoFrames(page);
    const start = await motion(card(page));
    expect(start.name).toBe(orbit);
    expect(start.currentTime).not.toBeNull();
    const a = await frame(card(page), `${stem}-frame-0.png`);
    const original = before.find((value) => value.id === "t0-0-0")!,
      fill = original.fill.match(/\d+/g)!.slice(0, 3).map(Number),
      paper = paperPixels(offFrame, a, fill, {
        left: original.hours.left - original.card.left,
        right: original.hours.right - original.card.left,
        top: original.hours.top - original.card.top,
        bottom: original.hours.bottom - original.card.top,
      });
    expect(paper.checked).toBeGreaterThan(0);
    expect(paper.changed).toBe(0);
    await page.waitForTimeout(300); // Real wall-clock progression, not Playwright clock.
    const middle = await motion(card(page)),
      b = await frame(card(page), `${stem}-frame-1.png`);
    await page.waitForTimeout(450);
    const end = await motion(card(page)),
      c = await frame(card(page), `${stem}-frame-2.png`);
    expect(middle.currentTime!).toBeGreaterThan(start.currentTime!);
    expect(end.currentTime!).toBeGreaterThan(middle.currentTime!);
    expect(middle.offsetDistance).not.toBe(start.offsetDistance);
    expect(end.offsetDistance).not.toBe(middle.offsetDistance);
    expect(new Set([start.opacity, middle.opacity, end.opacity]).size).toBe(1);
    const firstDiff = diffPng(a, b),
      secondDiff = diffPng(b, c);
    expect(firstDiff.boundary).toBeGreaterThan(0);
    expect(secondDiff.boundary).toBeGreaterThan(0);
    expect(firstDiff.center).toBe(0);
    expect(secondDiff.center).toBe(0);
    await writeFile(`${stem}-diff.png`, firstDiff.image);
    const performance = await page.evaluate(
      () =>
        new Promise<{
          durations: number[];
          activeAnimations: number;
          visibleCards: number;
        }>((resolve) => {
          const stamps: number[] = [];
          const sample = (time: number) => {
            stamps.push(time);
            if (stamps.length < 61) return requestAnimationFrame(sample);
            resolve({
              durations: stamps
                .slice(1)
                .map((stamp, index) => stamp - stamps[index]),
              activeAnimations: document
                .getAnimations()
                .filter(
                  (animation) =>
                    (animation as CSSAnimation).animationName ===
                      "unestimated-orbit" && animation.playState === "running",
                ).length,
              visibleCards: document.querySelectorAll(
                ".unestimated-highlight.unestimated-visible",
              ).length,
            });
          };
          requestAnimationFrame(sample);
        }),
    );
    expect(performance.durations).toHaveLength(60);
    expect(
      performance.durations.every(
        (duration) => Number.isFinite(duration) && duration > 0,
      ),
    ).toBe(true);
    expect(performance.activeAnimations).toBeGreaterThan(0);
    expect(performance.activeAnimations).toBeLessThanOrEqual(
      performance.visibleCards,
    );
    const sorted = [...performance.durations].sort((a, b) => a - b),
      metrics = {
        viewport: page.viewportSize(),
        appearance,
        frames: [start, middle, end],
        pixelDiff: [firstDiff, secondDiff].map(
          ({ boundary, center, total }) => ({ boundary, center, total }),
        ),
        frameTimeProxy: {
          ...performance,
          p95: sorted[Math.floor(sorted.length * 0.95)],
          max: sorted.at(-1),
        },
        geometryUnchanged: true,
        paperPixels: paper,
      };
    await writeFile(`${stem}-metrics.json`, JSON.stringify(metrics, null, 2));
    console.log(
      JSON.stringify({
        metric: "unestimated-motion-frame-time-proxy",
        ...metrics,
      }),
    );
    await page.screenshot({
      path: `${stem}-board.png`,
      animations: "allow",
      scale: "css",
    });
    expect(f.requests).toHaveLength(requests);
    expect(f.posts()).toBe(0);
  });

test("overflowで見えない光はpausedとなり、再入場時だけ実時間の移動を再開する", async ({
  page,
}) => {
  const f = await ready(page, true),
    requests = f.requests.length;
  await enable(page);
  const first = card(page),
    fifth = card(page, "t0-0-4"),
    port = first.locator("xpath=ancestor::*[contains(@class,'cell-viewport')]");
  await expect(fifth).not.toHaveClass(/unestimated-visible/);
  await expect.poll(async () => (await motion(fifth)).playState).toBe("paused");
  await twoFrames(page);
  const hidden = await motion(fifth);
  await page.waitForTimeout(250);
  expect(await motion(fifth)).toEqual(hidden);
  await port.focus();
  await page.keyboard.press("PageDown");
  await expect(fifth).toHaveClass(/unestimated-visible/);
  await expect(first).not.toHaveClass(/unestimated-visible/);
  await expect.poll(async () => (await motion(first)).playState).toBe("paused");
  await twoFrames(page);
  const paused = await motion(first),
    running = await motion(fifth);
  await page.waitForTimeout(250);
  expect(await motion(first)).toEqual(paused);
  expect((await motion(fifth)).currentTime!).toBeGreaterThan(
    running.currentTime!,
  );
  await page.keyboard.press("PageUp");
  await expect(first).toHaveClass(/unestimated-visible/);
  await expect
    .poll(async () => (await motion(first)).playState)
    .toBe("running");
  expect(f.requests).toHaveLength(requests);
  expect(f.posts()).toBe(0);
});

test("native drag中は細いcueだけ残し光をpause、取消後は再開する", async ({
  page,
}) => {
  const f = await ready(page),
    requests = f.requests.length;
  await enable(page);
  const target = card(page),
    box = (await target.boundingBox())!;
  try {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 8,
      box.y + box.height / 2 + 3,
      { steps: 4 },
    );
    await page.mouse.move(
      box.x + box.width / 2 + 18,
      box.y + box.height / 2 + 6,
      { steps: 4 },
    );
    await expect(target).toHaveClass(/dragging/);
    await expect(target).toHaveCSS("outline-width", "1px");
    await expect
      .poll(async () => (await motion(target)).playState)
      .toBe("paused");
    await twoFrames(page);
    const paused = await motion(target);
    await page.waitForTimeout(250);
    expect(await motion(target)).toEqual(paused);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(target).not.toHaveClass(/dragging/);
    await expect
      .poll(async () => (await motion(target)).playState)
      .toBe("running");
    expect(f.requests).toHaveLength(requests);
    expect(f.posts()).toBe(0);
  } finally {
    await page.mouse.up();
  }
});

for (const appearance of ["light", "dark"])
  test(`${appearance}のreduced-motionは薄い静的cueを残して実frameを変化させない`, async ({
    page,
  }) => {
    const f = await ready(page);
    await theme(page, appearance);
    const requests = f.requests.length;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await enable(page);
    await expect(card(page)).toHaveCSS("outline-width", "1px");
    await expect(card(page).locator(".unestimated-motion")).toBeHidden();
    expect((await motion(card(page))).name).toBe("none");
    const stem = `test-results/unestimated-motion-${page.viewportSize()!.width}-${appearance}-reduced`;
    const first = await frame(card(page), `${stem}-frame-0.png`);
    await page.waitForTimeout(350);
    const second = await frame(card(page), `${stem}-frame-1.png`);
    expect(diffPng(first, second).total).toBe(0);
    expect(f.requests).toHaveLength(requests);
    expect(f.posts()).toBe(0);
  });
