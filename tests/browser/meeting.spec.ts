import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";

const digest = {
  ok: true,
  digest: {
    headline: "企業参加の形を決めた",
    overview: "スポンサーと参加企業に分けて案内する方針にした。",
    topics: [
      {
        title: "企業向け案内",
        summary: "募集サイトに企業向けの導線を置く。",
        points: ["ヘッダーに導線", "チラシ裏面に連絡方法"],
        state: "decided",
        pbis: [2],
        evidence: [
          {
            chunk: "chunk-092200",
            half: "am",
            from: "09:22",
            to: "09:26",
            url: "https://github.com/engineer-first/meeting-logger/blob/main/docs/meeting-logs/transcripts/2026/11/2026-11-20-am.md#chunk-092200",
          },
        ],
      },
      {
        title: "当日の進行",
        summary: "発表時間を短くしブース展示と組み合わせる。",
        points: ["10:00開始"],
        state: "open",
        pbis: [],
        evidence: [],
      },
    ],
    decisions: [
      {
        text: "スポンサーと参加企業に分ける",
        topic: 0,
        needsConfirmation: false,
        evidence: [],
      },
      {
        text: "企業紹介は最大5分",
        topic: 1,
        needsConfirmation: true,
        evidence: [],
      },
    ],
    actions: [
      {
        text: "フォームの表示崩れを直す",
        owner: "",
        due: "2026-11-25",
        topic: 0,
        pbis: [2],
        evidence: [],
      },
    ],
    openQuestions: [{ text: "スポンサーの最低金額", topic: 1, evidence: [] }],
    timeline: [
      {
        chunk: "chunk-092200",
        label: "審査員の連絡",
        half: "am",
        from: "09:22",
        to: "09:26",
        url: "https://github.com/engineer-first/meeting-logger/blob/main/docs/meeting-logs/transcripts/2026/11/2026-11-20-am.md#chunk-092200",
      },
    ],
  },
  source: {
    kind: "meeting-logger",
    date: "2026-11-20",
    minutesUrl:
      "https://github.com/engineer-first/meeting-logger/blob/main/docs/meeting-logs/minutes/2026/11/2026-11-20.md",
    transcripts: [
      {
        half: "am",
        url: "https://github.com/engineer-first/meeting-logger/blob/main/docs/meeting-logs/transcripts/2026/11/2026-11-20-am.md",
      },
    ],
  },
  generatedAt: "2026-11-22T03:00:00Z",
  model: "gpt-6.1-terra",
};

async function meetings(
  page: Page,
  {
    ai = true,
    logger = true,
    fail = 0,
  }: { ai?: boolean; logger?: boolean; fail?: number } = {},
) {
  const posts: any[] = [];
  await page.route("**/api/meetings**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api/meetings"))
      return route.fulfill({
        json: {
          ok: true,
          ai,
          logger,
          meetings: logger
            ? [
                { date: "2026-11-20", minutesUrl: "https://github.com/x" },
                { date: "2026-11-19", minutesUrl: "https://github.com/y" },
              ]
            : [],
        },
      });
    posts.push(route.request().postDataJSON());
    if (posts.length <= fail)
      return route.fulfill({
        status: 502,
        json: { ok: false, error: "meeting_ai_incomplete" },
      });
    await new Promise((r) => setTimeout(r, 300));
    return route.fulfill({ json: digest });
  });
  return posts;
}

