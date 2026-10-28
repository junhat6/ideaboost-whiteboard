import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { setup } from "./fixtures";

const { PNG } = createRequire(import.meta.url)(
  "playwright-core/lib/utilsBundle",
);
// Apply the deployed policy, not a relaxed preview-only policy.
const productionCsp = readFileSync(
  new URL("../../worker/index.ts", import.meta.url),
  "utf8",
).match(/"Content-Security-Policy",\s*"([^"\n]+)"/)?.[1];
if (!productionCsp)
  throw new Error(
    "Production CSP was not found; update this fixture to read its source",
  );
const dialog = (page: Page) => page.locator("#highlight-demo");
const choice = (page: Page, value: string) =>
  page.locator(`[data-demo-choice="${value}"]`);
async function showToolbar(page: Page) {
  // #operations lives outside #chrome: focusing it does not open the toolbar.
  const operations = page.locator("#operations");
  if ((await operations.getAttribute("aria-expanded")) !== "true")
    await operations.click();
  await expect(operations).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#chrome")).toHaveClass(/controls-open/);
  await expect(page.locator("#highlight-demo-open")).toBeInViewport();
}
async function openDemo(page: Page) {
  await showToolbar(page);
  await page.locator("#highlight-demo-open").click();
}
async function ready(page: Page, theme = "light", open = true) {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        "content-security-policy": productionCsp!,
      },
    });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#3159c9"/></svg>',
    }),
  );
  const api: string[] = [],
    assets: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.includes("/api/"))
      api.push(request.url());
    if (/highlight-demo\.(js|css)$/.test(new URL(request.url()).pathname))
      assets.push(request.url());
  });
  const f = await setup(page);
  await expect.poll(f.sprintReads).toBe(1);
  Object.assign(f.board.scope, { estimateHoursField: true });
  f.board.tasks.forEach((task) =>
    Object.assign(task, {
      estimateHours: null,
      subIssueCount: 0,
      parentId: task.lane,
    }),
  );
  await page.reload();
  await expect.poll(f.sprintReads).toBe(2);
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
  await showToolbar(page);
  if (theme === "dark") await page.locator("#theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  expect(assets).toHaveLength(0);
  const baseline = api.length;
  if (!open) return { ...f, api, assets, baseline };
  await openDemo(page);
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("#highlight-demo-close")).toBeFocused();
  await expect(
    page.locator("#highlight-demo svg.hd-avatar[role=img]"),
  ).toHaveCount(3);
  await expect(
    page.locator(
      "#highlight-demo [src^='data:'], #highlight-demo image, #highlight-demo img",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".hd-avatar").first()).toHaveAccessibleName(
    "担当者：デモ担当（架空）",
  );
  return { ...f, api, assets, baseline };
}
async function geometry(page: Page) {
  return page.locator(".hd-card").evaluateAll((cards) =>
    cards.map((card) => {
      const boxes = [
        card,
        ...card.querySelectorAll(".hd-paper,.hd-title,.hd-avatar,.hd-hours"),
      ].map((element) => element.getBoundingClientRect().toJSON());
      const title = card.querySelector(".hd-title")!,
        footer = card.querySelector(".hd-footer")!;
      const range = document.createRange();
      range.selectNodeContents(title);
      const collision = Array.from(range.getClientRects()).some(
        (r) => r.bottom > footer.getBoundingClientRect().top + 0.5,
      );
      return {
        boxes,
        collision,
        fill: getComputedStyle(card.querySelector(".hd-paper")!)
          .backgroundColor,
      };
    }),
  );
}
async function motion(page: Page) {
  return page
    .locator(".hd-plate")
    .first()
    .evaluate((plate) => {
      const css = getComputedStyle(plate),
        animation = plate.getAnimations()[0];
      return {
        transform: css.transform,
        opacity: css.opacity,
        name: css.animationName,
        state: css.animationPlayState,
        time: animation?.currentTime,
        playState: animation?.playState,
      };
    });
}
type MotionSample = {
  elapsed: number;
  time: number | null;
  progress: number | null;
  name: string;
  transform: string;
  scaleX: number;
  scaleY: number;
  opacity: number;
};
async function observeNextReplay(page: Page) {
  await page.evaluate(() => {
    const replay = document.querySelector("#highlight-demo-replay")!;
    const plate = document.querySelector(".hd-plate")!;
    (window as any).__highlightDemoMotion = new Promise((resolve) => {
      // Registered after the UI's onclick: observe the newly restarted animation.
      // This does not trigger playback, seek a timeline, or alter its duration.
      replay.addEventListener(
        "click",
        () => {
          const animation = plate.getAnimations()[0];
          const duration = Number(
            animation?.effect?.getComputedTiming().duration,
          );
          const start = performance.now(),
            samples: MotionSample[] = [];
          if (!animation || !Number.isFinite(duration)) {
            resolve(samples);
            return;
          }
          const sample = () => {
            const css = getComputedStyle(plate),
              matrix = new DOMMatrixReadOnly(css.transform);
            samples.push({
              elapsed: performance.now() - start,
              time:
                typeof animation.currentTime === "number"
                  ? animation.currentTime
                  : null,
              progress: animation.effect?.getComputedTiming().progress ?? null,
              name: css.animationName,
              transform: css.transform,
              scaleX: matrix.a,
              scaleY: matrix.d,
              opacity: Number(css.opacity),
            });
            if (performance.now() - start >= duration + 80) resolve(samples);
            else requestAnimationFrame(sample);
          };
          sample();
        },
        { once: true },
      );
    });
  });
}
async function replaySamples(page: Page): Promise<MotionSample[]> {
  return page.evaluate(() => (window as any).__highlightDemoMotion);
}

