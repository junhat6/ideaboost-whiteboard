import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";

async function open(page) {
  await page.locator(".task-title").first().click();
  await expect(page.locator(".cm-content")).toBeVisible();
}
test("immediate Markdown editing preserves raw source, undo, safe GFM preview and title link", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await expect(
    page.locator("#edit-issue, #detail-badges, #detail-source"),
  ).toHaveCount(0);
  await expect(page.locator("#recover-edit")).toBeHidden();
  await expect(page.locator("#detail-heading")).toHaveAttribute(
    "href",
    /https:\/\/github.com\/engineer-first\/idea-boost\/issues\/100/,
  );
  await page.screenshot({
    path: `.wrangler/editor-${page.viewportSize()!.width}.png`,
    animations: "disabled",
  });
  const raw =
    '# 日本語\n\n- [x] 完了\n- 項目\n\n| A | B |\n|---|---|\n| 一 | 二 |\n\n```js\nconst x = "<script>";\n```\n\n<script>window.bad=1</script><img src=x onerror="window.bad=1">[危険](javascript:alert(1))';
  await page.locator(".cm-content").fill(raw);
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await page.waitForTimeout(600); // CodeMirrorの履歴グループを区切る
  await page.keyboard.press("End");
  await page.keyboard.type("XYZ");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  await page.locator("#markdown-preview").click();
  await expect(page.locator("#detail-body-view table")).toHaveCount(1);
  await expect(page.locator("#detail-body-view input")).toBeDisabled();
  await expect(
    page.locator(
      '#detail-body-view script, #detail-body-view img, #detail-body-view a[href^="javascript:"]',
    ),
  ).toHaveCount(0);
  await page.locator("#markdown-write").click();
  await expect(page.locator("#detail-body")).toHaveValue(raw);
  expect(s.posts()).toBe(0);
});
test("typing during a gated refresh survives; separate remote field merges, same field conflicts persist", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (route) => {
    await gate;
    await route.fulfill({ json: s.board });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".cm-content").fill("自分の本文");
  s.board.tasks[0].assignees = [
    { login: "newperson", name: "新担当", avatarUrl: "" },
  ];
  release();
  await expect(page.locator("#detail-assignee")).toHaveValues(["newperson"]);
  await expect(page.locator("#detail-body")).toHaveValue("自分の本文");
  s.board.tasks[0].body = "GitHubの本文";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#editor-conflicts")).toContainText(
    "本文がGitHubでも更新",
    { timeout: 8000 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#detail-body")).toHaveValue("自分の本文");
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page
    .getByRole("button", { name: "自分の変更を残す", exact: true })
    .click();
  await expect(page.locator("#save-issue")).toBeEnabled();
  await page.locator("#save-issue").click();
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#detail-sync")).toContainText("保存しました");
});
test("synthetic composition suppresses save and Escape, double submit sends once", async ({
  page,
}) => {
  const s = await setup(page, { slow: true });
  await open(page);
  await page.locator(".cm-content").fill("IME入力");
  await page.locator(".cm-content").dispatchEvent("compositionstart");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.keyboard.press("Escape");
  await expect(page.locator("#details")).toBeVisible();
  expect(s.posts()).toBe(0);
  await page.locator(".cm-content").dispatchEvent("compositionend");
  await expect(page.locator("#save-issue")).toBeEnabled();
  await page.evaluate(() => {
    const f = document.querySelector("#detail-form") as HTMLFormElement;
    f.requestSubmit();
    f.requestSubmit();
  });
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#detail-sync")).toContainText("保存しました");
  expect(s.posts()).toBe(1);
});
test("durable unknown-outcome fence survives successful background GET and keeps typing available", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await page.route("**/api/issues/**", (route) =>
    route.fulfill({
      status: 409,
      json: {
        ok: false,
        error: "mutation_outcome_unresolved",
        ambiguous: true,
      },
    }),
  );
  await page.locator(".cm-content").fill("結果不明の下書き");
  await page.locator("#save-issue").click();
  await expect(page.locator("#detail-error")).toContainText("管理者");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#recover-edit")).toBeDisabled();
  await page.locator(".cm-content").fill("追加の入力は保持");
  await expect(page.locator("#detail-body")).toHaveValue("追加の入力は保持");
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(0);
});
test("confirmed save stays saved when following GET fails; removed Issue retains draft", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  await page.route("**/api/board", (route) =>
    s.posts()
      ? route.abort("connectionreset")
      : route.fulfill({ json: s.board }),
  );
  await page.locator(".cm-content").fill("保存する本文");
  await page.locator("#save-issue").click();
  await expect(page.locator("#detail-sync")).toContainText(
    "保存しました。ボードの再同期",
  );
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator(".cm-content").fill("消さない下書き");
  s.board.tasks = s.board.tasks.filter((i) => i.id !== "t0-0-0");
  await page.route("**/api/board", (route) => route.fulfill({ json: s.board }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#detail-sync")).toContainText(
    "表示範囲から外れています",
    { timeout: 8000 },
  );
  await expect(page.locator("#detail-body")).toHaveValue("消さない下書き");
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(s.posts()).toBe(1);
});
test("cached data can be edited while fresh confirmation waits without overwriting the draft", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  let release;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (route) => {
    await gate;
    await route.fulfill({ json: s.board });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.locator(".cm-content").fill("確認中に入力");
  await page.locator("#save-issue").click();
  await expect(page.locator("#detail-sync")).toContainText("保存前");
  await page.locator(".cm-content").fill("確認中にも続けて入力");
  expect(s.posts()).toBe(0);
  release();
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#detail-body")).toHaveValue(
    "確認中にも続けて入力",
  );
  await expect(page.locator("#detail-sync")).toContainText("保存しました");
});
test("CRLF original stays clean and title-only save does not rewrite Markdown", async ({
  page,
}) => {
  const s = await setup(page);
  const original = "## 日本語\r\n\r\n- [ ] 原文\r\n";
  s.board.tasks[0].body = original;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#connection")).not.toContainText("同期中");
  await open(page);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.locator("#rename-issue").click();
  await page.locator("#detail-title").fill("タイトルのみ変更");
  const request = page.waitForRequest((r) => r.method() === "POST");
  await page.locator("#save-issue").click();
  const payload = (await request).postDataJSON();
  expect(payload.title).toBe("タイトルのみ変更");
  expect(payload).not.toHaveProperty("body");
  await expect.poll(s.posts).toBe(1);
  expect(s.board.tasks[0].body).toBe(original);
});
test("accepted close cancels preflight immediately even when GET returns inside the close animation", async ({
  page,
}) => {
  const s = await setup(page);
  await open(page);
  let release;
  let started = false;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/board", async (route) => {
    started = true;
    await gate;
    await route.fulfill({ json: s.board });
  });
  await page.locator(".cm-content").fill("保存を取り消す");
  await page.locator("#save-issue").click();
  await expect.poll(() => started).toBe(true);
  page.once("dialog", async (d) => {
    await d.accept();
    release();
  });
  await page.locator("#close-detail").click();
  await page.locator("#details").waitFor({ state: "hidden" });
  expect(s.posts()).toBe(0);
  await open(page);
  await page.locator(".cm-content").fill("次の編集は正常");
  await page.locator("#save-issue").click();
  await expect.poll(s.posts).toBe(1);
  await expect(page.locator("#detail-sync")).toContainText("保存しました");
});
test("late editor bundle never replaces a focused native draft or its caret and undo", async ({
  page,
}) => {
  let release;
  const gate = new Promise<void>((r) => (release = r));
  let arrived = false;
  await page.route("**/editor-bundle.js", async (route) => {
    await gate;
    await route.continue();
    arrived = true;
  });
  const s = await setup(page);
  await page.locator(".task-title").first().click();
  const input = page.locator("#detail-body");
  await expect(input).toBeVisible();
  await input.fill("日本語の下書き");
  await input.evaluate((e: HTMLTextAreaElement) => e.setSelectionRange(3, 3));
  release();
  await expect.poll(() => arrived).toBe(true);
  await expect(page.locator("#markdown-preview")).toBeEnabled();
  await expect(input).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.keyboard.insertText("追加");
  await expect(input).toHaveValue("日本語追加の下書き");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(input).toHaveValue("日本語の下書き");
  expect(s.posts()).toBe(0);
});
