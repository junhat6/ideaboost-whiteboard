import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const titles = [
  "調査・相談：作業画面の右上に表示する案内文を整理して、初めて使う人にも伝わる表現にする",
  "個人作業から共有へ切り替える時に、付箋が移動しても入力内容と選択状態を保つ",
  "工程別の進め方ガイドを整理し、次にする作業を画面内で分かるようにする",
  "各工程の初回スライドとヒントを、画面の配置に合わせて読みやすい場所へ表示する",
];
const card = (page: Page, index = 0) =>
  page.locator(`[data-task="t0-0-${index}"]`);
async function ready(page: Page) {
  const f = await setup(page);
  (f.board.scope as any).estimateHoursField = true;
  for (const task of f.board.tasks)
    Object.assign(task, {
      estimateHours: 4,
      subIssueCount: 0,
      parentId: task.lane,
    });
  titles.forEach((title, i) => Object.assign(f.board.tasks[i], { title }));
  await page.reload();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  return f;
}

for (const theme of ["light", "dark"] as const)
  test(`6PBIの2x2でも日本語titleを3行以上読め、avatarと時間を隠さない ${theme}`, async ({
    page,
  }) => {
    const f = await ready(page);
    await page.locator("#operations").click();
    if (theme === "dark") await page.locator("#theme").click();
    await page.locator("#operations").click();
    await page.mouse.move(10, page.viewportSize()!.height - 10);
    const metrics = [];
    for (let index = 0; index < 4; index++) {
      const m = await card(page, index).evaluate((element) => {
        const button = element.querySelector(".task-title")!,
          text = element.querySelector(".task-title-text")!,
          person = element.querySelector(".person")!,
          amount = element.querySelector(".task-estimate")!,
          area = text.getBoundingClientRect(),
          buttonBox = button.getBoundingClientRect(),
          p = person.getBoundingClientRect(),
          h = amount.getBoundingClientRect(),
          css = getComputedStyle(button);
        const node = text.firstChild!;
        const visible = [] as {
          char: string;
          top: number;
          left: number;
          right: number;
          bottom: number;
        }[];
        for (let i = 0; i < node.textContent!.length; i++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (
            r.width &&
            r.top >= area.top - 1 &&
            r.bottom <= area.bottom + 1 &&
            r.left >= area.left - 1 &&
            r.right <= area.right + 1
          )
            visible.push({
              char: node.textContent![i],
              top: r.top,
              left: r.left,
              right: r.right,
              bottom: r.bottom,
            });
        }
        const intersects = (r: (typeof visible)[number], box: DOMRect) =>
          r.left < box.right &&
          r.right > box.left &&
          r.top < box.bottom &&
          r.bottom > box.top;
        return {
          title: node.textContent,
          font: parseFloat(css.fontSize),
          fontWeight: css.fontWeight,
          fontFamily: css.fontFamily,
          foreground: css.color,
          background: getComputedStyle(element).backgroundColor,
          hoursColor: getComputedStyle(amount).color,
          lineHeight: parseFloat(css.lineHeight),
          visibleLines: new Set(visible.map((r) => Math.round(r.top * 10) / 10))
            .size,
          visibleCharacters: visible.map((r) => r.char).join(""),
          contentHeight: area.height,
          titleHeight: buttonBox.height,
          avatarWidth: p.width,
          avatarHeight: p.height,
          hoursWidth: h.width,
          hoursHeight: h.height,
          collision: visible.some((r) => intersects(r, p) || intersects(r, h)),
          scrollable: text.scrollHeight > text.clientHeight + 1,
        };
      });
      expect(m.title).toBe(titles[index]);
      expect(m.font).toBeGreaterThanOrEqual(11);
      expect(m.visibleLines).toBeGreaterThanOrEqual(3);
      expect(m.visibleCharacters.length).toBeGreaterThanOrEqual(30);
      function luminance(color: string) {
        return color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      }
      const contrast = (color: string) => {
        const a = luminance(color),
          b = luminance(m.background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      expect(contrast(m.foreground)).toBeGreaterThanOrEqual(7);
      expect(contrast(m.hoursColor)).toBeGreaterThanOrEqual(7);
      expect(m.collision).toBe(false);
      expect(m.avatarWidth).toBeGreaterThanOrEqual(16);
      expect(m.avatarHeight).toBeGreaterThanOrEqual(16);
      expect(m.hoursHeight).toBeGreaterThanOrEqual(12);
      metrics.push(m);
    }
    console.log(
      JSON.stringify({
        metric: "compact-title-readable",
        width: page.viewportSize()!.width,
        theme,
        cards: metrics,
      }),
    );
    await page.screenshot({
      path: `test-results/task-title-readable-${page.viewportSize()!.width}-${theme}.png`,
      animations: "disabled",
    });
    expect(f.posts()).toBe(0);
  });

test("付箋のtitle/customヒントを除き、accessible name・focus・drawer・操作barヒントを維持", async ({
  page,
}) => {
  const f = await ready(page);
  await expect(
    page.locator(
      "#board .task[title], #board .task[data-tooltip], #board .task [title], #board .task [data-tooltip]",
    ),
  ).toHaveCount(0);
  await card(page).locator(".task-title").hover();
  await card(page).locator(".task-title").focus();
  await expect(card(page).locator(".task-title")).toHaveAccessibleName(
    titles[0],
  );
  await expect(card(page).locator(".task-title")).toBeFocused();
  await expect(card(page).locator(".person")).toHaveAttribute(
    "aria-label",
    /担当者/,
  );
  await expect(card(page).locator(".task-estimate")).toHaveAttribute(
    "aria-label",
    /4時間/,
  );
  await page.keyboard.press("Enter");
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#detail-heading")).toHaveText(titles[0]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator("#operations").click();
  await expect(page.locator("#highlight-unestimated")).toHaveAttribute(
    "data-tooltip",
    /未見積/,
  );
  expect(f.posts()).toBe(0);
});
