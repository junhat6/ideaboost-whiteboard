// 付箋に関係する PBI を付ける（ADR 020）。キーボードだけで選べること、題はボードから引くこと、
// 付け替えの競合と結果不明を自動で再送しないこと、Issue 化の親 PBI の初期値になることを守る。
import { test, expect, type Page, type Route } from "@playwright/test";
import { setup } from "./fixtures";

type Note = {
  id: string;
  text: string;
  done: boolean;
  rev: number;
  pbi?: number;
};

/** /api/team-notes の create・pbi だけを持つ偽サーバー。 */
async function fakeShelf(page: Page, initial: Note[] = []) {
  let seq = 100;
  const notes = structuredClone(initial);
  const posts: Record<string, any>[] = [];
  let next: ((route: Route) => Promise<void>) | null = null;
  await page.route("**/api/team-notes", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true, rev: seq, notes } });
    const body = route.request().postDataJSON();
    posts.push(body);
    if (next) {
      const once = next;
      next = null;
      return once(route);
    }
    if (body.op === "create") {
      const created = body.texts.map((text: string) => ({
        id: "n_fake" + String(++seq).padStart(6, "0"),
        text,
        done: false,
        rev: 1,
        ...(body.pbi ? { pbi: body.pbi } : {}),
      }));
      notes.unshift(...created);
      return route.fulfill({ json: { ok: true, notes: created } });
    }
    const note = notes.find((n) => n.id === body.id)!;
    if (note.rev !== body.rev)
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "note_conflict", note },
      });
    note.rev++;
    if (body.op === "pbi") {
      if (body.pbi === null) delete note.pbi;
      else note.pbi = body.pbi;
    }
    return route.fulfill({ json: { ok: true, note } });
  });
  return {
    notes,
    posts,
    failNext(handler: (route: Route) => Promise<void>) {
      next = handler;
    },
  };
}

const input = (page: Page) => page.locator("#team-note-input");
const pick = (page: Page) => page.locator("#team-note-pbi");
const card = (page: Page, id: string) =>
  page.locator(`#team-note-list [data-note-id="${id}"]`);
const TITLE = (n: number) => `チームのアイデアを共有して育てる ${n}`;

