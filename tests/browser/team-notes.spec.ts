import { test, expect, type Page, type Route } from "@playwright/test";
import { setup } from "./fixtures";

type Note = { id: string; text: string; done: boolean; rev: number };

/** Worker の /api/team-notes と同じ契約を持つ最小の偽サーバー。 */
async function fakeNotes(page: Page, initial: string[] = []) {
  let seq = 0;
  const notes: Note[] = initial.map((text) => ({
    id: "n_fake" + String(++seq).padStart(6, "0"),
    text,
    done: false,
    rev: 1,
  }));
  const removed: Note[] = [];
  const posts: Record<string, unknown>[] = [];
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
      }));
      notes.unshift(...created);
      return route.fulfill({ json: { ok: true, notes: created } });
    }
    const pool = body.op === "restore" ? removed : notes;
    const note = pool.find((n) => n.id === body.id)!;
    if (note.rev !== body.rev)
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "note_conflict", note },
      });
    note.rev++;
    if (body.op === "done") note.done = body.done;
    if (body.op === "edit") note.text = body.text;
    if (body.op === "remove") {
      notes.splice(notes.indexOf(note), 1);
      removed.unshift(note);
    }
    if (body.op === "restore") {
      removed.splice(removed.indexOf(note), 1);
      notes.unshift(note);
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

const shelf = (page: Page) => page.locator("#team-shelf");
const input = (page: Page) => page.locator("#team-note-input");
const open = (page: Page) => page.locator("#team-note-list .team-note-text");
const cards = (page: Page) => page.locator("#team-note-list .team-note");

test("一言を Enter で貼り、複数行は 1 行 1 枚。キーボードだけで済み・剥がす・元に戻すができる", async ({
  page,
}) => {
  const server = await fakeNotes(page);
  await setup(page);
  await expect(shelf(page)).toHaveAttribute("data-mode", "api");

  await page.locator("#board").focus();
  await page.keyboard.press("t");
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("ハッカソン告知文を考える");
  await page.keyboard.press("Enter");
  await expect(open(page)).toHaveText(["ハッカソン告知文を考える"]);
  await expect(input(page)).toHaveValue("");
  await expect(input(page)).toBeFocused();

  await input(page).fill("- 会場の電源確認\n- お礼メール");
  await page.keyboard.press("Enter");
  await expect(open(page)).toHaveText([
    "会場の電源確認",
    "お礼メール",
    "ハッカソン告知文を考える",
  ]);
  expect(server.posts.filter((p) => p.op === "create")).toHaveLength(2);
  await expect(page.locator("#team-note-count")).toHaveText("3");

  // 付箋の上の 1 文字キーはボードのショートカット（F の全画面など）を起こさない。
  await page.keyboard.press("ArrowDown");
  await expect(cards(page).first()).toBeFocused();
  await page.keyboard.press("f");
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);

  await page.keyboard.press(" ");
  await expect(open(page)).toHaveCount(2);
  await expect(page.locator("#team-note-done .team-note-text")).toHaveText([
    "会場の電源確認",
  ]);

  await cards(page).first().focus();
  await page.keyboard.press("Delete");
  await expect(open(page)).toHaveText(["ハッカソン告知文を考える"]);
  await expect(page.locator("#team-note-status")).toContainText("剥がしました");
  await page
    .locator("#team-note-status button", { hasText: "元に戻す" })
    .click();
  await expect(open(page)).toHaveText([
    "お礼メール",
    "ハッカソン告知文を考える",
  ]);
  expect(server.posts.map((p) => p.op)).toEqual([
    "create",
    "create",
    "done",
    "remove",
    "restore",
  ]);
  expect(new Set(server.posts.map((p) => p.requestId)).size).toBe(5);
});

test("その場で直す。Escape は取り消し、他の人の先行変更は競合として最新を表示する", async ({
  page,
}) => {
  const server = await fakeNotes(page, ["告知文"]);
  await setup(page);
  await cards(page).first().focus();
  await page.keyboard.press("Enter");
  const field = page.locator(".team-note-edit");
  await expect(field).toBeFocused();
  await field.fill("告知文を書く");
  await page.keyboard.press("Escape");
  await expect(open(page)).toHaveText(["告知文"]);
  await expect(cards(page).first()).toBeFocused();

  await page.keyboard.press("F2");
  await field.fill("告知文を書く");
  await page.keyboard.press("Enter");
  await expect(open(page)).toHaveText(["告知文を書く"]);

  // 別の人が先に変えた: 手元の rev は古い。
  server.notes[0].text = "告知文を Slack に出す";
  server.notes[0].rev++;
  await cards(page).first().focus();
  await page.keyboard.press(" ");
  await expect(page.locator("#team-note-status")).toContainText(
    "他の人が先にこの付箋を変更しました",
  );
  await expect(open(page)).toHaveText(["告知文を Slack に出す"]);
});

test("保存結果が分からない書き込みは自動で再送せず、最新の取得を人に任せる", async ({
  page,
}) => {
  const server = await fakeNotes(page);
  await setup(page);
  server.failNext((route) => route.abort("connectionreset"));
  await input(page).fill("お礼メール");
  await input(page).press("Enter");
  const status = page.locator("#team-note-status");
  await expect(status).toContainText("保存結果を確認できません");
  await expect(input(page)).toHaveValue("お礼メール");
  await page.waitForTimeout(300);
  expect(server.posts).toHaveLength(1);
  // 実際には保存されていた場合、最新を取得すれば 1 枚だけ見える。
  server.notes.unshift({
    id: "n_fake999999",
    text: "お礼メール",
    done: false,
    rev: 1,
  });
  await status.getByRole("button", { name: "最新を取得" }).click();
  await expect(open(page)).toHaveText(["お礼メール"]);
  expect(server.posts).toHaveLength(1);
});

test("付箋の API が無いページではサンプル表示と明示し、保存しない", async ({
  page,
}) => {
  await setup(page);
  await expect(shelf(page)).toHaveAttribute("data-mode", "sample");
  await expect(page.locator("#team-note-status")).toHaveText(
    "サンプル表示です。付箋は保存されません。",
  );
  await expect(open(page)).toHaveCount(3);
  await input(page).fill("試しに貼る");
  await input(page).press("Enter");
  await expect(open(page).first()).toHaveText("試しに貼る");
});

test("棚はたためて、全画面では隠れ、ボードは残りの幅に収まる", async ({
  page,
}) => {
  await fakeNotes(page, ["告知文"]);
  await setup(page);
  const width = () =>
    page.locator("#board-scroll").evaluate((el) => el.clientWidth);
  const opened = await width();
  const fits = () =>
    page
      .locator("#board-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(await fits()).toBe(true);

  await page.locator("#team-shelf-toggle").click();
  await expect(shelf(page)).toHaveClass(/collapsed/);
  await expect(input(page)).toBeHidden();
  await expect.poll(width).toBeGreaterThan(opened + 150);
  expect(await fits()).toBe(true);

  // たたんでいても T で開いて書ける。
  await page.locator("#board").focus();
  await page.keyboard.press("t");
  await expect(shelf(page)).not.toHaveClass(/collapsed/);
  await expect(input(page)).toBeFocused();

  await page.locator("#board").focus();
  await page.keyboard.press("f");
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await expect(shelf(page)).toBeHidden();
  await page.keyboard.press("t");
  await expect(input(page)).not.toBeFocused();
});
