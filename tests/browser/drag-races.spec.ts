import { test, expect, type Page } from "@playwright/test";
import { setup, chooseToolbarOption } from "./fixtures";
const card = (page: Page, id = "t0-0-0") => page.locator(`[data-task="${id}"]`);
const cell = (page: Page, status: string) =>
  page.locator(`[data-lane="p0"][data-status="${status}"]`);
const deferred = () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  return { wait, release };
};
async function ready(page: Page) {
  const f = await setup(page);
  f.board.tasks = f.board.tasks.filter(
    (t) => t.lane !== "p0" || ["t0-0-0", "t0-0-1"].includes(t.id),
  );
  (f.board.scope as any).estimateHoursField = true;
  for (const t of f.board.tasks)
    Object.assign(t, {
      estimateHours: null,
      subIssueCount: 0,
      parentId: t.lane,
      fingerprint: `before-${t.id}`,
    });
  await page.reload();
  await expect(card(page)).toHaveAttribute("draggable", "true");
  return f;
}
async function beginDrag(page: Page, id: string) {
  const b = await card(page, id).boundingBox();
  await page.mouse.move(b!.x + 3, b!.y + 3);
  await page.mouse.down();
  await page.mouse.move(b!.x + 28, b!.y + 24, { steps: 5 });
  await expect(card(page, id)).toHaveClass(/dragging/);
}
async function drop(page: Page, status: string) {
  const b = await cell(page, status).boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, {
    steps: 5,
  });
  await page.mouse.move(b!.x + b!.width / 2 + 1, b!.y + b!.height / 2);
  await page.mouse.up();
}

