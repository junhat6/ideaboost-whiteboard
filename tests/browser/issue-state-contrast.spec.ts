import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

const statusColors = {
  gray: "#57606a",
  blue: "#0969da",
  green: "#1a7f37",
  yellow: "#9a6700",
  orange: "#bc4c00",
  red: "#cf222e",
  purple: "#8250df",
  pink: "#bf3989",
};
const states = [
  {
    key: "open",
    selector: '[data-open="t0-0-0"]',
    label: "Open",
    icon: "issue-opened",
    tone: "open",
    capture: true,
  },
  {
    key: "completed",
    selector: '[data-open="t0-0-1"]',
    label: "Closed · 完了",
    icon: "issue-closed",
    tone: "completed",
    capture: true,
  },
  {
    key: "not-planned",
    selector: '[data-open="t0-0-2"]',
    label: "Closed · 見送り",
    icon: "skip",
    tone: "closed",
    capture: true,
  },
  {
    key: "unknown",
    selector: '[data-open="t0-0-3"]',
    label: "状態未確認",
    icon: null,
    tone: "closed",
  },
  {
    key: "duplicate",
    selector: '.pbi-title[data-pbi="p0"]',
    label: "Closed · 重複",
    icon: "skip",
    tone: "closed",
  },
  {
    key: "closed",
    selector: '.pbi-title[data-pbi="p1"]',
    label: "Closed",
    icon: "skip",
    tone: "closed",
  },
] as const;