test("キーボードだけで PBI を選んで貼り、題が見え、Issue 化の親の初期値になり、P で外せる", async ({
  page,
}) => {
  const server = await fakeShelf(page);
  await setup(page);
  await expect(page.locator("#team-shelf")).toHaveAttribute("data-mode", "api");

  await page.locator("#board").focus();
  await page.keyboard.press("t");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("会場の電源を確認する");
  await page.keyboard.press("Tab");
  await expect(pick(page)).toBeFocused();
  // 選択の上の 1 文字はボードのショートカット（N/P の件数切替など）を起こさない。
  const rows = await page.locator("#fit-mode").inputValue();
  // 合成イベントで送る（実キーだと select の先頭文字検索が続く "#2" の入力に混ざるため）。
  await pick(page).evaluate((el) => {
    for (const key of ["n", "p"])
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
  });
  await expect(page.locator("#fit-mode")).toHaveValue(rows);
  await page.keyboard.type("#2");
  await expect(pick(page)).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect
    .poll(() => server.posts.some((p) => p.op === "create"))
    .toBe(true);
  const created = server.posts.find((p) => p.op === "create")!;
  expect(created).toMatchObject({ texts: ["会場の電源を確認する"], pbi: 2 });
  const id = server.notes[0].id;
  await expect(card(page, id).locator(".team-note-pbi")).toHaveText(
    `#2 ${TITLE(2)}`,
  );
  // 選ばなければ今までと同じ付箋になるよう、貼った後は「なし」に戻る。
  await expect(pick(page)).toHaveValue("");

  // 題は付箋の幅の中で折り返し、棚からはみ出さない。
  const li = await card(page, id).boundingBox();
  const tag = await card(page, id).locator(".team-note-pbi").boundingBox();
  expect(tag!.x + tag!.width).toBeLessThanOrEqual(li!.x + li!.width + 0.5);

  await card(page, id).focus();
  await page.keyboard.press("i");
  await expect(page.locator("#note-issue-dialog")).toBeVisible();
  await expect(page.locator("#note-issue-parent")).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(card(page, id)).toBeFocused();

  // P で選び直す。矢印では保存せず、Enter で決める。
  await page.keyboard.press("p");
  const editor = card(page, id).locator(".team-note-pbi-edit");
  await expect(editor).toBeFocused();
  await page.keyboard.press("Home");
  expect(server.posts.filter((p) => p.op === "pbi")).toHaveLength(0);
  // Enter の連打でも送るのは 1 回だけ（2 回目は古い rev で偽の競合になる）。
  await editor.evaluate((el) => {
    for (let i = 0; i < 2; i++)
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect(card(page, id).locator(".team-note-pbi")).toHaveCount(0);
  await expect(page.locator("#team-note-status")).toBeHidden();
  await expect(card(page, id)).toBeFocused();
  expect(server.posts.filter((p) => p.op === "pbi")).toEqual([
    expect.objectContaining({ id, rev: 1, pbi: null }),
  ]);

  // マウスでは一覧の PBI をクリックして決める。
  await page.keyboard.press("p");
  await editor.locator('option[value="3"]').click();
  await expect(card(page, id).locator(".team-note-pbi")).toHaveText(
    `#3 ${TITLE(3)}`,
  );
  expect(server.posts.filter((p) => p.op === "pbi")[1]).toMatchObject({
    rev: 2,
    pbi: 3,
  });

  // Escape は何も送らずに取り消す。
  await card(page, id).focus();
  await page.keyboard.press("p");
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await expect(card(page, id)).toBeFocused();
  expect(server.posts.filter((p) => p.op === "pbi")).toHaveLength(2);
  expect(new Set(server.posts.map((p) => p.requestId)).size).toBe(
    server.posts.length,
  );
});

test("ボードの PBI 行の「＋付箋」は詳細を開かず、その PBI を選んだ一言入力へ移る", async ({
  page,
}) => {
  await fakeShelf(page);
  await setup(page);
  await expect(page.locator("#team-shelf")).toHaveAttribute("data-mode", "api");
  const add = page.locator('[data-note-for-pbi="3"]');
  await page.locator('[data-pbi-row="p2"]').hover();
  await expect(add).toBeVisible();
  await add.click();
  await expect(input(page)).toBeFocused();
  await expect(pick(page)).toHaveValue("3");
  await expect(page.locator("#details")).not.toHaveAttribute("open", "");

  // キーボードでも同じ入口に届く。
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(input(page)).toBeFocused();
  await expect(pick(page)).toHaveValue("3");
});

test("付箋が無効（404）なら PBI 行に「＋付箋」を出さない", async ({ page }) => {
  await page.route("**/api/team-notes", (route) =>
    route.fulfill({ status: 404, json: { ok: false, error: "not_found" } }),
  );
  await setup(page);
  await expect(page.locator("#team-shelf")).toHaveAttribute("data-mode", "off");
  await page.locator('[data-pbi-row="p2"]').hover();
  await expect(page.locator('[data-note-for-pbi="3"]')).toBeHidden();
});

test("付け替えの競合は最新を表示し、結果不明は再送せずに最新の取得を任せる", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: "n_fake000001", text: "告知文", done: false, rev: 1, pbi: 1 },
  ]);
  await setup(page);
  const id = "n_fake000001";
  await expect(card(page, id).locator(".team-note-pbi")).toHaveText(
    `#1 ${TITLE(1)}`,
  );

  // 別の画面が先に付け替えた。
  server.notes[0].pbi = 4;
  server.notes[0].rev = 2;
  await card(page, id).focus();
  await page.keyboard.press("p");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator("#team-note-status")).toContainText(
    "他の人が先にこの付箋を変更しました",
  );
  await expect(card(page, id).locator(".team-note-pbi")).toHaveText(
    `#4 ${TITLE(4)}`,
  );

  // 通信が切れた: 保存されたか分からないので、自動で再送しない。
  server.failNext((route) => route.abort("connectionreset"));
  await card(page, id).focus();
  await page.keyboard.press("p");
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(page.locator("#team-note-status")).toContainText(
    "保存結果を確認できません",
  );
  const pbiPosts = server.posts.filter((p) => p.op === "pbi");
  expect(pbiPosts).toHaveLength(2);
  expect(pbiPosts[1]).toMatchObject({ rev: 2, pbi: null });
});