test("meeting digest lays out decisions, actions, open items and topics from a chosen day", async ({
  page,
}) => {
  await setup(page);
  const posts = await meetings(page);
  await page.locator("#operations").click();
  await page.locator("#meeting-open").click();
  const dialog = page.locator("#meeting-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#meeting-date")).toHaveValue("2026-11-20");
  await expect(page.locator("#meeting-date")).toBeFocused();
  await page.locator("#meeting-transcript").check();
  await page.locator("#meeting-run").click();
  await expect(page.locator("#meeting-result")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(page.locator("#meeting-run")).toBeDisabled();
  await expect(page.locator(".meeting-headline")).toHaveText(
    "企業参加の形を決めた",
  );
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ date: "2026-11-20", transcript: true });
  expect(posts[0].pbis.length).toBeGreaterThan(0);

  await expect(page.locator(".meeting-col h4")).toHaveText([
    "決まったこと2",
    "次にやること1",
    "未決・持ち越し1",
  ]);
  await expect(page.locator(".meeting-col-decided")).toContainText("要確認");
  await expect(page.locator(".meeting-owner.unassigned")).toHaveText(
    "担当未定",
  );
  await expect(page.locator(".meeting-topic")).toHaveCount(2);
  await expect(page.locator(".meeting-timeline li")).toHaveCount(1);
  const evidence = page.locator(".meeting-topic .meeting-time").first();
  await expect(evidence).toHaveAttribute("href", /#chunk-092200$/);
  await expect(evidence).toHaveAttribute("target", "_blank");

  // 話題にフォーカスすると、その話題から出た決定ややることが強調される。
  await page.locator(".meeting-col-open .meeting-topic-ref").click();
  await expect(page.locator("#meeting-topic-1")).toBeFocused();
  await expect(page.locator(".meeting-col li.is-related")).toHaveCount(2);

  const box = await dialog.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThan(width * 0.1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  await page.screenshot({
    path: `.wrangler/meeting-digest-${width}.png`,
  });

  // 閉じて開き直しても、別の日へ切り替えて戻っても、勝手に再生成しない。
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.keyboard.press("m");
  await expect(dialog).toBeVisible();
  await expect(page.locator(".meeting-headline")).toBeVisible();
  await page.locator("#meeting-date").selectOption("2026-11-19");
  await expect(page.locator(".meeting-headline")).toHaveCount(0);
  await page.locator("#meeting-date").selectOption("2026-11-20");
  await expect(page.locator(".meeting-foot")).toContainText("整理済み");
  await page.locator("#meeting-transcript").uncheck();
  await expect(page.locator(".meeting-headline")).toHaveCount(0);
  await page.locator("#meeting-transcript").check();
  await expect(page.locator(".meeting-headline")).toBeVisible();
  expect(posts).toHaveLength(1);

  // PBIチップはボードと同じIssueエディターを開く。
  await page.locator('.meeting-topic [data-pbi="2"]').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#details")).toContainText(
    "チームのアイデアを共有して育てる 2",
  );
});

test("meeting digest failures wait for an explicit retry and paste works without the archive", async ({
  page,
}) => {
  await setup(page);
  const posts = await meetings(page, { logger: false, fail: 1 });
  await page.locator("#operations").click();
  await page.locator("#meeting-open").click();
  await expect(page.locator('input[value="logger"]')).toBeDisabled();
  await expect(page.locator("#meeting-text")).toBeVisible();
  await expect(page.locator("#meeting-text")).toBeFocused();
  await expect(page.locator("#meeting-run")).toBeDisabled();
  await page.locator("#meeting-text").fill("決まったこと: スポンサーを分ける");
  await page.locator("#meeting-run").click();
  await expect(page.locator("#meeting-error")).toContainText(
    "AIの整理結果を受け取れませんでした",
  );
  await page.waitForTimeout(500);
  expect(posts).toHaveLength(1);
  expect(posts[0].text).toContain("スポンサー");
  await page.locator("#meeting-retry").click();
  await expect(page.locator(".meeting-headline")).toBeVisible();
  await expect(page.locator("#meeting-error")).toBeHidden();
  expect(posts).toHaveLength(2);
});

test("meeting digest stays unavailable until AI is enabled and is hidden in public mode", async ({
  page,
}) => {
  await setup(page);
  const posts = await meetings(page, { ai: false });
  await page.locator("#operations").click();
  await page.locator("#meeting-open").click();
  await expect(page.locator("#meeting-status")).toContainText(
    "AI整理はまだ有効になっていません",
  );
  await expect(page.locator("#meeting-run")).toBeDisabled();
  expect(posts).toHaveLength(0);

  const publicPage = await page.context().newPage();
  await setup(publicPage, { prefix: "/b/" + "a".repeat(48) });
  await expect(publicPage.locator("#meeting-open")).toBeHidden();
  await publicPage.keyboard.press("m");
  await expect(publicPage.locator("#meeting-dialog")).toBeHidden();
});
