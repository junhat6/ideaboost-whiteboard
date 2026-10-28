import { test, expect } from "@playwright/test";
import { setup, fillEditor } from "./fixtures";

test("Issue状態は詳細だけに表示し、Project Statusから推測せず追加GETしない", async ({
  page,
}) => {
  const f = await setup(page);
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
  await page.reload();
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  const reads = f.reads();
  let stateReads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/api\/issues\/\d+$/.test(request.url()))
      stateReads++;
  });
  await expect(page.locator("#board .issue-state")).toHaveCount(0);
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#issue-state")).toHaveText("Open");
  await expect(page.locator("#issue-state svg")).toHaveCount(1);
  await expect(page.locator("#issue-state")).toHaveCSS(
    "color",
    "rgb(26, 127, 55)",
  );
  await expect(page.locator("#close-issue")).toBeEnabled();
  await page.locator("#close-detail").click();
  await page.locator('[data-open="t0-0-1"]').click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  await expect(page.locator("#issue-state")).toHaveCSS(
    "color",
    "rgb(130, 80, 223)",
  );
  await expect(page.locator("#detail-status")).toHaveValue("作業中");
  await expect(page.locator("#close-issue")).toBeHidden();
  await page.screenshot({
    path: `test-results/issue-state-${page.viewportSize()!.width}.png`,
    animations: "disabled", // Static state evidence, not the drawer entrance midpoint.
  });
  await page.locator("#close-detail").click();
  await page.locator('[data-open="t0-0-2"]').click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 見送り");
  await expect(page.locator("#close-issue")).toBeHidden();
  await page.locator("#close-detail").click();
  await page.locator('[data-open="t0-0-3"]').click();
  await expect(page.locator("#issue-state")).toHaveText("状態未確認");
  await expect(page.locator("#close-issue")).toBeHidden();
  await page.locator("#close-detail").click();
  await page.locator(".pbi-title").first().click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 重複");
  await expect(page.locator("#close-issue")).toBeHidden();
  expect(f.reads()).toBe(reads);
  expect(stateReads).toBe(0);
  expect(f.posts()).toBe(0);
});

