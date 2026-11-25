// 付箋の詳しいメモ（ADR 021）。一言は短いまま、別の複数行のメモを人が書けること、
// キーボードと IME で誤って保存しないこと、競合と結果不明を自動で再送しないこと、
// Issue 化の Why の初期値になること（下書きが優先）を守る。
import { test, expect, type Page, type Route } from "@playwright/test";
import { setup } from "./fixtures";

type Note = {
  id: string;
  text: string;
  done: boolean;
  rev: number;
  memo?: string;
};

async function fakeShelf(page: Page, initial: Note[]) {
  const notes = structuredClone(initial);
  const posts: Record<string, any>[] = [];
  let next: ((route: Route) => Promise<void>) | null = null;
  await page.route("**/api/team-notes", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { ok: true, rev: 1, notes } });
    const body = route.request().postDataJSON();
    posts.push(body);
    if (next) {
      const once = next;
      next = null;
      return once(route);
    }
    const note = notes.find((n) => n.id === body.id);
    if (!note)
      return route.fulfill({
        status: 404,
        json: { ok: false, error: "note_not_found" },
      });
    if (note.rev !== body.rev)
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "note_conflict", note },
      });
    note.rev++;
    if (body.op === "memo") {
      if (body.memo) note.memo = body.memo;
      else delete note.memo;
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

const ID = "n_fake000001";
const card = (page: Page) =>
  page.locator(`#team-note-list [data-note-id="${ID}"]`);
const field = (page: Page) =>
  card(page).locator(".team-note-memo-edit textarea");
const input = (page: Page) => page.locator("#team-note-input");
const SAVE = process.platform === "darwin" ? "Meta+Enter" : "Control+Enter";

test("キーボードだけでメモを書く: Enter は改行、⌘/Ctrl+Enter で保存、一言は短いまま、Issue 化の Why になる", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "会場の電源を確認する", done: false, rev: 1 },
  ]);
  await setup(page);
  await card(page).focus();
  await page.keyboard.press("m");
  await expect(field(page)).toBeFocused();
  await page.keyboard.type("去年は電源が足りなかった。");
  await page.keyboard.press("Enter");
  await page.keyboard.type("延長コードは 3 本要る。");
  expect(server.posts).toHaveLength(0);

  // IME の変換中の ⌘/Ctrl+Enter では保存しない。
  const prevented = await field(page).evaluate((el) => {
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      ctrlKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(server.posts).toHaveLength(0);

  await page.keyboard.press(SAVE);
  await expect(card(page)).toBeFocused();
  expect(server.posts).toEqual([
    expect.objectContaining({
      op: "memo",
      id: ID,
      rev: 1,
      memo: "去年は電源が足りなかった。\n延長コードは 3 本要る。",
    }),
  ]);
  await expect(card(page).locator(".team-note-text")).toHaveText(
    "会場の電源を確認する",
  );
  await expect(card(page).locator(".team-note-memo-text")).toHaveText(
    "去年は電源が足りなかった。\n延長コードは 3 本要る。",
  );
  // 一言は棚の幅を使い、1 行に収まる（操作ボタンが幅を取らない）。
  const line = await card(page)
    .locator(".team-note-text")
    .evaluate((el) => el.getClientRects().length);
  expect(line).toBe(1);

  await page.keyboard.press("i");
  await expect(
    page.locator('#note-issue-form textarea[name="why"]'),
  ).toHaveValue("去年は電源が足りなかった。\n延長コードは 3 本要る。");
  // 下書きがあれば、メモより下書きを優先する。
  await page
    .locator('#note-issue-form textarea[name="why"]')
    .fill("下書きの Why");
  await page.keyboard.press("Escape");
  await card(page).focus();
  await page.keyboard.press("i");
  await expect(
    page.locator('#note-issue-form textarea[name="why"]'),
  ).toHaveValue("下書きの Why");
  await page.keyboard.press("Escape");

  // Escape は送らずに取り消す。
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("取り消す");
  await page.keyboard.press("Escape");
  await expect(card(page)).toBeFocused();
  expect(server.posts).toHaveLength(1);
});