test("同Issueだけ保存中を止め、ACK直後はGET待ちでも新revisionで連続移動できる", async ({
  page,
}) => {
  const f = await ready(page),
    first = deferred(),
    read = deferred();
  const patches: any[] = [];
  let reads = 0;
  await page.route("**/api/board", async (r) => {
    reads++;
    await read.wait;
    return r.fulfill({ json: f.board });
  });
  await page.route("**/api/issues/100", async (r) => {
    const p = r.request().postDataJSON();
    patches.push(p);
    const n = patches.length;
    if (n === 1) await first.wait;
    Object.assign(f.board.tasks[0], p, {
      revision: `saved-${n}`,
      fingerprint: `canonical-${n}`,
    });
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  try {
    await card(page).dragTo(cell(page, "Doing"));
    await expect.poll(() => patches.length).toBe(1);
    await expect(card(page)).toHaveAttribute("draggable", "false");
    await expect(card(page)).toHaveAttribute("aria-busy", "true");
    await expect(card(page, "t0-0-1")).toHaveAttribute("draggable", "true");
    first.release();
    await expect.poll(() => reads).toBe(1);
    await expect(card(page)).toHaveAttribute("draggable", "true");
    await card(page).dragTo(cell(page, "Wait"));
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[1]).toMatchObject({
      expectedRevision: "saved-1",
      expectedFingerprint: "canonical-1",
      expectedStatus: "作業中",
      status: "レビュー中",
    });
    await expect(
      cell(page, "Wait").locator('[data-task="t0-0-0"]'),
    ).toHaveCount(1);
  } finally {
    first.release();
    read.release();
  }
});

test("先行GETが別Issueの保存中に返っても楽観位置やACKを巻き戻さない", async ({
  page,
}) => {
  const f = await ready(page),
    oldRead = deferred(),
    second = deferred();
  let reads = 0,
    posts = 0;
  const old = structuredClone(f.board);
  await page.route("**/api/board", async (r) => {
    if (++reads === 1) {
      await oldRead.wait;
      return r.fulfill({ json: old });
    }
    return r.fulfill({ json: f.board });
  });
  await page.route("**/api/issues/*", async (r) => {
    if (r.request().method() !== "POST") return r.fallback();
    const n = ++posts,
      p = r.request().postDataJSON(),
      t = f.board.tasks.find(
        (t) =>
          t.number ===
          Number(new URL(r.request().url()).pathname.split("/").pop()),
      )!;
    if (n === 2) await second.wait;
    Object.assign(t, p, { revision: `saved-${n}` });
    return r.fulfill({ json: { ok: true, issue: t } });
  });
  try {
    await card(page).dragTo(cell(page, "Doing"));
    await expect.poll(() => reads).toBe(1);
    await card(page, "t0-0-1").dragTo(cell(page, "Wait"));
    await expect.poll(() => posts).toBe(2);
    oldRead.release();
    await expect(page.locator("#refresh")).toBeEnabled();
    await expect(
      cell(page, "Doing").locator('[data-task="t0-0-0"]'),
    ).toHaveCount(1);
    await expect(
      cell(page, "Wait").locator('[data-task="t0-0-1"]'),
    ).toHaveCount(1);
    await expect(card(page, "t0-0-1")).toHaveAttribute("draggable", "false");
    second.release();
    await expect(card(page, "t0-0-1")).toHaveAttribute("draggable", "true");
    await expect.poll(() => reads, { timeout: 10000 }).toBe(2);
    await expect(
      cell(page, "Wait").locator('[data-task="t0-0-1"]'),
    ).toHaveCount(1);
    expect(posts).toBe(2);
  } finally {
    oldRead.release();
    second.release();
  }
});

for (const arrival of ["ack", "get"] as const)
  test(`別Issue native gesture中の${arrival}でDOMを差し替えずdropまで維持`, async ({
    page,
  }) => {
    const f = await ready(page),
      gate = deferred();
    let posts = 0,
      reads = 0;
    await page.route("**/api/issues/*", async (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const n = ++posts,
        p = r.request().postDataJSON(),
        t = f.board.tasks.find(
          (t) =>
            t.number ===
            Number(new URL(r.request().url()).pathname.split("/").pop()),
        )!;
      if (n === 1 && arrival === "ack") await gate.wait;
      Object.assign(t, p, { revision: `saved-${n}` });
      return r.fulfill({ json: { ok: true, issue: t } });
    });
    await page.route("**/api/board", async (r) => {
      reads++;
      if (arrival === "get") await gate.wait;
      return r.fulfill({ json: f.board });
    });
    try {
      await card(page).dragTo(cell(page, "Doing"));
      await expect.poll(() => posts).toBe(1);
      if (arrival === "get") await expect.poll(() => reads).toBe(1);
      await beginDrag(page, "t0-0-1");
      await page.evaluate(() => {
        (window as any).__dragNode = document.querySelector(
          '[data-task="t0-0-1"]',
        );
      });
      const response = page.waitForResponse(
        (r) =>
          r
            .url()
            .includes(arrival === "ack" ? "/api/issues/100" : "/api/board") &&
          r.status() === 200,
      );
      gate.release();
      await response;
      if (arrival === "ack")
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (window as any).Whiteboard.getSnapshot().tasks.find(
                  (t: any) => t.id === "t0-0-0",
                )?.revision,
            ),
          )
          .toBe("saved-1");
      else await expect(page.locator("#refresh")).toBeEnabled();
      await expect(card(page, "t0-0-1")).toHaveClass(/dragging/);
      expect(
        await page.evaluate(
          () =>
            document.querySelector('[data-task="t0-0-1"]') ===
            (window as any).__dragNode,
        ),
      ).toBe(true);
      await drop(page, "Wait");
      await expect.poll(() => posts).toBe(2);
      await expect(
        cell(page, "Wait").locator('[data-task="t0-0-1"]'),
      ).toHaveCount(1);
      await expect(page.locator(".dragging,.drag-over")).toHaveCount(0);
    } finally {
      gate.release();
      await page.mouse.up();
    }
  });

for (const uncertain of [false, true])
  test(`1枚の失敗はそのIssueだけ保持し他Issueの逆順ACKを戻さず再送しない ${uncertain}`, async ({
    page,
  }) => {
    const f = await ready(page),
      first = deferred();
    let posts = 0;
    await page.route("**/api/issues/*", async (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      posts++;
      const n = Number(new URL(r.request().url()).pathname.split("/").pop());
      if (n === 100) {
        await first.wait;
        return r.fulfill({
          status: uncertain ? 503 : 409,
          json: {
            error: uncertain ? "mutation_outcome_unresolved" : "conflict",
            ambiguous: uncertain,
          },
        });
      }
      const t = f.board.tasks.find((t) => t.number === n)!;
      Object.assign(t, r.request().postDataJSON(), { revision: "second-ack" });
      return r.fulfill({ json: { ok: true, issue: t } });
    });
    try {
      await card(page).dragTo(cell(page, "Done"));
      await expect.poll(() => posts).toBe(1);
      await card(page, "t0-0-1").dragTo(cell(page, "Wait"));
      await expect.poll(() => posts).toBe(2);
      first.release();
      await expect(page.locator("#save-problems")).toBeVisible();
      await expect(
        cell(page, "ToDo").locator('[data-task="t0-0-0"]'),
      ).toHaveCount(1);
      await expect(
        cell(page, "Wait").locator('[data-task="t0-0-1"]'),
      ).toHaveCount(1);
      await expect(card(page)).toHaveAttribute("draggable", "false");
      await card(page, "t0-0-1").dragTo(cell(page, "Doing"));
      await expect.poll(() => posts).toBe(3);
      await page.locator("#save-problems button").click();
      await expect(page.locator("#detail-error")).toBeVisible();
      if (uncertain) await expect(page.locator("#recover-edit")).toBeDisabled();
      expect(posts).toBe(3);
    } finally {
      first.release();
    }
  });