function differences(
  a: Buffer,
  b: Buffer,
  paper: { x: number; y: number; width: number; height: number },
) {
  const first = PNG.sync.read(a),
    second = PNG.sync.read(b);
  expect(second.width).toBe(first.width);
  expect(second.height).toBe(first.height);
  let paperChanged = 0,
    outsideChanged = 0;
  for (let y = 0; y < first.height; y++)
    for (let x = 0; x < first.width; x++) {
      const index = (y * first.width + x) * 4;
      const changed = [0, 1, 2].some(
        (channel) =>
          Math.abs(first.data[index + channel] - second.data[index + channel]) >
          2,
      );
      if (!changed) continue;
      if (
        x >= paper.x + 4 &&
        x < paper.x + paper.width - 4 &&
        y >= paper.y + 4 &&
        y < paper.y + paper.height - 4
      )
        paperChanged++;
      else outsideChanged++;
    }
  return { paperChanged, outsideChanged };
}

for (const theme of ["light", "dark"])
  test(`比較デモは本番と独立し、3案の実frameで紙面と文字を保つ ${theme}`, async ({
    page,
  }) => {
    const f = await ready(page, theme);
    await expect(page.locator("#highlight-demo-notice")).toHaveText(
      "比較用・本番には反映されません",
    );
    await expect(page.locator(".hd-card")).toHaveCount(3);
    await expect(page.locator(".hd-title").first()).toHaveText(
      "利用者のアイデアを整理して、チームへ共有できる画面をつくる",
    );
    await expect(page.locator(".hd-avatar").first()).toHaveAccessibleName(
      /架空/,
    );
    const original = await geometry(page);
    expect(original.every((card) => !card.collision)).toBe(true);
    expect(new Set(original.map((card) => card.fill)).size).toBe(3);
    const baselineBoard = await page
      .locator("#highlight-unestimated")
      .getAttribute("aria-pressed");
    for (const variant of ["halo", "pop", "focus"]) {
      await choice(page, variant).click();
      await expect(choice(page, variant)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(dialog(page)).toHaveAttribute("data-variant", variant);
      const stageBox = await page.locator(".hd-stage").boundingBox();
      const paperBox = await page.locator(".hd-paper").first().boundingBox();
      const paper = {
        ...paperBox!,
        x: paperBox!.x - stageBox!.x,
        y: paperBox!.y - stageBox!.y,
      };
      await observeNextReplay(page);
      await page.locator("#highlight-demo-replay").click();
      const before = await motion(page);
      const frame0 = await page.locator(".hd-stage").screenshot({
        path: `test-results/highlight-demo-${variant}-${theme}-${page.viewportSize()!.width}-0.png`,
        animations: "allow",
      });
      await page.waitForTimeout(160);
      const frame1 = await page.locator(".hd-stage").screenshot({
        path: `test-results/highlight-demo-${variant}-${theme}-${page.viewportSize()!.width}-1.png`,
        animations: "allow",
      });
      const after = await motion(page);
      const samples = await replaySamples(page);
      console.log(
        JSON.stringify({
          metric: "highlight-demo-frames",
          theme,
          variant,
          width: page.viewportSize()!.width,
          before,
          after,
          samples,
        }),
      );
      const diff = differences(frame0, frame1, paper);
      console.log(
        JSON.stringify({
          metric: "highlight-demo-pixels",
          theme,
          variant,
          width: page.viewportSize()!.width,
          ...diff,
        }),
      );
      expect(before.name).toBe(`hd-${variant}`);
      const intermediate = samples.filter(
        (sample) =>
          sample.progress !== null &&
          sample.progress > 0 &&
          sample.progress < 1,
      );
      expect(intermediate.length).toBeGreaterThan(1);
      expect(samples.every((sample) => sample.name === `hd-${variant}`)).toBe(
        true,
      );
      // A pending first frame may have no currentTime yet; real timeline samples must be finite and advance.
      const active = samples.filter((sample) => sample.time !== null);
      expect(active.length).toBeGreaterThan(1);
      expect(
        active.every((sample) =>
          [
            sample.elapsed,
            sample.time,
            sample.progress,
            sample.scaleX,
            sample.scaleY,
            sample.opacity,
          ].every(
            (value) => typeof value === "number" && Number.isFinite(value),
          ),
        ),
      ).toBe(true);
      expect(
        active.every(
          (sample, index) => !index || sample.time! >= active[index - 1].time!,
        ),
      ).toBe(true);
      expect(active.at(-1)!.time!).toBeGreaterThan(active[0].time!);
      if (variant === "halo") {
        const opacity = intermediate.map((sample) => sample.opacity);
        // The 0.2→0.8 halo must visibly breathe, not merely produce rounding noise.
        expect(
          Math.max(...opacity) - Math.min(...opacity),
        ).toBeGreaterThanOrEqual(0.5);
      } else {
        // Pop returns to scale(1); its two endpoint matrices can legitimately match.
        expect(
          new Set(intermediate.map((sample) => sample.transform)).size,
        ).toBeGreaterThan(1);
        if (variant === "pop") {
          expect(
            Math.max(...intermediate.map((sample) => sample.scaleX)),
          ).toBeGreaterThanOrEqual(1.02);
          expect(
            Math.max(...intermediate.map((sample) => sample.scaleY)),
          ).toBeGreaterThanOrEqual(1.02);
        } else {
          const early = intermediate.filter((sample) => sample.progress! < 0.3);
          const late = intermediate.filter((sample) => sample.progress! > 0.8);
          expect(early.length).toBeGreaterThan(0);
          expect(late.length).toBeGreaterThan(0);
          expect(early[0].scaleX - late.at(-1)!.scaleX).toBeGreaterThan(0.01);
          expect(early[0].scaleY - late.at(-1)!.scaleY).toBeGreaterThan(0.01);
        }
        expect(samples.at(-1)?.scaleX).toBeCloseTo(1, 3);
        expect(samples.at(-1)?.scaleY).toBeCloseTo(1, 3);
      }
      expect(diff.paperChanged).toBe(0);
      expect(diff.outsideChanged).toBeGreaterThan(0);
      expect(await geometry(page)).toEqual(original);
      await page.locator("#highlight-demo-replay").click();
      await page.locator("#highlight-demo-pause").click();
      await expect(dialog(page)).toHaveAttribute("data-paused", "true");
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const paused = await motion(page);
      await page.waitForTimeout(120);
      const still = await motion(page);
      expect(still.time).toBe(paused.time);
      expect(still.transform).toBe(paused.transform);
      expect(still.opacity).toBe(paused.opacity);
      await page.locator("#highlight-demo-pause").click();
      await expect
        .poll(async () => Number((await motion(page)).time))
        .toBeGreaterThan(Number(still.time));
      await page.locator("#highlight-demo-toggle").click();
      await expect(dialog(page)).toHaveAttribute("data-enabled", "false");
      await expect(page.locator(".hd-plate").first()).not.toBeVisible();
      expect(await geometry(page)).toEqual(original);
      await page.locator("#highlight-demo-toggle").click();
    }
    expect(
      await page.locator("#highlight-unestimated").getAttribute("aria-pressed"),
    ).toBe(baselineBoard);
    expect(f.api).toHaveLength(f.baseline);
    expect(f.posts()).toBe(0);
    expect(f.assets.filter((url) => url.endsWith(".js"))).toHaveLength(1);
    expect(f.assets.filter((url) => url.endsWith(".css"))).toHaveLength(1);
  });

test("demo内Uのみ切替、入力・IME・修飾・repeatを除外しEscapeと再openを維持", async ({
  page,
}) => {
  const f = await ready(page);
  await page.keyboard.press("u");
  await expect(dialog(page)).toHaveAttribute("data-enabled", "false");
  await page.keyboard.press("u");
  await expect(dialog(page)).toHaveAttribute("data-enabled", "true");
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey"]) {
    await page
      .locator("#highlight-demo-close")
      .evaluate((element, modifier) => {
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "u",
            [modifier]: true,
            bubbles: true,
          }),
        );
      }, modifier);
    await expect(dialog(page)).toHaveAttribute("data-enabled", "true");
  }
  await page.locator("#highlight-demo-close").evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", repeat: true, bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "u",
        isComposing: true,
        bubbles: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "u", bubbles: true }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await expect(dialog(page)).toHaveAttribute("data-enabled", "true");
  for (const tag of ["input", "textarea", "select", "div"]) {
    await dialog(page).evaluate((element, tag) => {
      const field = document.createElement(tag);
      field.id = "synthetic-demo-input";
      if (tag === "div") field.contentEditable = "true";
      element.append(field);
      field.focus();
    }, tag);
    await page.keyboard.press("u");
    await expect(dialog(page)).toHaveAttribute("data-enabled", "true");
    await page
      .locator("#synthetic-demo-input")
      .evaluate((element) => element.remove());
  }
  await choice(page, "focus").click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator("#highlight-demo-open")).toBeFocused();
  await expect(page.locator(".hd-plate").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  for (let i = 0; i < 3; i++) {
    await openDemo(page);
    await expect(dialog(page)).toHaveCount(1);
    await expect(dialog(page)).toBeVisible();
    await expect(choice(page, "focus")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#highlight-demo-close").click();
    await expect(dialog(page)).not.toBeVisible();
  }
  // A close event queued by the previous session cannot cancel a fresh open.
  await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ "/highlight-demo.js");
    const demo = module.mountHighlightDemo();
    await demo.open(document.querySelector("#highlight-demo-open"));
    demo.close();
    await demo.open(document.querySelector("#highlight-demo-open"));
  });
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator(".hd-plate").first()).toHaveCSS(
    "animation-name",
    "hd-focus",
  );
  await page.locator("#highlight-demo-close").click();
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.locator("#highlight-demo-styles")).toHaveCount(1);
  expect(f.assets).toHaveLength(2);
  expect(f.api).toHaveLength(f.baseline);
  expect(f.posts()).toBe(0);
});