for (const theme of ["light", "dark"] as const)
  test(`${theme}: header Issue stateは正本の文言・iconを保ち、通常文字contrast 4.5:1以上`, async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/"))
        requests.push(`${request.method()} ${path}`);
    });
    const f = await setup(page);
    await expect.poll(f.sprintReads).toBe(1);
    expect(requests.slice().sort()).toEqual([
      "GET /api/board",
      "GET /api/current-sprint",
      "GET /api/health",
    ]);
    Object.assign(f.board.tasks[0], { status: "完了", state: "OPEN" });
    Object.assign(f.board.tasks[1], {
      status: "作業中",
      state: "CLOSED",
      stateReason: "COMPLETED",
    });
    Object.assign(f.board.tasks[2], {
      state: "CLOSED",
      stateReason: "NOT_PLANNED",
    });
    Object.assign(f.board.tasks[3], { state: undefined });
    Object.assign(f.board.lanes[0], {
      state: "CLOSED",
      stateReason: "DUPLICATE",
    });
    Object.assign(f.board.lanes[1], { state: "CLOSED", stateReason: null });
    await page.reload();
    await expect(page.locator(".pbi-title")).toHaveCount(6);
    await expect.poll(f.sprintReads).toBe(2);
    expect(f.reads()).toBe(2);
    expect(requests.slice().sort()).toEqual([
      "GET /api/board",
      "GET /api/board",
      "GET /api/current-sprint",
      "GET /api/current-sprint",
      "GET /api/health",
      "GET /api/health",
    ]);
    const initialRequestCount = requests.length;
    if (theme === "dark") {
      await page.locator("#operations").click();
      await page.locator("#theme").click();
      await page.locator("#operations").click();
    }
    await expect(page.locator("#board .issue-state")).toHaveCount(0);
    const foregrounds =
      theme === "dark"
        ? {
            open: [126, 231, 135],
            completed: [188, 140, 255],
            closed: [183, 191, 204],
          }
        : {
            open: [26, 127, 55],
            completed: [130, 80, 223],
            closed: [87, 96, 106],
          };
    const evidence: unknown[] = [];

    for (const state of states) {
      await page.locator(state.selector).click();
      const badge = page.locator("#issue-state"),
        drawer = page.locator("#details");
      await expect(badge).toHaveText(state.label);
      await expect(badge).toHaveAttribute(
        "aria-label",
        `GitHub Issue: ${state.label}`,
      );
      await expect(badge).toHaveClass(`issue-state issue-state-${state.tone}`);
      // 有限の登場animation完了後の静的表示を検証する。motionの証拠ではない。
      await expect(drawer).toHaveCSS("transform", "none");
      await expect(drawer).toHaveCSS("opacity", "1");
      await expect(badge).toHaveCSS("font-size", "13px");
      if (state.icon) {
        await expect(badge.locator("svg")).toHaveCount(1);
        await expect(
          badge.locator(`svg.octicon-${state.icon}`),
        ).toHaveAttribute("aria-hidden", "true");
        await expect(badge.locator("svg")).toHaveAttribute(
          "viewBox",
          "0 0 16 16",
        );
        await expect(badge.locator("svg")).toHaveCSS("width", "16px");
      } else await expect(badge.locator("svg")).toHaveCount(0);

      const presentation = await badge.evaluate((element) => {
        const context = document.createElement("canvas").getContext("2d")!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        // transparentなbadge/row/formも含め、実際の祖先背景を手前から合成する。
        let background = [0, 0, 0],
          alpha = 0;
        for (
          let node: Element | null = element;
          node;
          node = node.parentElement
        ) {
          const layer = rgba(getComputedStyle(node).backgroundColor);
          const contribution = (layer[3] / 255) * (1 - alpha);
          background = background.map((v, i) => v + layer[i] * contribution);
          alpha += contribution;
          if (alpha === 1) break;
        }
        const css = getComputedStyle(element),
          foreground = rgba(css.color);
        const luminance = (rgb: number[]) =>
          rgb.slice(0, 3).reduce((sum, channel, i) => {
            const value = channel / 255;
            return (
              sum +
              (value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4) *
                [0.2126, 0.7152, 0.0722][i]
            );
          }, 0);
        const values = [luminance(foreground), luminance(background)].sort(
          (a, b) => b - a,
        );
        return {
          foreground: foreground.slice(0, 3),
          foregroundAlpha: foreground[3],
          background,
          backgroundAlpha: alpha,
          contrast: (values[0] + 0.05) / (values[1] + 0.05),
          border: rgba(css.borderTopColor).slice(0, 3),
          text: rgba(
            getComputedStyle(element.querySelector("span")!).color,
          ).slice(0, 3),
          icon: element.querySelector("svg")
            ? rgba(getComputedStyle(element.querySelector("svg")!).fill).slice(
                0,
                3,
              )
            : null,
        };
      });
      expect(presentation.foreground).toEqual(foregrounds[state.tone]);
      expect(presentation.foregroundAlpha).toBe(255);
      expect(presentation.background).toEqual(
        theme === "dark" ? [35, 39, 48] : [255, 255, 255],
      );
      expect(presentation.backgroundAlpha).toBe(1);
      expect(presentation.contrast).toBeGreaterThanOrEqual(4.5);
      expect(presentation.border).toEqual(presentation.foreground);
      expect(presentation.text).toEqual(presentation.foreground);
      expect(presentation.icon).toEqual(
        state.icon ? presentation.foreground : null,
      );
      evidence.push({ state: state.key, ...presentation });

      if ("capture" in state) {
        const box = (await drawer.boundingBox())!,
          row = (await page.locator(".issue-state-row").boundingBox())!;
        await page.screenshot({
          path: `test-results/issue-state-contrast-${page.viewportSize()!.width}-${theme}-${state.key}.png`,
          clip: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: row.y + row.height + 12 - box.y,
          },
          animations: "disabled",
        });
      }
      if (state.key === "open") {
        await page.mouse.move(0, 0);
        await expect(page.locator("#detail-status")).toHaveValue("完了");
        await expect(page.locator("#close-issue")).toBeEnabled();
        await expect(page.locator("#close-issue")).toHaveText(
          "Issueをクローズ",
        );
        await expect(
          page.locator("#close-issue svg.octicon-issue-closed"),
        ).toHaveCount(1);
        // headerだけのtokenは、Project Statusと下部Close actionへ漏らさない。
        const unaffected = await page
          .locator("#close-issue")
          .evaluate((button, theme) => {
            const css = getComputedStyle(button),
              root = getComputedStyle(document.documentElement);
            const context = document.createElement("canvas").getContext("2d")!;
            const rgb = (color: string) => {
              context.clearRect(0, 0, 1, 1);
              context.fillStyle = color;
              context.fillRect(0, 0, 1, 1);
              return Array.from(context.getImageData(0, 0, 1, 1).data);
            };
            const ink = theme === "dark" ? "#d9c4ff" : "#6940b3",
              surface = theme === "dark" ? "#232730" : "#ffffff";
            return {
              statuses: Object.fromEntries(
                [
                  "gray",
                  "blue",
                  "green",
                  "yellow",
                  "orange",
                  "red",
                  "purple",
                  "pink",
                ].map((name) => [
                  name,
                  root.getPropertyValue(`--status-${name}`).trim(),
                ]),
              ),
              headerToken: css.getPropertyValue("--issue-state-open"),
              colors: [
                rgb(css.color),
                rgb(css.backgroundColor),
                rgb(css.borderTopColor),
              ],
              expectedColors: [
                rgb(ink),
                rgb(`color-mix(in srgb, #8250df 8%, ${surface})`),
                rgb(`color-mix(in srgb, ${ink} 70%, ${surface})`),
              ],
              style: [
                css.display,
                css.alignItems,
                css.justifyContent,
                css.gap,
                css.minHeight,
                css.padding,
                css.fontSize,
                css.fontWeight,
                css.lineHeight,
                css.borderRadius,
                css.boxShadow,
              ],
              footer: [
                getComputedStyle(button.parentElement!).justifyContent,
                getComputedStyle(button.parentElement!).marginTop,
              ],
            };
          }, theme);
        expect(unaffected.statuses).toEqual(statusColors);
        expect(unaffected.headerToken).toBe("");
        expect(unaffected.colors).toEqual(unaffected.expectedColors);
        // flex itemはblockifyされるため、宣言inline-flexのcomputed値はflex。
        // https://www.w3.org/TR/css-display-3/#transformations
        expect(unaffected.style).toEqual([
          "flex",
          "center",
          "center",
          "8px",
          "36px",
          "7px 12px",
          "13px",
          "600",
          "20px",
          "6px",
          "rgba(0, 0, 0, 0.04) 0px 1px 1px 0px",
        ]);
        expect(unaffected.footer).toEqual(["flex-start", "32px"]);
      } else {
        await expect(page.locator("#close-issue")).toBeHidden();
        if (state.key === "completed")
          await expect(page.locator("#detail-status")).toHaveValue("作業中");
      }
      await page.locator("#close-detail").click();
      await expect(drawer).not.toBeVisible();
    }
    console.log(
      "issue-state-contrast",
      JSON.stringify({ theme, viewport: page.viewportSize(), evidence }),
    );
    expect(f.reads()).toBe(2);
    expect(f.sprintReads()).toBe(2);
    expect(f.posts()).toBe(0);
    expect(requests.filter((request) => !request.startsWith("GET "))).toEqual(
      [],
    );
    expect(
      requests
        .slice(initialRequestCount)
        .filter(
          (request) =>
            !/^GET \/api\/issues\/\d+\/(comments|pull-requests)$/.test(request),
        ),
    ).toEqual([]);
  });