test("競合・結果不明でも書いたメモを捨てず、最新と並べて開き直す。再送はしない", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "告知文", done: false, rev: 1, memo: "元のメモ" },
  ]);
  await setup(page);
  server.notes[0].memo = "他の人のメモ";
  server.notes[0].rev = 2;
  await card(page).focus();
  await page.keyboard.press("m");
  await expect(field(page)).toHaveValue("元のメモ");
  await page.keyboard.type("を直す");
  await page.keyboard.press(SAVE);
  await expect(page.locator("#team-note-status")).toContainText(
    "他の人が先にこの付箋を変更しました",
  );
  await expect(page.locator("#team-note-status")).toContainText("残しています");
  // 書きかけはそのまま、いま保存されているメモと並べて見せる。
  await expect(field(page)).toHaveValue("元のメモを直す");
  await expect(card(page).locator(".team-note-memo-latest p")).toHaveText(
    "他の人のメモ",
  );

  // 通信が切れた: 保存されたか分からないので、自動で再送せず、書きかけも残す。
  server.failNext((route) => route.abort("connectionreset"));
  await field(page).focus();
  await page.keyboard.press(SAVE);
  await expect(page.locator("#team-note-status")).toContainText(
    "保存結果を確認できません",
  );
  await expect(field(page)).toHaveValue("元のメモを直す");
  // 案内どおり「最新を取得」を押しても、書きかけを送らない（開き直した欄は ⌘/Ctrl+Enter でだけ送る）。
  await page
    .locator("#team-note-status button", { hasText: "最新を取得" })
    .click();
  await expect(field(page)).toHaveValue("元のメモを直す");
  const memoPosts = server.posts.filter((p) => p.op === "memo");
  expect(memoPosts).toHaveLength(2);
  expect(memoPosts[1]).toMatchObject({ rev: 2, memo: "元のメモを直す" });

  // 人が確かめてから、空にして保存し直す（消す）。
  await field(page).fill("");
  await page.keyboard.press(SAVE);
  await expect(card(page).locator(".team-note-memo")).toHaveCount(0);
  await expect(card(page)).toBeFocused();
  expect(server.posts.filter((p) => p.op === "memo")[2]).toMatchObject({
    memo: "",
  });
});

/** 窓へ戻ったときの再取得（GET）を止めておき、編集を始めてから返す。 */
async function holdNextGet(page: Page, fail = false) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const handler = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await page.unroute("**/api/team-notes", handler);
    await gate;
    return fail ? route.abort("connectionreset") : route.fallback();
  };
  await page.route("**/api/team-notes", handler);
  const done = fail
    ? page.waitForEvent("requestfailed", (r) =>
        r.url().includes("/api/team-notes"),
      )
    : page.waitForResponse((r) => r.url().includes("/api/team-notes"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  return async () => {
    release();
    await done;
  };
}

test("書き始める前に出た再取得が返っても（失敗しても）欄を閉じず、他の人の変更は競合として見せる", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "告知文", done: false, rev: 1, memo: "元" },
  ]);
  await setup(page);

  // 再取得が失敗する経路: 書きかけを保存せず、欄も閉じない。続く打鍵は欄に入る。
  let finish = await holdNextGet(page, true);
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("あいう");
  await finish();
  await page.keyboard.type(" えお");
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("元あいう えお");
  expect(server.posts).toHaveLength(0);
  await page.keyboard.press("Escape");

  // 再取得が成功し、その間に他の人がメモを書いていた: 見ないまま上書きせず、競合にする。
  finish = await holdNextGet(page);
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("を追記");
  server.notes[0].memo = "他の人が書いた大事なメモ";
  server.notes[0].rev = 2;
  await finish();
  await expect(field(page)).toBeFocused();
  await page.keyboard.press(SAVE);
  await expect(page.locator("#team-note-status")).toContainText(
    "他の人が先にこの付箋を変更しました",
  );
  await expect(field(page)).toHaveValue("元を追記");
  await expect(card(page).locator(".team-note-memo-latest p")).toHaveText(
    "他の人が書いた大事なメモ",
  );
  expect(server.posts).toEqual([
    expect.objectContaining({ op: "memo", rev: 1, memo: "元を追記" }),
  ]);
  expect(server.notes[0].memo).toBe("他の人が書いた大事なメモ");
});

test("送信中は欄を止め、フォーカスを外すと保存する", async ({ page }) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "告知文", done: false, rev: 1 },
  ]);
  await setup(page);
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("あいう えお");

  // 送信中は欄を止め、後から打った文字が黙って消えないようにする。
  server.failNext(async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    const body = route.request().postDataJSON();
    const note = server.notes[0];
    note.rev++;
    note.memo = body.memo;
    return route.fulfill({ json: { ok: true, note } });
  });
  await page.keyboard.press(SAVE);
  await expect(field(page)).toHaveJSProperty("readOnly", true);
  await page.keyboard.type("X");
  await expect(card(page).locator(".team-note-memo-text")).toHaveText(
    "あいう えお",
  );

  // フォーカスを外すと保存する。
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("。");
  await input(page).focus();
  await expect(card(page).locator(".team-note-memo-text")).toHaveText(
    "あいう えお。",
  );
  expect(server.posts.filter((p) => p.op === "memo")).toHaveLength(2);
});

test("書いている間に付箋が剥がされたら、書いた文を状態行に残し、棚は止まらない", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "告知文", done: false, rev: 1 },
    { id: "n_fake000002", text: "お礼メール", done: false, rev: 1 },
  ]);
  await setup(page);
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("消えると困る長い文");
  server.notes.splice(0, 1);
  await page.keyboard.press(SAVE);
  await expect(page.locator("#team-note-status")).toContainText(
    "書いたメモ: 消えると困る長い文",
  );
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator(".team-note-memo-edit")).toHaveCount(0);
  // 棚は止まらず、次の再取得で他の人が貼った付箋が出る。
  server.notes.unshift({
    id: "n_fake000003",
    text: "新しい付箋",
    done: false,
    rev: 1,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.locator("#team-note-list .team-note-text", { hasText: "新しい付箋" }),
  ).toBeVisible();
});
