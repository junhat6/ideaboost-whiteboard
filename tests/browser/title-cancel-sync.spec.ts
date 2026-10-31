import { test, expect, type Page } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof setup>>;

async function open(page: Page, id = "t0-0-0") {
  await page.locator(`[data-open="${id}"]`).click();
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function pencil(page: Page, draft?: string) {
  await page.locator("#rename-issue").click();
  await expect(page.locator("#detail-title")).toBeFocused();
  if (draft !== undefined) await page.locator("#detail-title").fill(draft);
}

// 通常のタブ復帰イベントからmock GETを通す。アプリ内部の状態や関数は変更しない。
async function refresh(page: Page, fixture: Fixture, index = 0) {
  const reads = fixture.reads();
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/board",
    { timeout: 12000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await (await response).finished();
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await expect(
    page.locator(`[data-open="${fixture.board.tasks[index].id}"]`),
  ).toHaveText(fixture.board.tasks[index].title);
  expect(fixture.reads()).toBeGreaterThan(reads);
}

async function expectTitle(page: Page, title: string) {
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#title-editor")).toBeHidden();
  await expect(page.locator("#detail-heading")).toHaveText(title);
  await expect(page.locator("#detail-title")).toHaveValue(title);
  await expect(page.locator("#rename-issue")).toBeVisible();
}

async function expectClean(page: Page, title: string) {
  await expectTitle(page, title);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#cancel-edit")).toBeHidden();
  await expect(page.locator("#editor-conflicts")).toBeHidden();
  await expect(page.locator("#detail-sync")).toBeHidden();
}

function updateRemote(
  fixture: Fixture,
  title: string,
  { index = 0, body }: { index?: number; body?: string } = {},
) {
  Object.assign(fixture.board.tasks[index], {
    title,
    revision: `remote-${title}`,
    ...(body === undefined ? {} : { body }),
  });
}

test("未入力のタイトル編集中に同期した最新値をEscapeで古い値へ戻さない", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await pencil(page);
  updateRemote(s, "GitHubの最新タイトル");
  await refresh(page, s);
  await expect(page.locator("#detail-title")).toHaveValue(
    s.board.tasks[0].title,
  );
  await expect(page.locator("#detail-title")).toBeFocused();
  const reads = s.reads();
  await page.keyboard.press("Escape");
  await expectClean(page, s.board.tasks[0].title);
  await expect(page.locator("#rename-issue")).toBeFocused();
  expect(s.posts()).toBe(0);
  expect(s.reads()).toBe(reads);
});

test("今回だけのタイトル入力をEscapeで取り消すと最新値になりタイトル競合も解消する", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await pencil(page, "今回だけのタイトル下書き");
  updateRemote(s, "外部で更新されたタイトル");
  await refresh(page, s);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await expect(page.locator("#detail-title")).toHaveValue(
    "今回だけのタイトル下書き",
  );
  const reads = s.reads();
  await page.keyboard.press("Escape");
  await expectClean(page, s.board.tasks[0].title);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(0);
  expect(s.posts()).toBe(0);
  expect(s.reads()).toBe(reads);
});