test("公開失効→再接続後の遅いdrag ACKは新しいboardや見積を上書きしない", async ({
  page,
}) => {
  const f = await ready(page),
    privacy = deferred(),
    save = deferred();
  let reads = 0,
    posts = 0;
  const old = {
    ...structuredClone(f.board.tasks[0]),
    title: "旧応答のタイトル",
    estimateHours: 99,
    status: "作業中",
    revision: "old-ack",
  };
  await page.route("**/api/current-sprint", async (r) => {
    if (++reads === 1) {
      await privacy.wait;
      return r.fulfill({ status: 403, json: { error: "scope_not_public" } });
    }
    return r.fulfill({
      json: {
        ok: true,
        status: "none",
        currentSprint: null,
        checkedAt: new Date().toISOString(),
      },
    });
  });
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    await save.wait;
    return r.fulfill({ json: { ok: true, issue: old } });
  });
  await page.reload();
  await expect.poll(() => reads).toBe(1);
  try {
    await card(page).dragTo(cell(page, "Doing"));
    await expect.poll(() => posts).toBe(1);
    privacy.release();
    await expect(page.locator(".pbi-title")).toHaveCount(0);
    f.board.tasks[0].title = "再接続した新しいタイトル";
    f.board.tasks[0].revision = "reconnected";
    (f.board.scope as any).estimateHoursField = false;
    for (const t of f.board.tasks) delete (t as any).estimateHours;
    await page.locator("#retry-load").click();
    await expect(card(page).locator(".task-title")).toHaveText(
      "再接続した新しいタイトル",
    );
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/api/issues/100") && r.status() === 200,
    );
    save.release();
    await response;
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    );
    await expect(card(page).locator(".task-title")).toHaveText(
      "再接続した新しいタイトル",
    );
    await expect(card(page).locator(".task-estimate")).toHaveText("—");
    await expect(
      cell(page, "ToDo").locator('[data-task="t0-0-0"]'),
    ).toHaveCount(1);
    await expect(page.locator("#save-problems")).toBeHidden();
    expect(posts).toBe(1);
  } finally {
    privacy.release();
    save.release();
  }
});

test("drag保存中のfield失効は先行GETでも即時適用し遅いACKから時間を復活させない", async ({
  page,
}) => {
  const f = await ready(page),
    read = deferred(),
    save = deferred();
  let reads = 0,
    posts = 0;
  const revoked = structuredClone(f.board);
  (revoked.scope as any).estimateHoursField = false;
  for (const t of revoked.tasks) delete (t as any).estimateHours;
  const ack = {
    ...structuredClone(f.board.tasks[0]),
    status: "作業中",
    revision: "ack",
    estimateHours: 99,
  };
  await page.route("**/api/board", async (r) => {
    reads++;
    await read.wait;
    return r.fulfill({ json: revoked });
  });
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    await save.wait;
    return r.fulfill({ json: { ok: true, issue: ack } });
  });
  try {
    await page.locator("#operations").click();
    await page.locator("#refresh").click();
    await expect.poll(() => reads).toBe(1);
    await page.locator("#operations").click();
    await card(page).dragTo(cell(page, "Doing"));
    await expect.poll(() => posts).toBe(1);
    read.release();
    await expect(card(page).locator(".task-estimate")).toHaveText("—");
    save.release();
    await expect(card(page)).toHaveAttribute("draggable", "true");
    await expect(card(page).locator(".task-estimate")).toHaveText("—");
    expect(posts).toBe(1);
  } finally {
    read.release();
    save.release();
  }
});

