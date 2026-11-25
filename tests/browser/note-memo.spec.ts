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
    const note = notes.find((n) => n.id === body.id)!;
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

test("書いている間の再取得で欄を閉じず、送信中の入力は止め、フォーカスを外すと保存する", async ({
  page,
}) => {
  const server = await fakeShelf(page, [
    { id: ID, text: "告知文", done: false, rev: 1 },
  ]);
  await setup(page);
  // 窓へ戻ったときの再取得を遅らせ、その間に書き始める。
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const delayGet = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await gate;
    return route.fallback();
  };
  await page.route("**/api/team-notes", delayGet);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await card(page).focus();
  await page.keyboard.press("m");
  await page.keyboard.type("あいう");
  release();
  await page.waitForResponse((r) => r.url().includes("/api/team-notes"));
  await page.keyboard.type(" えお");
  await expect(field(page)).toBeFocused();
  await expect(field(page)).toHaveValue("あいう えお");
  expect(server.posts).toHaveLength(0);
  await page.unroute("**/api/team-notes", delayGet);

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