test("reduced-motionは3案とも静止した枠のみで、本番選択・文字面積を変更しない", async ({
  page,
}) => {
  const f = await ready(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hd-reduced")).toBeVisible();
  const original = await geometry(page);
  for (const variant of ["halo", "pop", "focus"]) {
    await choice(page, variant).click();
    await page.locator("#highlight-demo-replay").click();
    expect(await motion(page)).toMatchObject({
      name: "none",
      transform: "none",
      opacity: "0.6",
    });
    await expect(page.locator(".hd-card").first()).toHaveCSS(
      "outline-width",
      "1px",
    );
    expect(await geometry(page)).toEqual(original);
  }
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(f.api).toHaveLength(f.baseline);
  expect(f.posts()).toBe(0);
});

for (const extension of ["js", "css"])
  test(`遅いdemo ${extension} を待つ間にkeyboardで開いた別dialogを奪わない`, async ({
    page,
  }) => {
    const f = await ready(page, "light", false);
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = new Promise<void>((resolve) => {
      observed = resolve;
    });
    await page.route(`**/highlight-demo.${extension}`, async (route) => {
      observed();
      await gate;
      await route.continue();
    });
    try {
      await openDemo(page);
      await seen;
      await page.locator("#choose-pbis").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#pbi-picker")).toBeVisible();
      release();
      await expect(page.locator("#highlight-demo-open")).not.toHaveAttribute(
        "aria-busy",
        "true",
      );
      // Wait for the held resource's response and module/style callbacks, not a fixed sleep.
      await expect
        .poll(() =>
          page.evaluate(
            (extension) =>
              performance
                .getEntriesByType("resource")
                .some((entry) =>
                  entry.name.endsWith(`highlight-demo.${extension}`),
                ),
            extension,
          ),
        )
        .toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect(dialog(page)).not.toBeVisible();
      await expect(page.locator("#pbi-picker")).toBeVisible();
      expect(f.api).toHaveLength(f.baseline);
      expect(f.posts()).toBe(0);
    } finally {
      release();
    }
  });