test("明示closeは本文/title/Statusを便乗保存せずcanonical stateだけ更新する", async ({
  page,
}) => {
  const f = await setup(page),
    payloads: any[] = [];
  await page.route("**/api/issues/100", async (r) => {
    payloads.push(r.request().postDataJSON());
    Object.assign(f.board.tasks[0], {
      state: "CLOSED",
      stateReason: "COMPLETED",
      revision: "2026-10-28T01:00:00Z",
    });
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await fillEditor(page, "クローズしても本文は未保存のまま保持");
  await page.locator("#close-issue").click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  await expect(page.locator("#close-issue")).toBeHidden();
  expect(payloads).toHaveLength(1);
  expect(payloads[0].close).toBe(true);
  expect(payloads[0].expectedState).toBe("OPEN");
  expect(payloads[0].expectedStateReason).toBe(null);
  for (const field of [
    "body",
    "title",
    "status",
    "assignees",
    "storyPoints",
    "estimateHours",
    "state",
  ])
    expect(payloads[0]).not.toHaveProperty(field);
  await expect(page.locator("#detail-status")).toHaveValue("未整理");
  await expect(page.locator(".cm-content")).toHaveText(
    "クローズしても本文は未保存のまま保持",
  );
  await expect(page.locator("#save-issue")).toBeEnabled();
});

test("遅いclose中もdrawerを閉じられ、別Issueの逆順ACKと二重clickを混ぜない", async ({
  page,
}) => {
  const f = await setup(page),
    posts: number[] = [],
    releases = new Map<number, () => void>();
  await page.route(/\/api\/issues\/(100|101)$/, async (r) => {
    const number = Number(new URL(r.request().url()).pathname.split("/").pop());
    posts.push(number);
    await new Promise<void>((resolve) => releases.set(number, resolve));
    const item = f.board.tasks.find((t) => t.number === number)!;
    Object.assign(item, {
      state: "CLOSED",
      stateReason: "COMPLETED",
      revision: `2026-10-28T01:00:${number - 100}0Z`,
    });
    return r.fulfill({ json: { ok: true, issue: item } });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.locator("#close-issue").click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator("#close-issue")).toBeDisabled();
  await page
    .locator("#close-issue")
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(posts).toEqual([100]);
  await page.locator("#close-detail").click();
  await expect(page.locator("#details")).not.toBeVisible();
  await page.locator('[data-open="t0-0-1"]').click();
  await expect(page.locator("#issue-state")).toHaveText("Open");
  await page.locator("#close-issue").click();
  await expect.poll(() => posts.length).toBe(2);
  releases.get(101)!();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  releases.get(100)!();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[0].state,
      ),
    )
    .toBe("CLOSED");
  await expect(page.locator("#detail-meta")).toContainText("101");
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  expect(posts).toEqual([100, 101]);
});

test("metadata保存中はcloseを送らず、ACK後の新revisionで明示closeする", async ({
  page,
}) => {
  const f = await setup(page),
    posts: any[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/issues/100", async (r) => {
    const patch = r.request().postDataJSON();
    posts.push(patch);
    if (posts.length === 1) await gate;
    Object.assign(f.board.tasks[0], {
      ...(patch.close
        ? { state: "CLOSED", stateReason: "COMPLETED" }
        : { status: patch.status }),
      revision: `2026-10-28T02:00:0${posts.length}Z`,
    });
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.getByRole("button", { name: "作業中", exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator("#close-issue")).toBeDisabled();
  await page
    .locator("#close-issue")
    .evaluate((button: HTMLButtonElement) => button.click());
  expect(posts).toHaveLength(1);
  release();
  await expect(page.locator("#close-issue")).toBeEnabled();
  await page.locator("#close-issue").click();
  await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
  expect(posts).toHaveLength(2);
  expect(posts[1].close).toBe(true);
  expect(posts[1]).not.toHaveProperty("status");
  expect(posts[1].expectedRevision).toBe("2026-10-28T02:00:01Z");
  expect(posts[1].expectedStatus).toBe("作業中");
});

for (const uncertain of [false, true])
  test(`close失敗後は自動再送せず、結果不明=${uncertain}を区別する`, async ({
    page,
  }) => {
    const f = await setup(page),
      posts: any[] = [];
    await page.route("**/api/issues/100", async (r) => {
      posts.push(r.request().postDataJSON());
      if (posts.length === 1)
        return r.fulfill({
          status: 502,
          json: {
            ok: false,
            error: "github_error",
            ambiguous: uncertain,
            partial: false,
            issue: f.board.tasks[0],
          },
        });
      Object.assign(f.board.tasks[0], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
    });
    await page.locator('[data-open="t0-0-0"]').click();
    await page.locator("#close-issue").click();
    await expect(page.locator("#recover-edit")).toBeEnabled();
    await expect(page.locator("#close-issue")).toBeDisabled();
    await page.locator("#recover-edit").click();
    expect(posts).toHaveLength(1);
    await expect(page.locator("#save-issue")).toBeDisabled();
    if (uncertain) {
      await expect(page.locator("#close-issue")).toBeDisabled();
      await expect(page.locator("#detail-error")).toContainText("結果が不明");
    } else {
      await expect(page.locator("#close-issue")).toHaveText("クローズを再試行");
      await expect(page.locator("#close-issue")).toBeEnabled();
      await page.locator("#close-issue").click();
      await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
      expect(posts).toHaveLength(2);
      expect(posts[1].requestId).not.toBe(posts[0].requestId);
      expect(posts[1]).not.toHaveProperty("status");
    }
  });

test("closeの200応答でもClosed未確認なら結果不明として再送を止める", async ({
  page,
}) => {
  const f = await setup(page);
  let posts = 0;
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.locator("#close-issue").click();
  await expect(page.locator("#recover-edit")).toBeEnabled();
  await page.locator("#recover-edit").click();
  await expect(page.locator("#close-issue")).toBeDisabled();
  await expect(page.locator("#detail-error")).toContainText("結果が不明");
  await expect(page.locator("#issue-state")).toHaveText("Open");
  expect(posts).toBe(1);
});

test("close送信中のscope失効はhidden DOMも消去し、遅いACKで復活しない", async ({
  page,
}) => {
  const f = await setup(page);
  let release!: () => void,
    posted = false;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/issues/100", async (r) => {
    posted = true;
    await gate;
    return r.fulfill({
      json: {
        ok: true,
        issue: {
          ...f.board.tasks[0],
          state: "CLOSED",
          stateReason: "COMPLETED",
        },
      },
    });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await expect(page.locator("#issue-state")).toHaveText("Open");
  await page.locator("#close-issue").click();
  await expect.poll(() => posted).toBe(true);
  await page.route("**/api/board**", (r) =>
    r.fulfill({
      status: 403,
      json: {
        error: "scope_not_public",
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#details")).not.toBeVisible();
  await expect(page.locator("#issue-state")).toBeEmpty();
  await expect(page.locator("#issue-state")).toHaveAttribute(
    "aria-label",
    "GitHub Issueの状態",
  );
  expect(
    await page.locator("#issue-state").getAttribute("data-state-key"),
  ).toBe(null);
  const ack = page.waitForResponse((r) => r.url().endsWith("/api/issues/100"));
  release();
  await ack;
  await page.waitForTimeout(100);
  await expect(page.locator("#issue-state")).toBeEmpty();
  await expect(page.locator("#close-issue")).toBeHidden();
  await expect(page.locator(".pbi-title")).toHaveCount(0);
});

test("closeの遅いACKは失効した時間fieldを復活させない", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const f = await setup(page);
  // Passive evidence only: preserve the original immediate click timing.
  await page.addInitScript(() => {
    const trace: unknown[] = [];
    (window as any).__closeClickTrace = trace;
    for (const type of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ])
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as Element;
          if (!target?.closest?.("#details") || trace.length >= 60) return;
          const button = document.querySelector(
            "#close-issue",
          ) as HTMLButtonElement;
          const drawer = document.querySelector(
            "#details",
          ) as HTMLDialogElement;
          trace.push({
            type,
            at: performance.now(),
            target: target.tagName,
            targetId: target.id,
            closeTarget: !!target.closest("#close-issue"),
            clientX: (event as MouseEvent).clientX,
            clientY: (event as MouseEvent).clientY,
            trusted: event.isTrusted,
            disabled: button.disabled,
            text: button.textContent,
            open: drawer.open,
            closing: drawer.classList.contains("closing"),
            composer: !!document.querySelector(".cm-content"),
            hoursVisible: !(
              document.querySelector("#estimate-hours-editor") as HTMLElement
            ).hidden,
            rect: button.getBoundingClientRect().toJSON(),
          });
        },
        true,
      );
  });
  (f.board.scope as any).estimateHoursField = true;
  (f.board.tasks[0] as any).estimateHours = 4;
  let release!: () => void,
    posted = false;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/issues/100", async (r) => {
    const result = {
      ...f.board.tasks[0],
      state: "CLOSED",
      stateReason: "COMPLETED",
    };
    posted = true;
    await gate;
    Object.assign(f.board.tasks[0], {
      state: "CLOSED",
      stateReason: "COMPLETED",
    });
    return r.fulfill({ json: { ok: true, issue: result } });
  });
  await page.reload();
  try {
    await page.locator('[data-open="t0-0-0"]').click();
    await page.locator("#close-issue").click();
    await expect.poll(() => posted).toBe(true);
    (f.board.scope as any).estimateHoursField = false;
    delete (f.board.tasks[0] as any).estimateHours;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator("#estimate-hours-editor")).toBeHidden();
    release();
    await expect(page.locator("#issue-state")).toHaveText("Closed · 完了");
    await expect(page.locator("#estimate-hours-editor")).toBeHidden();
    expect(
      await page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[0].estimateHours,
      ),
    ).toBeUndefined();
  } finally {
    console.log(
      "close-click-diagnostic",
      JSON.stringify({
        viewport: page.viewportSize(),
        posted,
        errors,
        state: await page
          .evaluate(() => ({
            events: (window as any).__closeClickTrace,
            open: (document.querySelector("#details") as HTMLDialogElement)
              .open,
            disabled: (
              document.querySelector("#close-issue") as HTMLButtonElement
            ).disabled,
            badge: document.querySelector("#issue-state")?.textContent,
            error: document.querySelector("#detail-error")?.textContent,
            composer: !!document.querySelector(".cm-content"),
          }))
          .catch(() => null),
      }),
    );
    release();
  }
});

