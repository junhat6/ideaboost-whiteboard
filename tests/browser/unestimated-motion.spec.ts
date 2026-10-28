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
const halo = "unestimated-halo";
const frameMargin = 6;
type HaloSample = {
  elapsed: number;
  currentTime: number;
  progress: number;
  opacity: number;
  transform: string;
  duration: string;
  easing: string;
};

async function ready(page: Page, allEligible = false, eligibleCount?: number) {
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
  await expect.poll(f.sprintReads).toBe(1);
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
  if (eligibleCount !== undefined) {
    for (const task of f.board.tasks) Object.assign(task, { estimateHours: 4 });
    const visible = f.board.tasks.filter(
      (task) => task.lane !== "p6" && Number(task.id.split("-").at(-1)) < 4,
    );
    for (const task of visible.slice(0, eligibleCount))
      Object.assign(task, { estimateHours: null });
  }
  f.board.tasks[5].type = "競合調査";
  f.board.tasks[9].type = "Bug";
  await page.reload();
  await expect.poll(f.sprintReads).toBe(2);
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
async function setSyntheticVisibility(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    if (value) {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
    } else {
      Reflect.deleteProperty(document, "hidden");
      Reflect.deleteProperty(document, "visibilityState");
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
async function pauseAtNaturalMidpoint(target: Locator) {
  // Pause via the existing visibility guard, without seeking/changing the clock.
  // The paired stills below compare style strength, not animation performance.
  await target.evaluate(
    (element) =>
      new Promise<void>((resolve, reject) => {
        const begin = performance.now();
        const tick = () => {
          const opacity = Number(
            getComputedStyle(
              element.querySelector(".unestimated-motion")!,
              "::after",
            ).opacity,
          );
          if (opacity >= 0.4 && opacity <= 0.5) {
            Object.defineProperty(document, "hidden", {
              configurable: true,
              value: true,
            });
            Object.defineProperty(document, "visibilityState", {
              configurable: true,
              value: "hidden",
            });
            document.dispatchEvent(new Event("visibilitychange"));
            resolve();
          } else if (performance.now() - begin > 5000) {
            reject(
              new Error(
                `No natural middle-opacity frame within 5s: ${opacity}`,
              ),
            );
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
  await twoFrames(target.page());
}
async function motion(target: Locator) {
  return target.evaluate((element) => {
    const span = element.querySelector(".unestimated-motion")!,
      style = getComputedStyle(span, "::after"),
      animation = element
        .getAnimations({ subtree: true })
        .find(
          (value) =>
            (value as CSSAnimation).animationName === "unestimated-halo",
        );
    return {
      name: style.animationName,
      playState: style.animationPlayState,
      transform: style.transform,
      currentTime:
        animation && typeof animation.currentTime === "number"
          ? animation.currentTime
          : null,
      opacity: style.opacity,
      outline: getComputedStyle(element).outlineWidth,
    };
  });
}
async function sampleHalo(target: Locator) {
  // One natural-time cycle; no clock/seek/duration changes.
  return target.evaluate(
    (element) =>
      new Promise<HaloSample[]>((resolve, reject) => {
        const span = element.querySelector(".unestimated-motion")!;
        const samples: HaloSample[] = [],
          begin = performance.now();
        let animation: Animation | undefined;
        const tick = () => {
          animation ||= element
            .getAnimations({ subtree: true })
            .find(
              (value) =>
                (value as CSSAnimation).animationName === "unestimated-halo",
            );
          const style = getComputedStyle(span, "::after"),
            timing = animation?.effect?.getComputedTiming();
          if (performance.now() - begin > 5000) {
            reject(
              new Error(
                `Halo did not complete one real timeline cycle within 5s: ${JSON.stringify(samples)}`,
              ),
            );
            return;
          }
          if (
            !animation ||
            typeof animation.currentTime !== "number" ||
            typeof timing?.progress !== "number"
          ) {
            // A pending initial frame is unmeasured, not a failed or completed cycle.
            requestAnimationFrame(tick);
            return;
          }
          samples.push({
            elapsed: performance.now() - begin,
            currentTime: animation.currentTime,
            progress: timing.progress,
            opacity: Number(style.opacity),
            transform: style.transform,
            duration: style.animationDuration,
            easing: style.animationTimingFunction,
          });
          if (samples.at(-1)!.currentTime - samples[0].currentTime >= 1500)
            resolve(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}
function assertHaloCycle(samples: HaloSample[]) {
  expect(samples.length).toBeGreaterThan(5);
  expect(
    samples.every((sample) =>
      [
        sample.elapsed,
        sample.currentTime,
        sample.progress,
        sample.opacity,
      ].every(Number.isFinite),
    ),
  ).toBe(true);
  expect(
    samples.every(
      (sample) =>
        sample.transform === "none" &&
        sample.duration === "1.5s" &&
        sample.easing === "ease-in-out",
    ),
  ).toBe(true);
  expect(
    samples.at(-1)!.currentTime - samples[0].currentTime,
  ).toBeGreaterThanOrEqual(1500);
  expect(
    samples.every(
      (sample, index) =>
        !index || sample.currentTime >= samples[index - 1].currentTime,
    ),
  ).toBe(true);
  const opacity = samples.map((sample) => sample.opacity);
  expect(Math.min(...opacity)).toBeGreaterThanOrEqual(0.199);
  expect(Math.max(...opacity)).toBeLessThanOrEqual(0.801);
  expect(Math.max(...opacity) - Math.min(...opacity)).toBeGreaterThanOrEqual(
    0.5,
  );
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
        // Captures include 6px outside the card; retain the original 6px edge band inside it.
        const edge = frameMargin + 6;
        if (x < edge || y < edge || x >= a.width - edge || y >= a.height - edge)
          boundary++;
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
function exteriorStrength(off: Buffer, highlighted: Buffer) {
  const a = PNG.sync.read(off),
    b = PNG.sync.read(highlighted);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  let changed = 0,
    absoluteRgbDelta = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      // Keep a 1px safety band outside the paper to exclude its static cue.
      const edge = frameMargin - 1;
      if (x >= edge && y >= edge && x < a.width - edge && y < a.height - edge)
        continue;
      const offset = (y * a.width + x) * 4,
        delta = [0, 1, 2].reduce(
          (sum, channel) =>
            sum + Math.abs(a.data[offset + channel] - b.data[offset + channel]),
          0,
        );
      if (delta) changed++;
      absoluteRgbDelta += delta;
    }
  return { changed, absoluteRgbDelta };
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
  const box = (await target.boundingBox())!;
  return target.page().screenshot({
    path,
    animations: "allow",
    scale: "css",
    clip: {
      x: box.x - frameMargin,
      y: box.y - frameMargin,
      width: box.width + frameMargin * 2,
      height: box.height + frameMargin * 2,
    },
  });
}
async function sampleFrameTime(page: Page) {
  // Identical wall-clock rAF sampling for OFF and ON; no screenshot, seek, API
  // request or FPS threshold is introduced during either measurement window.
  const sample = await page.evaluate(
    () =>
      new Promise<{
        durations: number[];
        activeAnimations: number;
        visibleCards: number;
      }>((resolve) => {
        const stamps: number[] = [];
        const tick = (time: number) => {
          stamps.push(time);
          if (stamps.length < 61) return requestAnimationFrame(tick);
          resolve({
            durations: stamps
              .slice(1)
              .map((stamp, index) => stamp - stamps[index]),
            activeAnimations: document
              .getAnimations()
              .filter(
                (animation) =>
                  (animation as CSSAnimation).animationName ===
                    "unestimated-halo" && animation.playState === "running",
              ).length,
            visibleCards: document.querySelectorAll(
              ".unestimated-highlight.unestimated-visible",
            ).length,
          });
        };
        requestAnimationFrame(tick);
      }),
  );
  expect(sample.durations).toHaveLength(60);
  expect(
    sample.durations.every(
      (duration) => Number.isFinite(duration) && duration > 0,
    ),
  ).toBe(true);
  const sorted = [...sample.durations].sort((a, b) => a - b);
  return {
    ...sample,
    mean:
      sample.durations.reduce((sum, duration) => sum + duration, 0) /
      sample.durations.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1)!,
  };
}
function summarizeFrameWindows(
  samples: Awaited<ReturnType<typeof sampleFrameTime>>[],
) {
  const durations = samples.flatMap((sample) => sample.durations),
    sorted = [...durations].sort((a, b) => a - b);
  return {
    samples,
    sampleCount: samples.length,
    activeAnimations: Math.max(
      ...samples.map((sample) => sample.activeAnimations),
    ),
    visibleCards: Math.max(...samples.map((sample) => sample.visibleCards)),
    mean:
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1)!,
  };
}

async function captureCycle(target: Locator, stem: string) {
  const samplesPromise = sampleHalo(target),
    states = [],
    frames = [];
  for (let i = 0; i < 3; i++) {
    if (i) await target.page().waitForTimeout(i === 1 ? 250 : 350);
    states.push(await motion(target));
    frames.push(await frame(target, `${stem}-frame-${i}.png`));
  }
  const samples = await samplesPromise,
    differences = [
      diffPng(frames[0], frames[1]),
      diffPng(frames[1], frames[2]),
    ];
  const metrics = {
    states,
    samples,
    pixelDiff: differences.map(({ boundary, center, total }) => ({
      boundary,
      center,
      total,
    })),
  };
  await writeFile(`${stem}-metrics.json`, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ metric: "unestimated-halo-cycle", ...metrics }));
  assertHaloCycle(samples);
  // Periodic endpoints may coincide; the three real PNGs must still include a visible change.
  expect(
    differences.reduce((sum, value) => sum + value.boundary, 0),
  ).toBeGreaterThan(0);
  for (const diff of differences) expect(diff.center).toBe(0);
  await writeFile(`${stem}-diff.png`, differences[0].image);
  return { first: frames[0], metrics };
}

for (const appearance of ["light", "dark"])
  test(`${appearance}の旧Aと強めたAを同じ自然停止位相で比較し外側だけ強くする`, async ({
    page,
  }) => {
    const f = await ready(page, false, 1);
    await theme(page, appearance);
    const target = card(page),
      neighbour = card(page, "t0-0-1"),
      stem = `test-results/unestimated-motion-${page.viewportSize()!.width}-${appearance}-strength`,
      geometryBefore = await geometry(page),
      requests = f.requests.length,
      off = await frame(target, `${stem}-off.png`),
      neighbourBefore = await neighbour.screenshot({ animations: "allow" });
    let baselineStyle: Awaited<ReturnType<Page["addStyleTag"]>> | undefined;
    try {
      await enable(page);
      await pauseAtNaturalMidpoint(target);
      const paused = await motion(target);
      expect(paused.playState).toBe("paused");
      expect(Number(paused.opacity)).toBeGreaterThanOrEqual(0.3);
      expect(Number(paused.opacity)).toBeLessThanOrEqual(0.7);
      // Previous shipped A shadow; only this fixture's one card changes style.
      // The existing animation object/currentTime/duration are left untouched.
      baselineStyle = await page.addStyleTag({
        content: `[data-task="t0-0-0"] .unestimated-motion::after {
          box-shadow: 0 0 14px 3px color-mix(in srgb, var(--accent) 40%, transparent);
        }`,
      });
      await twoFrames(page);
      const baseline = await frame(target, `${stem}-before.png`),
        beforeState = await motion(target);
      await baselineStyle.evaluate((element) => element.remove());
      baselineStyle = undefined;
      await twoFrames(page);
      const stronger = await frame(target, `${stem}-after.png`),
        afterState = await motion(target),
        beforeStrength = exteriorStrength(off, baseline),
        afterStrength = exteriorStrength(off, stronger),
        difference = diffPng(baseline, stronger),
        metrics = {
          metric: "unestimated-halo-style-strength",
          comparison:
            "same natural midpoint paused via synthetic visibility notification; not perceived-strength or motion-performance measurement",
          viewport: page.viewportSize(),
          appearance,
          beforeState,
          afterState,
          beforeStrength,
          afterStrength,
          exteriorRgbRatio:
            afterStrength.absoluteRgbDelta / beforeStrength.absoluteRgbDelta,
          pixelDiff: {
            boundary: difference.boundary,
            center: difference.center,
          },
        };
      await writeFile(`${stem}-metrics.json`, JSON.stringify(metrics, null, 2));
      await writeFile(`${stem}-diff.png`, difference.image);
      console.log(JSON.stringify(metrics));
      expect(beforeState).toEqual(paused);
      expect(afterState).toEqual(paused);
      expect(beforeStrength.absoluteRgbDelta).toBeGreaterThan(0);
      // A meaningful exterior change, not a claim of exactly 3x visual perception.
      expect(afterStrength.absoluteRgbDelta).toBeGreaterThan(
        beforeStrength.absoluteRgbDelta * 1.5,
      );
      expect(difference.boundary).toBeGreaterThan(0);
      expect(difference.center).toBe(0);
      expect(
        diffPng(
          neighbourBefore,
          await neighbour.screenshot({ animations: "allow" }),
        ).total,
      ).toBe(0);
      expect(await geometry(page)).toEqual(geometryBefore);
      expect(f.requests).toHaveLength(requests);
      expect(f.posts()).toBe(0);
    } finally {
      if (baselineStyle)
        await baselineStyle.evaluate((element) => element.remove());
      await setSyntheticVisibility(page, false);
    }
  });

for (const appearance of ["light", "dark"])
  test(`${appearance}の6PBI・2×2で全辺ハローがふわっと変化し紙面と隣付箋を覆わない`, async ({
    page,
  }) => {
    const f = await ready(page);
    await theme(page, appearance);
    const stem = `test-results/unestimated-motion-${page.viewportSize()!.width}-${appearance}`,
      before = await geometry(page),
      requests = f.requests.length;
    const offFrame = await frame(card(page), `${stem}-off.png`);
    const neighbourBefore = await card(page, "t0-0-1").screenshot({
      animations: "allow",
    });
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
    expect((await motion(card(page))).name).toBe(halo);
    const cycle = await captureCycle(card(page), stem),
      original = before.find((value) => value.id === "t0-0-0")!,
      fill = original.fill.match(/\d+/g)!.slice(0, 3).map(Number),
      paper = paperPixels(offFrame, cycle.first, fill, {
        left: original.hours.left - original.card.left + frameMargin,
        right: original.hours.right - original.card.left + frameMargin,
        top: original.hours.top - original.card.top + frameMargin,
        bottom: original.hours.bottom - original.card.top + frameMargin,
      });
    console.log(
      JSON.stringify({
        metric: "unestimated-halo-paper",
        viewport: page.viewportSize(),
        appearance,
        paper,
      }),
    );
    expect(paper.checked).toBeGreaterThan(0);
    expect(paper.changed).toBe(0);
    const neighbourAfter = await card(page, "t0-0-1").screenshot({
      animations: "allow",
    });
    expect(diffPng(neighbourBefore, neighbourAfter).total).toBe(0);
    expect(await geometry(page)).toEqual(before);
    await page.screenshot({
      path: `${stem}-board.png`,
      animations: "allow",
      scale: "css",
    });
    expect(f.requests).toHaveLength(requests);
    expect(f.posts()).toBe(0);
  });

test("ハローはresize後も全辺同時に変化し、紙面geometryと背景を保つ", async ({
  page,
}) => {
  const f = await ready(page),
    viewport = page.viewportSize()!,
    requests = f.requests.length;
  await enable(page);
  const initialBox = (await card(page).boundingBox())!;
  await page.setViewportSize({
    width: viewport.width - 160,
    height: viewport.height - 80,
  });
  await expect
    .poll(async () => {
      // ResizeObserver may replace the card between locator resolution and
      // geometry read. A missing frame is not resized geometry; poll the live
      // locator until the real, changed box is present.
      const box = await card(page).boundingBox();
      return Boolean(
        box &&
        (box.width !== initialBox.width || box.height !== initialBox.height),
      );
    })
    .toBe(true);
  await expect
    .poll(async () => (await motion(card(page))).playState)
    .toBe("running");
  await twoFrames(page);
  const before = await geometry(page);
  await captureCycle(
    card(page),
    `test-results/unestimated-motion-${viewport.width}-resize`,
  );
  expect(await geometry(page)).toEqual(before);
  expect(f.requests).toHaveLength(requests);
  expect(f.posts()).toBe(0);
});

for (const count of [6, 24, 94])
  test(`${count}枚のハローを同一自然時間窓でOFF/ON比較し性能限界を記録`, async ({
    page,
  }) => {
    const f = await ready(page, false, count),
      requests = f.requests.length;
    await page.mouse.move(2, page.viewportSize()!.height - 2);
    const baseline = summarizeFrameWindows([
      await sampleFrameTime(page),
      await sampleFrameTime(page),
    ]);
    await enable(page);
    await expect(
      page.locator(".unestimated-highlight.unestimated-visible"),
    ).toHaveCount(count);
    await twoFrames(page);
    const performance = summarizeFrameWindows([
      await sampleFrameTime(page),
      await sampleFrameTime(page),
    ]);
    const onOverOff = Object.fromEntries(
      (["mean", "p50", "p95", "max"] as const).map((key) => [
        key,
        performance[key] / baseline[key],
      ]),
    );
    const metrics = {
      viewport: page.viewportSize(),
      count,
      frameTimeBaseline: baseline,
      frameTimeProxy: performance,
      frameTimeComparison: { onOverOff },
    };
    await writeFile(
      `test-results/unestimated-motion-${page.viewportSize()!.width}-${count}-performance.json`,
      JSON.stringify(metrics, null, 2),
    );
    console.log(
      JSON.stringify({
        metric: "unestimated-halo-frame-time-proxy",
        ...metrics,
      }),
    );
    for (const sample of baseline.samples) {
      expect(sample.activeAnimations).toBe(0);
      expect(sample.visibleCards).toBe(0);
    }
    for (const sample of performance.samples) {
      expect(sample.activeAnimations).toBe(count);
      expect(sample.visibleCards).toBe(count);
    }
    // No arbitrary FPS pass threshold: record matched-window evidence honestly.
    expect(f.requests).toHaveLength(requests);
    expect(f.posts()).toBe(0);
  });

test("overflowで見えないハローはpausedとなり、再入場時だけ変化を再開する", async ({
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

test("native drag中は細いcueだけ残しハローをpause、取消後は再開する", async ({
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

test("document非表示通知ではhaloをpauseし、再表示でcueを残して再開する", async ({
  page,
}) => {
  const f = await ready(page);
  await enable(page);
  try {
    // Synthetic visibility notification exercises the app guard, not an OS/tab emulation claim.
    await setSyntheticVisibility(page, true);
    await expect(page.locator("#board")).toHaveClass(/unestimated-suspended/);
    await expect
      .poll(async () => (await motion(card(page))).playState)
      .toBe("paused");
    await twoFrames(page);
    const paused = await motion(card(page));
    await page.waitForTimeout(250);
    expect(await motion(card(page))).toEqual(paused);
    await expect(card(page)).toHaveCSS("outline-width", "1px");
  } finally {
    await setSyntheticVisibility(page, false);
  }
  await expect(page.locator("#board")).not.toHaveClass(/unestimated-suspended/);
  await expect
    .poll(async () => (await motion(card(page))).playState)
    .toBe("running");
  expect(f.posts()).toBe(0);
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
