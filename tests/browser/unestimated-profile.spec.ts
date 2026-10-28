import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./fixtures";

// Temporary diagnostic: production CSS only, synthetic Issues only. No FPS gate.
const marker = ".unestimated-highlight.unestimated-visible";
async function setHighlight(page: Page, enabled: boolean) {
  await page.locator("#operations").focus();
  await page.keyboard.press("u");
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "aria-pressed",
    String(enabled),
  );
  await page.mouse.click(2, page.viewportSize()!.height - 2);
}
async function sample(page: Page) {
  const value = await page.evaluate(
    () =>
      new Promise<{ durations: number[]; active: number; visible: number }>(
        (resolve) => {
          const stamps: number[] = [];
          const tick = (time: number) => {
            stamps.push(time);
            if (stamps.length < 61) return requestAnimationFrame(tick);
            resolve({
              durations: stamps
                .slice(1)
                .map((stamp, index) => stamp - stamps[index]),
              active: document
                .getAnimations()
                .filter(
                  (animation) =>
                    (animation as CSSAnimation).animationName ===
                      "unestimated-orbit" && animation.playState === "running",
                ).length,
              visible: document.querySelectorAll(
                ".unestimated-highlight.unestimated-visible",
              ).length,
            });
          };
          requestAnimationFrame(tick);
        },
      ),
  );
  expect(value.durations).toHaveLength(60);
  expect(
    value.durations.every(
      (duration) => Number.isFinite(duration) && duration > 0,
    ),
  ).toBe(true);
  return value;
}
function summarize(samples: Awaited<ReturnType<typeof sample>>[]) {
  const durations = samples.flatMap((value) => value.durations),
    sorted = [...durations].sort((a, b) => a - b);
  return {
    samples,
    mean:
      durations.reduce((sum, duration) => sum + duration, 0) / durations.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1)!,
  };
}
type TraceEvent = {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  id?: string | number;
  id2?: { local?: string; global?: string };
  args?: { data?: Record<string, unknown> };
};
async function captureTrace(page: Page, stem: string) {
  const cdp = await page.context().newCDPSession(page),
    version = await cdp.send("Browser.getVersion"),
    byteLimit = 16 * 1024 * 1024,
    categories = ["blink.animations", "devtools.timeline", "benchmark", "rail"];
  let started = false,
    stream: string | undefined;
  const complete = new Promise<{ stream?: string; dataLossOccurred: boolean }>(
    (resolve) => cdp.once("Tracing.tracingComplete", resolve),
  );
  try {
    await setHighlight(page, false);
    await expect(page.locator(marker)).toHaveCount(0);
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      streamFormat: "json",
      streamCompression: "none",
      traceConfig: {
        recordMode: "recordUntilFull",
        traceBufferSizeInKb: byteLimit / 1024,
        includedCategories: categories,
      },
    });
    started = true;
    const startedAt = Date.now();
    await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await setHighlight(page, true);
    await expect(page.locator(marker)).toHaveCount(94);
    const onAt = Date.now();
    await page.waitForTimeout(2000);
    await setHighlight(page, false);
    await expect(page.locator(marker)).toHaveCount(0);
    const offAt = Date.now();
    await cdp.send("Tracing.end");
    started = false;
    const result = await complete;
    stream = result.stream;
    expect(stream, "ReturnAsStream must return a trace handle").toBeTruthy();
    const chunks: Buffer[] = [];
    let bytes = 0,
      exceeded = false;
    for (;;) {
      const part = await cdp.send("IO.read", {
          handle: stream!,
          size: 256 * 1024,
        }),
        chunk = Buffer.from(part.data, part.base64Encoded ? "base64" : "utf8");
      if (bytes + chunk.length > byteLimit) {
        exceeded = true;
        break;
      }
      chunks.push(chunk);
      bytes += chunk.length;
      if (part.eof) break;
    }
    const metadata = {
      version,
      categories,
      startedAt,
      onAt,
      offAt,
      onDurationMs: offAt - onAt,
      traceDurationMs: offAt - startedAt,
      bytes,
      byteLimit,
      exceeded,
      dataLossOccurred: result.dataLossOccurred,
      isolatedFromRafComparison: true,
    };
    await writeFile(
      `${stem}-trace-summary.json`,
      JSON.stringify(metadata, null, 2),
    );
    expect(
      exceeded,
      "Trace exceeds the explicit 16 MiB read/artifact limit",
    ).toBe(false);
    const raw = Buffer.concat(chunks),
      trace = JSON.parse(raw.toString("utf8")) as { traceEvents: TraceEvent[] };
    await writeFile(`${stem}-trace.json`, raw);
    expect(Array.isArray(trace.traceEvents)).toBe(true);
    const animations = trace.traceEvents.filter(
        (event) => event.name === "Animation",
      ),
      groups = new Map<string, TraceEvent[]>();
    for (const [index, event] of animations.entries()) {
      const id = event.id2?.local ?? event.id2?.global ?? event.id,
        // Missing IDs must not collapse unrelated events into one animation.
        key = id === undefined ? `missing:${index}` : `${event.pid}:${id}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }
    const work = (name: RegExp) => {
      const events = trace.traceEvents.filter((event) =>
          name.test(event.name ?? ""),
        ),
        timed = events.filter((event) => typeof event.dur === "number");
      return {
        eventCount: events.length,
        completeDurationEventCount: timed.length,
        totalDurationMs: timed.length
          ? timed.reduce((sum, event) => sum + event.dur!, 0) / 1000
          : null,
        durationEvidence: timed.length ? "observed" : "unknown",
        names: [...new Set(events.map((event) => event.name))],
        durationMeaning:
          "Sum of emitted dur fields; nested work is not elapsed wall time",
      };
    };
    await writeFile(
      `${stem}-trace-summary.json`,
      JSON.stringify(
        {
          ...metadata,
          totalEventCount: trace.traceEvents.length,
          animationEventCount: animations.length,
          identifiedAnimationCount: [...groups.keys()].filter(
            (key) => !key.startsWith("missing:"),
          ).length,
          unidentifiedAnimationEventCount: [...groups.keys()].filter((key) =>
            key.startsWith("missing:"),
          ).length,
          animationGroups: Object.fromEntries(groups),
          // Keep raw args.data, including compositeFailed, unsupportedProperties,
          // additionalReasons, displayName/nodeId/nodeName. Do not decode bits here.
          missingEvidenceMeaning:
            "Missing compositeFailed/Animation data is unknown, not proof of compositing",
          paint: work(/^Paint(?:Image)?$/),
          raster: work(/Raster/),
        },
        null,
        2,
      ),
    );
    expect(
      result.dataLossOccurred,
      "Trace evidence must not silently lose events",
    ).toBe(false);
  } finally {
    try {
      if (started) await cdp.send("Tracing.end");
      if (!stream && started) stream = (await complete).stream;
      if (stream) await cdp.send("IO.close", { handle: stream });
    } finally {
      await cdp.detach();
    }
  }
}

for (const count of [6, 24, 94])
  test(`${count} visible未見積のOFF/ON負荷と94枚の独立trace`, async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.route("https://avatars.githubusercontent.com/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#3159c9"/></svg>',
      }),
    );
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    });
    const f = await setup(page),
      selected = new Set<string>();
    for (let lane = 0; lane < 6; lane++)
      for (let column = 0; column < (count === 6 ? 1 : 4); column++)
        for (let index = 0; index < (count === 94 ? 4 : 1); index++) {
          if (
            count === 94 &&
            lane === 0 &&
            column === 0 &&
            [1, 2].includes(index)
          )
            continue;
          selected.add(`t${lane}-${column}-${index}`);
        }
    expect(selected.size).toBe(count);
    (f.board.scope as any).estimateHoursField = true;
    for (const task of f.board.tasks)
      Object.assign(task, {
        estimateHours: selected.has(task.id) ? null : 4,
        subIssueCount: 0,
        parentId: task.lane,
      });
    await page.route(/\/api\/burndown(?:\?.*)?$/, (route) =>
      route.fulfill({ status: 404, json: { error: "sprint_unavailable" } }),
    );
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
    const geometry = () =>
        page
          .locator("#board [data-task]")
          .evaluateAll((elements) =>
            elements.map((element) => ({
              id: (element as HTMLElement).dataset.task,
              rect: element.getBoundingClientRect().toJSON(),
            })),
          ),
      before = await geometry(),
      requestCount = requests.length,
      stem = `test-results/unestimated-motion-profile-${page.viewportSize()!.width}-${count}`;
    await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const off = summarize([await sample(page), await sample(page)]);
    for (const value of off.samples)
      expect([value.active, value.visible]).toEqual([0, 0]);
    await setHighlight(page, true);
    await expect(page.locator(marker)).toHaveCount(count);
    expect(await geometry()).toEqual(before);
    expect(
      await page
        .locator(marker)
        .evaluateAll((elements) =>
          elements.every(
            (element) =>
              getComputedStyle(element).outlineWidth === "1px" &&
              getComputedStyle(element).outlineStyle === "solid",
          ),
        ),
    ).toBe(true);
    const on = summarize([await sample(page), await sample(page)]);
    for (const value of on.samples)
      expect([value.active, value.visible]).toEqual([count, count]);
    await writeFile(
      `${stem}-metrics.json`,
      JSON.stringify(
        {
          viewport: page.viewportSize(),
          selected: [...selected],
          count,
          off,
          on,
          onOverOff: Object.fromEntries(
            (["mean", "p50", "p95", "max"] as const).map((key) => [
              key,
              on[key] / off[key],
            ]),
          ),
          candidateCss: false,
          geometryUnchanged: true,
        },
        null,
        2,
      ),
    );
    if (count === 94) await captureTrace(page, stem);
    expect(requests).toHaveLength(requestCount);
    expect(f.posts()).toBe(0);
  });