test("タイトル取消は本文の下書きと本文競合をそのまま残す", async ({ page }) => {
  const s = await setup(page);
  await open(page);
  await fillEditor(page, "利用者が残す本文下書き");
  await pencil(page, "取り消すタイトル下書き");
  updateRemote(s, "GitHubの別タイトル", { body: "GitHubの別本文" });
  await refresh(page, s);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await expect(page.locator('[data-resolve="body"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectTitle(page, s.board.tasks[0].title);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(0);
  await expect(page.locator('[data-resolve="body"]')).toHaveCount(2);
  await expect(page.locator("#editor-conflicts .field-conflict")).toHaveCount(
    1,
  );
  await expect(page.locator("#editor-conflicts pre")).toHaveText(
    "GitHubの別本文",
  );
  await expect(page.locator("#detail-body")).toHaveValue(
    "利用者が残す本文下書き",
  );
  await expect(page.locator(".cm-content")).toContainText(
    "利用者が残す本文下書き",
  );
  await expect(page.locator("#cancel-edit")).toBeVisible();
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(0);
});

test("Enterで受け入れ済みの未保存Draft1は再編集Draft2の取消後も競合ごと残す", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await pencil(page, "先に受け入れたDraft1");
  await page.keyboard.press("Enter");
  await expectTitle(page, "先に受け入れたDraft1");
  await expect(page.locator("#save-issue")).toBeEnabled();
  await pencil(page, "今回取り消すDraft2");
  updateRemote(s, "GitHub側の第三のタイトル");
  await refresh(page, s);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectTitle(page, "先に受け入れたDraft1");
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await expect(page.locator("#editor-conflicts pre")).toHaveText(
    s.board.tasks[0].title,
  );
  await expect(page.locator("#cancel-edit")).toBeVisible();
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(0);
});

test("二度の外部更新と鉛筆の再開・取消を繰り返しても古い取消値が復活しない", async ({
  page,
}) => {
  // 繰り返し取消の契約に不要な throttle 待ちだけ省く。実 timers/rAF は維持。
  let now = Date.parse("2026-10-31T00:00:00Z");
  await page.clock.setFixedTime(now);
  const s = await setup(page);
  await open(page);
  await pencil(page);
  for (const title of ["外部更新1", "外部更新2"]) {
    updateRemote(s, title);
    await page.clock.setFixedTime((now += 5000));
    await refresh(page, s);
    await expect(page.locator("#detail-title")).toHaveValue(title);
    await expect(page.locator("#detail-title")).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expectClean(page, "外部更新2");
  await pencil(page, "再開後の取り消す入力");
  updateRemote(s, "外部更新3");
  await page.clock.setFixedTime((now += 5000));
  await refresh(page, s);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectClean(page, "外部更新3");
  await pencil(page, "外部更新なしの取り消す入力");
  await page.keyboard.press("Escape");
  await expectClean(page, "外部更新3");
  expect(s.posts()).toBe(0);
});

test("AからBへ切り替えAを開き直しても前のIssueや破棄済み下書きの取消値を使わない", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await pencil(page, "Aの破棄予定Draft1");
  await page.keyboard.press("Enter");
  await pencil(page, "Aの取り消すDraft2");
  await page.keyboard.press("Escape");
  await expectTitle(page, "Aの破棄予定Draft1");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  await open(page, "t0-0-1");
  await pencil(page, "Bの取り消す入力");
  updateRemote(s, "Aの新しい正本タイトル");
  updateRemote(s, "Bの新しい正本タイトル", { index: 1 });
  await refresh(page, s, 1);
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectClean(page, "Bの新しい正本タイトル");
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).toBeHidden();
  await open(page);
  await expectClean(page, "Aの新しい正本タイトル");
  await pencil(page, "Aの再開後の取り消す入力");
  await page.keyboard.press("Escape");
  await expectClean(page, "Aの新しい正本タイトル");
  expect(s.posts()).toBe(0);
});

test("IME変換中のEscapeは取消も閉じる操作もせず変換終了後だけ最新値へ取り消す", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await pencil(page, "変換中のタイトル入力");
  await page.locator("#detail-title").dispatchEvent("compositionstart");
  updateRemote(s, "変換中に受信した最新タイトル");
  await refresh(page, s);
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeVisible();
  await expect(page.locator("#title-editor")).toBeVisible();
  await expect(page.locator("#detail-title")).toHaveValue(
    "変換中のタイトル入力",
  );
  await expect(page.locator("#detail-title")).toBeFocused();
  expect(s.posts()).toBe(0);
  await page.locator("#detail-title").dispatchEvent("compositionend");
  await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expectClean(page, s.board.tasks[0].title);
  expect(s.posts()).toBe(0);
});

for (const accept of ["Enter", "blur"] as const) {
  test(`${accept}は同期後も取消ではなくタイトル下書きと競合の受け入れを維持する`, async ({
    page,
  }) => {
    const s = await setup(page);
    await open(page);
    await pencil(page, `${accept}で受け入れるタイトル`);
    updateRemote(s, `${accept}中の外部タイトル`);
    await refresh(page, s);
    await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
    if (accept === "Enter") await page.keyboard.press("Enter");
    else await page.locator(".cm-content").click();
    await expectTitle(page, `${accept}で受け入れるタイトル`);
    await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
    await expect(page.locator("#cancel-edit")).toBeVisible();
    await expect(page.locator("#save-issue")).toBeDisabled();
    await pencil(page, "受け入れ後の追加編集だけ取り消す");
    await page.keyboard.press("Escape");
    await expectTitle(page, `${accept}で受け入れるタイトル`);
    await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
    expect(s.posts()).toBe(0);
  });
}

test("本文だけの保存ACKが最新タイトルを返した後のEscapeは送信済み本文を戻さない", async ({
  page,
}) => {
  const s = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/issues/100", async (route) => {
    expect(route.request().method()).toBe("POST");
    const patch = route.request().postDataJSON();
    writes.push(patch);
    await gate;
    Object.assign(s.board.tasks[0], {
      body: patch.body,
      title: "保存ACKで確認された最新タイトル",
      revision: "saved-body-with-remote-title",
    });
    await route.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
  });
  try {
    await open(page);
    await fillEditor(page, "明示保存した本文");
    await page.locator("#save-issue").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toHaveProperty("body", "明示保存した本文");
    expect(writes[0]).not.toHaveProperty("title");
    await pencil(page, "ACK待ち中の取り消すタイトル");
    release();
    await expect(page.locator('[data-resolve="title"]')).toHaveCount(2);
    await expect(page.locator("#detail-title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expectClean(page, "保存ACKで確認された最新タイトル");
    await expect(page.locator("#detail-body")).toHaveValue("明示保存した本文");
    await expect(page.locator(".cm-content")).toContainText("明示保存した本文");
    expect(writes).toHaveLength(1);
    expect(s.posts()).toBe(0);
  } finally {
    release();
  }
});
