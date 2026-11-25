// 付箋を Issue にする編集画面（ADR 019）。キーボードだけで作れること、必須欄、
// 部分保存・結果不明を自動で再送しないこと、付箋に Issue のリンクが付き済みになることを守る。
import { test, expect, type Page, type Route } from "@playwright/test";
import { setup } from "./fixtures";

type Note = {
  id: string;
  text: string;
  done: boolean;
  rev: number;
  issue?: { number: number; url: string };
  attachments?: unknown[];
};

async function fakeShelf(page: Page, initial: Note[]) {
  const notes = structuredClone(initial);
  const notePosts: Record<string, any>[] = [];
  await page.route("**/api/team-notes", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true, rev: 1, notes } });
    const body = route.request().postDataJSON();
    notePosts.push(body);
    const note = notes.find((n) => n.id === body.id)!;
    if (body.op === "issue") {
      note.issue = { number: body.number, url: body.url };
      note.done = true;
      note.rev++;
    }
    return route.fulfill({ json: { ok: true, note } });
  });
  return { notes, notePosts };
}

/** setup の後に呼ぶ（後に登録した route が先に当たる）。 */
async function fakeIssue(
  page: Page,
  respond: (route: Route, body: any) => Promise<void>,
) {
  const posts: { path: string; body: any }[] = [];
  await page.route("**/api/team-notes/*/issue", async (route) => {
    const body = route.request().postDataJSON();
    posts.push({ path: new URL(route.request().url()).pathname, body });
    return respond(route, body);
  });
  return posts;
}

const NOTE: Note = {
  id: "n_fake000001",
  text: "会場の電源を確認する",
  done: false,
  rev: 1,
  attachments: [
    {
      id: "a_fake000001",
      kind: "url",
      value: "https://example.com/plan",
      label: "会場図",
      state: "kept",
    },
  ],
};
const dialog = (page: Page) => page.locator("#note-issue-dialog");
const created = (number: number) => ({
  number,
  url: `https://github.com/engineer-first/idea-boost/issues/${number}`,
});

test("キーボードだけで付箋から Task を作る: 必須欄を示し、親 PBI と Status を選び、付箋は済みと Issue のリンクになる", async ({
  page,
}) => {
  const shelf = await fakeShelf(page, [NOTE]);
  await setup(page);
  const posts = await fakeIssue(page, (route) =>
    route.fulfill({ json: { ok: true, issue: created(42) } }),
  );
  const card = page.locator('#team-note-list [data-note-id="n_fake000001"]');
  await card.focus();
  await page.keyboard.press("i");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("#note-issue-title")).toBeFocused();
  await expect(page.locator("#note-issue-title")).toHaveValue(
    "会場の電源を確認する",
  );
  // 残した添付は補足へ引き継ぐ。
  await expect(page.locator('textarea[name="notes"]')).toHaveValue(
    "- 会場図: https://example.com/plan",
  );
  // ボードに出ている PBI が先に並ぶ。
  await expect(
    page.locator('#note-issue-parent optgroup[label="ボードに表示中"] option'),
  ).toHaveCount(6);

  // Why が空なら送らずに、どの欄かを示してその欄へ移る。
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
  );
  await expect(page.locator("#note-issue-error")).toContainText("Why");
  await expect(page.locator('textarea[name="why"]')).toBeFocused();
  await expect(page.locator('textarea[name="why"]')).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(posts).toHaveLength(0);

  await page.keyboard.type("当日の電源が足りるか分からない。");
  await page.locator("#note-issue-parent").selectOption("2");
  await page.locator("#note-issue-status").selectOption("作業中");
  // ラジオの上の Enter（暗黙の送信）では作らない。作るのは ⌘/Ctrl+Enter かボタンだけ。
  await page.locator('input[name="type"][value="Task"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  await expect(dialog(page)).toBeVisible();
  expect(posts).toHaveLength(0);
  await page.locator('textarea[name="why"]').focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Enter" : "Control+Enter",
  );

  await expect(dialog(page)).toBeHidden();
  expect(posts).toHaveLength(1);
  expect(posts[0].path).toMatch(/\/api\/team-notes\/n_fake000001\/issue$/);
  expect(posts[0].body).toMatchObject({
    noteId: "n_fake000001",
    type: "Task",
    title: "会場の電源を確認する",
    status: "作業中",
    parent: 2,
    why: "当日の電源が足りるか分からない。",
    notes: "- 会場図: https://example.com/plan",
  });
  expect(posts[0].body).not.toHaveProperty("story");
  expect(shelf.notePosts.map((p) => p.op)).toEqual(["issue"]);
  const link = page.locator("#team-note-done .team-note-issue-link");
  await expect(link).toHaveText("Issue #42");
  await expect(link).toHaveAttribute(
    "href",
    "https://github.com/engineer-first/idea-boost/issues/42",
  );
  await expect(page.locator("#team-note-status")).toContainText(
    "を作り、付箋を済みにしました",
  );
  // 済みになった付箋からはもう作れない。
  await expect(page.locator("#team-note-list .team-note")).toHaveCount(0);
});

