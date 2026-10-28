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
type OrbitSample = {
  elapsed: number;
  currentTime: number;
  progress: number;
  iteration: number;
  transform: string;
  x: number;
  y: number;
  angle: number;
  positionError: number;
  angleError: number;
  linearSpeedLimit: number;
  width: number;
  height: number;
};

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
async function sampleOrbitPath(target: Locator) {
  // Observe a whole real-time circuit without seeking, pausing, or rewriting CSS.
  // Dense rAF readings cover the short corners between the ten PNG captures.
  return target.evaluate(
    (element) =>
      new Promise<OrbitSample[]>((resolve, reject) => {
        const span = element.querySelector(".unestimated-motion")!,
          animation = element
            .getAnimations({ subtree: true })
            .find(
              (value) =>
                (value as CSSAnimation).animationName === "unestimated-orbit",
            );
        const samples: OrbitSample[] = [],
          begin = performance.now();
        const tick = () => {
          const style = getComputedStyle(span, "::after"),
            timing = animation?.effect?.getComputedTiming();
          if (
            !animation ||
            typeof animation.currentTime !== "number" ||
            typeof timing?.progress !== "number" ||
            typeof timing.currentIteration !== "number"
          ) {
            reject(new Error("Expected a running CSS orbit to observe"));
            return;
          }
          const matrix = new DOMMatrixReadOnly(style.transform),
            { width, height } = span.getBoundingClientRect(),
            inset = parseFloat(style.getPropertyValue("--u-inset")),
            radius = parseFloat(style.getPropertyValue("--u-radius")),
            diagonal = radius * (1 - Math.SQRT1_2),
            left = inset,
            right = width - inset,
            top = inset,
            bottom = height - inset,
            // Independent coordinates describe the beam CENTER, not its
            // transform origin. Each corner and the loop endpoints are joined.
            stops = [
              [0, left + radius, top, 0],
              [0.34, right - radius, top, 0],
              [0.35, right - diagonal, top + diagonal, 45],
              [0.36, right, top + radius, 90],
              [0.48, right, bottom - radius, 90],
              [0.49, right - diagonal, bottom - diagonal, 135],
              [0.5, right - radius, bottom, 180],
              [0.84, left + radius, bottom, 180],
              [0.85, left + diagonal, bottom - diagonal, 225],
              [0.86, left, bottom - radius, 270],
              [0.98, left, top + radius, 270],
              [0.99, left + diagonal, top + diagonal, 315],
              [1, left + radius, top, 360],
            ],
            next = stops.findIndex(
              (stop, index) => index > 0 && stop[0] >= timing.progress!,
            ),
            start = stops[next - 1],
            end = stops[next],
            fraction = (timing.progress - start[0]) / (end[0] - start[0]),
            expected = start
              .slice(1)
              .map(
                (value, index) => value + (end[index + 1] - value) * fraction,
              ),
            x = matrix.m41 + parseFloat(style.width) / 2,
            y = matrix.m42 + parseFloat(style.height) / 2,
            rawAngle = (Math.atan2(matrix.m12, matrix.m11) * 180) / Math.PI,
            angle = rawAngle + Math.round((expected[2] - rawAngle) / 360) * 360;
          samples.push({
            elapsed: performance.now() - begin,
            currentTime: animation.currentTime,
            progress: timing.progress,
            iteration: timing.currentIteration,
            transform: style.transform,
            x,
            y,
            angle: angle + timing.currentIteration * 360,
            positionError: Math.hypot(x - expected[0], y - expected[1]),
            angleError: Math.abs(angle - expected[2]),
            linearSpeedLimit: Math.max(
              (right - left - 2 * radius) / (0.34 * 6400),
              (bottom - top - 2 * radius) / (0.12 * 6400),
              (radius * 2 * Math.sin(Math.PI / 8)) / (0.01 * 6400),
            ),
            width,
            height,
          });
          if (samples.at(-1)!.elapsed - samples[0].elapsed >= 6800)
            resolve(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
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
                    "unestimated-orbit" && animation.playState === "running",
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
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    const baseline = summarizeFrameWindows([
      await sampleFrameTime(page),
      await sampleFrameTime(page),
    ]);
    for (const sample of baseline.samples) {
      expect(sample.activeAnimations).toBe(0);
      expect(sample.visibleCards).toBe(0);
    }
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
    expect(middle.transform).not.toBe(start.transform);
    expect(end.transform).not.toBe(middle.transform);
    expect(new Set([start.opacity, middle.opacity, end.opacity]).size).toBe(1);
    const firstDiff = diffPng(a, b),
      secondDiff = diffPng(b, c);
    expect(firstDiff.boundary).toBeGreaterThan(0);
    expect(secondDiff.boundary).toBeGreaterThan(0);
    expect(firstDiff.center).toBe(0);
    expect(secondDiff.center).toBe(0);
    await writeFile(`${stem}-diff.png`, firstDiff.image);
    const performance = summarizeFrameWindows([
      await sampleFrameTime(page),
      await sampleFrameTime(page),
    ]);
    for (const sample of performance.samples) {
      expect(sample.activeAnimations).toBeGreaterThan(0);
      expect(sample.activeAnimations).toBeLessThanOrEqual(sample.visibleCards);
    }
    const onOverOff = Object.fromEntries(
        (["mean", "p50", "p95", "max"] as const).map((key) => [
          key,
          performance[key] / baseline[key],
        ]),
      ),
      offOverOn = Object.fromEntries(
        (["mean", "p50", "p95", "max"] as const).map((key) => [
          key,
          baseline[key] / performance[key],
        ]),
      ),
      metrics = {
        viewport: page.viewportSize(),
        appearance,
        frames: [start, middle, end],
        pixelDiff: [firstDiff, secondDiff].map(
          ({ boundary, center, total }) => ({ boundary, center, total }),
        ),
        frameTimeProxy: performance,
        frameTimeBaseline: baseline,
        frameTimeComparison: { onOverOff, offOverOn },
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

test("一時CSSのmask・shadow対照診断は同じ94光で紙面を保つ", async ({
  page,
}) => {
  // Diagnostic only: five configurations × two real 60-rAF windows, no FPS gate.
  // These candidate styles never enter the runtime stylesheet or persisted state.
  test.setTimeout(60_000);
  const f = await ready(page),
    stem = `test-results/unestimated-motion-${page.viewportSize()!.width}-ab`,
    requests = f.requests.length,
    before = await geometry(page),
    ring = `polygon(evenodd,
      0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px,
      2px 2px, calc(100% - 2px) 2px,
      calc(100% - 2px) calc(100% - 2px), 2px calc(100% - 2px),
      2px 2px, 0px 0px)`;
  expect(
    await page.evaluate((value) => CSS.supports("clip-path", value), ring),
    "This diagnostic requires the evenodd clip-path ring; never silently skip it",
  ).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  const baseline = summarizeFrameWindows([
    await sampleFrameTime(page),
    await sampleFrameTime(page),
  ]);
  for (const sample of baseline.samples) {
    expect(sample.activeAnimations).toBe(0);
    expect(sample.visibleCards).toBe(0);
  }
  await enable(page);
  await expect(
    page.locator(".unestimated-highlight.unestimated-visible"),
  ).toHaveCount(94);
  const target = card(page),
    readStyles = () =>
      target.evaluate((element) => {
        const wrapper = element.querySelector(".unestimated-motion")!,
          style = getComputedStyle(wrapper),
          beam = getComputedStyle(wrapper, "::after");
        return {
          maskImage: style.maskImage,
          clipPath: style.clipPath,
          shadow: beam.boxShadow,
          invariant: {
            padding: style.padding,
            borderRadius: style.borderRadius,
            containerType: style.containerType,
            width: beam.width,
            height: beam.height,
            origin: beam.transformOrigin,
            name: beam.animationName,
            duration: beam.animationDuration,
            timing: beam.animationTimingFunction,
            delay: beam.animationDelay,
          },
        };
      }),
    originalStyle = await readStyles(),
    candidates = [
      { name: "mask-shadow", clip: false, shadow: true },
      { name: "mask-no-shadow", clip: false, shadow: false },
      { name: "clip-shadow", clip: true, shadow: true },
      { name: "clip-no-shadow", clip: true, shadow: false },
    ],
    stages: {
      name: string;
      styles: Awaited<ReturnType<typeof readStyles>>;
      frames: Awaited<ReturnType<typeof motion>>[];
      frameTime: ReturnType<typeof summarizeFrameWindows>;
      overOff: Record<string, number>;
      overCurrent: Record<string, number>;
      pixelDiff: { boundary: number; center: number };
    }[] = [],
    saveMetrics = () =>
      writeFile(
        `${stem}-metrics.json`,
        JSON.stringify(
          { viewport: page.viewportSize(), baseline, stages },
          null,
          2,
        ),
      );
  await saveMetrics();
  for (const candidate of candidates) {
    const css = [
      candidate.clip
        ? `.unestimated-motion { mask: none !important; clip-path: ${ring} !important; }`
        : "",
      candidate.shadow
        ? ""
        : ".unestimated-motion::after { box-shadow: none !important; }",
    ].join("\n");
    const injected = css ? await page.addStyleTag({ content: css }) : null;
    try {
      await twoFrames(page);
      const styles = await readStyles();
      expect(styles.invariant).toEqual(originalStyle.invariant);
      expect(styles.shadow).toBe(
        candidate.shadow ? originalStyle.shadow : "none",
      );
      if (candidate.clip) {
        expect(styles.maskImage).toBe("none");
        expect(styles.clipPath).toContain("polygon(evenodd,");
      } else {
        expect(styles.maskImage).toBe(originalStyle.maskImage);
        expect(styles.maskImage).not.toBe("none");
        expect(styles.clipPath).toBe("none");
      }
      const performance = summarizeFrameWindows([
        await sampleFrameTime(page),
        await sampleFrameTime(page),
      ]);
      for (const sample of performance.samples) {
        expect(sample.activeAnimations).toBe(94);
        expect(sample.visibleCards).toBe(94);
      }
      const start = await motion(target),
        first = await frame(target, `${stem}-${candidate.name}-frame-0.png`);
      await page.waitForTimeout(350);
      const end = await motion(target),
        second = await frame(target, `${stem}-${candidate.name}-frame-1.png`),
        diff = diffPng(first, second),
        reference = stages[0]?.frameTime ?? performance,
        ratio = (denominator: ReturnType<typeof summarizeFrameWindows>) =>
          Object.fromEntries(
            (["mean", "p50", "p95", "max"] as const).map((key) => [
              key,
              performance[key] / denominator[key],
            ]),
          );
      stages.push({
        name: candidate.name,
        styles,
        frames: [start, end],
        frameTime: performance,
        overOff: ratio(baseline),
        overCurrent: ratio(reference),
        pixelDiff: { boundary: diff.boundary, center: diff.center },
      });
      await saveMetrics();
      await writeFile(`${stem}-${candidate.name}-diff.png`, diff.image);
      expect(end.currentTime!).toBeGreaterThan(start.currentTime!);
      expect(end.transform).not.toBe(start.transform);
      expect(diff.boundary).toBeGreaterThan(0);
      expect(diff.center).toBe(0);
      expect(await geometry(page)).toEqual(before);
      expect(f.requests).toHaveLength(requests);
      expect(f.posts()).toBe(0);
    } finally {
      if (injected) await injected.evaluate((element) => element.remove());
    }
  }
  expect(await readStyles()).toEqual(originalStyle);
});

test("境界の光が実時間で一周して全角を連続移動し、resize後も紙面へ入らない", async ({
  page,
}) => {
  // Separate from the OFF/ON performance windows so each test keeps 30s.
  const f = await ready(page),
    viewport = page.viewportSize()!,
    stem = `test-results/unestimated-motion-${viewport.width}-loop`,
    requests = f.requests.length;
  await enable(page);
  await twoFrames(page);
  const target = card(page),
    before = await geometry(page),
    initialBox = (await target.boundingBox())!,
    pathPromise = sampleOrbitPath(target),
    frames: Buffer[] = [],
    states: Awaited<ReturnType<typeof motion>>[] = [],
    stamps: number[] = [];
  for (let index = 0; index < 10; index++) {
    if (index) await page.waitForTimeout(760);
    states.push(await motion(target));
    frames.push(await frame(target, `${stem}-frame-${index}.png`));
    stamps.push(await page.evaluate(() => performance.now()));
  }
  const samples = await pathPromise,
    first = samples[0],
    last = samples.at(-1)!,
    corners = [
      [0.34, 0.36],
      [0.48, 0.5],
      [0.84, 0.86],
      [0.98, 1],
    ].map(
      ([start, end]) =>
        samples.filter(
          (sample) => sample.progress > start && sample.progress < end,
        ).length,
    ),
    continuity = samples.slice(1).map((sample, index) => {
      const previous = samples[index],
        elapsed = sample.currentTime - previous.currentTime;
      return {
        elapsed,
        angleStep: sample.angle - previous.angle,
        positionStep: Math.hypot(sample.x - previous.x, sample.y - previous.y),
        positionLimit:
          Math.max(sample.linearSpeedLimit, previous.linearSpeedLimit) *
          elapsed,
        angleLimit: (45 / (0.01 * 6400)) * elapsed,
      };
    });
  // Persist raw evidence before assertions so a failed path check remains diagnosable.
  await writeFile(
    `${stem}-metrics.json`,
    JSON.stringify(
      {
        viewport,
        frameTimes: stamps,
        frames: states,
        samples,
        cornerSamples: corners,
        continuity,
      },
      null,
      2,
    ),
  );
  expect(stamps.at(-1)! - stamps[0]).toBeGreaterThanOrEqual(6400);
  expect(last.elapsed - first.elapsed).toBeGreaterThanOrEqual(6400);
  expect(last.currentTime - first.currentTime).toBeGreaterThanOrEqual(6400);
  expect(last.iteration).toBeGreaterThan(first.iteration);
  expect(last.angle - first.angle).toBeGreaterThanOrEqual(360);
  expect(samples.length).toBeGreaterThan(10);
  for (const count of corners) expect(count).toBeGreaterThan(0);
  // Matrix rounding tolerance is sub-pixel; these are path/continuity checks,
  // not FPS thresholds. Bounds scale with the actual time between samples.
  expect(
    Math.max(...samples.map((sample) => sample.positionError)),
  ).toBeLessThan(0.1);
  expect(Math.max(...samples.map((sample) => sample.angleError))).toBeLessThan(
    0.1,
  );
  for (const step of continuity) {
    expect(step.elapsed).toBeGreaterThanOrEqual(0);
    expect(step.angleStep).toBeGreaterThanOrEqual(-0.1);
    expect(step.angleStep).toBeLessThanOrEqual(step.angleLimit + 0.1);
    expect(step.positionStep).toBeLessThanOrEqual(step.positionLimit + 0.1);
  }
  const differences = [];
  for (let index = 1; index < frames.length; index++) {
    const diff = diffPng(frames[index - 1], frames[index]);
    expect(diff.boundary).toBeGreaterThan(0);
    expect(diff.center).toBe(0);
    differences.push({ boundary: diff.boundary, center: diff.center });
    await writeFile(`${stem}-diff-${index}.png`, diff.image);
  }
  expect(await geometry(page)).toEqual(before);

  await page.setViewportSize({
    width: viewport.width - 160,
    height: viewport.height - 80,
  });
  await expect
    .poll(async () => {
      const box = (await target.boundingBox())!;
      return box.width !== initialBox.width || box.height !== initialBox.height;
    })
    .toBe(true);
  await twoFrames(page);
  const resizedGeometry = await geometry(page),
    resizedBox = (await target.boundingBox())!,
    resizedStart = await motion(target),
    resizedFirst = await frame(target, `${stem}-resize-frame-0.png`);
  await page.waitForTimeout(450);
  const resizedEnd = await motion(target),
    resizedSecond = await frame(target, `${stem}-resize-frame-1.png`),
    resizedDiff = diffPng(resizedFirst, resizedSecond);
  await writeFile(
    `${stem}-resize-metrics.json`,
    JSON.stringify(
      {
        initialBox,
        resizedBox,
        frames: [resizedStart, resizedEnd],
        pixelDiff: {
          boundary: resizedDiff.boundary,
          center: resizedDiff.center,
        },
      },
      null,
      2,
    ),
  );
  expect(resizedEnd.currentTime!).toBeGreaterThan(resizedStart.currentTime!);
  expect(resizedEnd.transform).not.toBe(resizedStart.transform);
  expect(resizedDiff.boundary).toBeGreaterThan(0);
  expect(resizedDiff.center).toBe(0);
  expect(await geometry(page)).toEqual(resizedGeometry);
  await writeFile(`${stem}-resize-diff.png`, resizedDiff.image);
  await writeFile(
    `${stem}-metrics.json`,
    JSON.stringify(
      {
        viewport,
        frameTimes: stamps,
        frames: states,
        pixelDiff: differences,
        samples,
        cornerSamples: corners,
        continuity,
        resize: {
          initialBox,
          resizedBox,
          frames: [resizedStart, resizedEnd],
          pixelDiff: {
            boundary: resizedDiff.boundary,
            center: resizedDiff.center,
          },
        },
      },
      null,
      2,
    ),
  );
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