test("明示milestone切替中だけdragを止め、切替後の表示と追従GETのscopeを揃える", async ({
  page,
}) => {
  const f = await ready(page),
    gate = deferred();
  let reads = 0;
  Object.assign(f.board.scope, {
    milestones: [
      { number: 9, title: "Sprint 9" },
      { number: 10, title: "Sprint 10" },
    ],
    selectedMilestone: "9",
  });
  await page.reload();
  await page.route("**/api/board?milestone=10", async (r) => {
    reads++;
    await gate.wait;
    Object.assign(f.board.scope, { selectedMilestone: "10" });
    f.board.lanes[0].title = "Sprint 10 のPBI";
    return r.fulfill({ json: f.board });
  });
  try {
    await page.locator("#operations").click();
    await chooseToolbarOption(page, "milestone-filter", "10");
    await expect.poll(() => reads).toBe(1);
    await expect(card(page)).toHaveAttribute("draggable", "false");
    expect(f.posts()).toBe(0);
    gate.release();
    await expect(page.locator("#milestone-filter")).toHaveValue("10");
    await expect(page.locator(".pbi-title").first()).toHaveText(
      "Sprint 10 のPBI",
    );
    await expect(card(page)).toHaveAttribute("draggable", "true");
    await page.locator("#operations").click();
    await card(page).dragTo(cell(page, "Doing"));
    await expect.poll(f.posts).toBe(1);
    await expect.poll(() => reads).toBe(2);
    await expect(page.locator("#milestone-filter")).toHaveValue("10");
    await expect(page.locator(".pbi-title").first()).toHaveText(
      "Sprint 10 のPBI",
    );
  } finally {
    gate.release();
  }
});

test("非Doneの競合を明示回復したらpollを待たず同Issueを再dragできる", async ({
  page,
}) => {
  const f = await ready(page);
  let posts = 0;
  page.on("dialog", (d) => d.accept());
  await page.route("**/api/issues/100", async (r) => {
    if (++posts === 1)
      return r.fulfill({ status: 409, json: { error: "conflict" } });
    Object.assign(f.board.tasks[0], r.request().postDataJSON(), {
      revision: "recovered",
    });
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  await card(page).dragTo(cell(page, "Doing"));
  await expect(page.locator("#save-problems button")).toBeVisible();
  await expect(card(page)).toHaveAttribute("draggable", "false");
  await page.locator("#save-problems button").click();
  await page.locator("#recover-edit").click();
  await expect(page.locator("#save-problems")).toBeHidden();
  await expect(card(page)).toHaveAttribute("draggable", "true");
  await page.locator("#close-detail").click();
  await card(page).dragTo(cell(page, "Wait"));
  await expect.poll(() => posts).toBe(2);
  await expect(cell(page, "Wait").locator('[data-task="t0-0-0"]')).toHaveCount(
    1,
  );
});

test("editor ACKとmilestone切替GETが競合しても旧選択の明示GETへ戻りscopeを混ぜない", async ({
  page,
}) => {
  const f = await ready(page),
    save = deferred(),
    switchRead = deferred();
  let posts = 0;
  const scopes: string[] = [];
  Object.assign(f.board.scope, {
    milestones: [
      { number: 9, title: "Sprint 9" },
      { number: 10, title: "Sprint 10" },
    ],
    selectedMilestone: "9",
  });
  f.board.lanes[0].title = "Sprint 9 のPBI";
  await page.reload();
  const next = structuredClone(f.board);
  Object.assign(next.scope, { selectedMilestone: "10" });
  next.lanes[0].title = "Sprint 10 のPBI";
  await page.route("**/api/board?milestone=*", async (r) => {
    const m = new URL(r.request().url()).searchParams.get("milestone")!;
    scopes.push(m);
    if (m === "10") {
      await switchRead.wait;
      return r.fulfill({ json: next });
    }
    return r.fulfill({ json: f.board });
  });
  await page.route("**/api/issues/100", async (r) => {
    posts++;
    await save.wait;
    Object.assign(f.board.tasks[0], r.request().postDataJSON(), {
      revision: "editor-ack",
    });
    return r.fulfill({ json: { ok: true, issue: f.board.tasks[0] } });
  });
  try {
    await card(page).locator(".task-title").click();
    await page.getByRole("button", { name: "作業中", exact: true }).click();
    await expect.poll(() => posts).toBe(1);
    await page.locator("#close-detail").click();
    await page.locator("#operations").click();
    await chooseToolbarOption(page, "milestone-filter", "10");
    await expect.poll(() => scopes.length).toBe(1);
    save.release();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).Whiteboard.getSnapshot().tasks.find(
              (t: any) => t.id === "t0-0-0",
            )?.revision,
        ),
      )
      .toBe("editor-ack");
    switchRead.release();
    await expect.poll(() => scopes, { timeout: 10000 }).toEqual(["10", "9"]);
    await expect(page.locator("#milestone-filter")).toHaveValue("9");
    await expect(page.locator(".pbi-title").first()).toHaveText(
      "Sprint 9 のPBI",
    );
    await expect(
      cell(page, "Doing").locator('[data-task="t0-0-0"]'),
    ).toHaveCount(1);
    expect(posts).toBe(1);
  } finally {
    save.release();
    switchRead.release();
  }
});