test("PBI に切り替えるとユーザーストーリーが必須になり、閉じても書いた内容は残る", async ({
  page,
}) => {
  await fakeShelf(page, [NOTE]);
  await setup(page);
  const posts = await fakeIssue(page, (route) =>
    route.fulfill({ json: { ok: true, issue: created(50) } }),
  );
  await page.locator(".team-note-issue").first().click({ force: true });
  await page.locator('input[name="type"][value="PBI"]').check();
  await expect(page.locator('textarea[name="story"]')).toBeVisible();
  await expect(page.locator('textarea[name="how"]')).toBeHidden();
  await expect(page.locator("#note-issue-parent")).toBeHidden();
  await page.locator('textarea[name="why"]').fill("入力の流れが止まる。");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(
    page.locator('#team-note-list [data-note-id="n_fake000001"]'),
  ).toBeFocused();

  await page.keyboard.press("i");
  await expect(page.locator('input[name="type"][value="PBI"]')).toBeChecked();
  await expect(page.locator('textarea[name="why"]')).toHaveValue(
    "入力の流れが止まる。",
  );
  await page.locator("#note-issue-submit").click();
  await expect(page.locator("#note-issue-error")).toContainText(
    "ユーザーストーリー",
  );
  expect(posts).toHaveLength(0);
});

test("結果不明は再送せず、この付箋からの作成を止めて GitHub での確認を促す", async ({
  page,
}) => {
  const shelf = await fakeShelf(page, [NOTE]);
  await setup(page);
  const posts = await fakeIssue(page, (route) =>
    route.fulfill({
      status: 503,
      json: {
        ok: false,
        error: "mutation_outcome_unresolved",
        ambiguous: true,
      },
    }),
  );
  await page.locator(".team-note-issue").first().click({ force: true });
  await page.locator('textarea[name="why"]').fill("理由");
  await page.locator("#note-issue-submit").click();
  await expect(page.locator("#note-issue-error")).toContainText(
    "作られたか確認できません",
  );
  await expect(page.locator("#note-issue-submit")).toBeDisabled();
  await page.waitForTimeout(300);
  expect(posts).toHaveLength(1);
  expect(shelf.notePosts).toHaveLength(0);
});

test("部分保存は Issue を付箋に結び付け、済んでいない段を文字で示す（再送しない）", async ({
  page,
}) => {
  await fakeShelf(page, [NOTE]);
  await setup(page);
  const posts = await fakeIssue(page, (route) =>
    route.fulfill({
      status: 502,
      json: {
        ok: false,
        error: "partial_issue",
        partial: true,
        ambiguous: false,
        issue: created(43),
        failed: ["project", "status"],
      },
    }),
  );
  await page.locator(".team-note-issue").first().click({ force: true });
  await page.locator('textarea[name="why"]').fill("理由");
  await page.locator("#note-issue-submit").click();
  await expect(page.locator("#team-note-status")).toContainText(
    "Project への追加、Status",
  );
  await expect(
    page.locator("#team-note-done .team-note-issue-link"),
  ).toHaveText("Issue #43");
  expect(posts).toHaveLength(1);
});