test("editor bundle読込中も明示closeを一度だけ送り、閉じたdrawerを復活させない", async ({
  page,
}) => {
  let releaseEditor!: () => void,
    releaseSave!: () => void,
    editorRequests = 0;
  const editorGate = new Promise<void>((resolve) => (releaseEditor = resolve));
  const saveGate = new Promise<void>((resolve) => (releaseSave = resolve));
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/editor-bundle.js", async (route) => {
    editorRequests++;
    await editorGate;
    return route.continue();
  });
  try {
    const f = await setup(page);
    const originalBody = f.board.tasks[0].body;
    await page.route("**/api/issues/100", async (route) => {
      payloads.push(route.request().postDataJSON());
      await saveGate;
      Object.assign(f.board.tasks[0], {
        state: "CLOSED",
        stateReason: "COMPLETED",
        revision: "2026-10-28T03:00:00Z",
      });
      return route.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
    });
    await page.locator('[data-open="t0-0-0"]').click();
    await expect.poll(() => editorRequests).toBe(1);
    await expect(page.locator(".cm-content")).toHaveCount(0);
    await expect(page.locator("#detail-body")).toBeVisible();
    await page.locator("#detail-body").fill("遅延読込中の本文も便乗保存しない");
    await expect(page.locator("#close-issue")).toBeEnabled();
    await page.locator("#close-issue").click();
    await expect.poll(() => payloads.length).toBe(1);
    await expect(page.locator("#close-issue")).toBeDisabled();
    expect(payloads[0].close).toBe(true);
    expect(payloads[0].expectedState).toBe("OPEN");
    for (const field of [
      "body",
      "title",
      "status",
      "assignees",
      "storyPoints",
      "estimateHours",
    ])
      expect(payloads[0]).not.toHaveProperty(field);
    expect(f.board.tasks[0].body).toBe(originalBody);

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#close-detail").click();
    await expect(page.locator("#details")).not.toBeVisible();
    releaseEditor();
    // Await the same module's evaluation, not a timeout or a second UI click.
    await page.evaluate(async () => {
      await import(/* @vite-ignore */ "/editor-bundle.js");
    });
    await expect(page.locator("#details")).not.toBeVisible();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    releaseSave();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).Whiteboard.getSnapshot().tasks[0].state,
        ),
      )
      .toBe("CLOSED");
    await expect(page.locator("#details")).not.toBeVisible();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    expect(payloads).toHaveLength(1);
    expect(editorRequests).toBe(1);
    expect(f.board.tasks[0].body).toBe(originalBody);
  } finally {
    releaseEditor();
    releaseSave();
  }
});
