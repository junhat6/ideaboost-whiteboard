import { test, expect } from "@playwright/test";
import { setup } from "./fixtures";
test("drag and detail both request Done and retain the canonical closed response without auto-reopen", async ({
  page,
}) => {
  const s = await setup(page);
  const payloads: any[] = [];
  await page.route("**/api/issues/*", async (route) => {
    const data = route.request().postDataJSON();
    payloads.push(data);
    const number = Number(
      new URL(route.request().url()).pathname.split("/").pop(),
    );
    const item = [...s.board.tasks, ...s.board.lanes].find(
      (i) => i.number === number,
    )!;
    Object.assign(item, {
      status: data.status,
      revision: "2026-10-27T01:00:00Z",
    });
    if (data.status === "完了") item.state = "CLOSED";
    await route.fulfill({ json: { ok: true, issue: item } });
  });
  await page
    .locator('[data-task="t0-0-0"]')
    .dragTo(page.locator('[data-lane="p0"][data-status="Done"]'));
  await expect.poll(() => payloads.length).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[0].state,
      ),
    )
    .toBe("CLOSED");
  await page.locator('[data-open="t0-0-1"]').click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.locator("#save-issue").click();
  await expect.poll(() => payloads.length).toBe(2);
  await expect(page.locator("#save-issue")).toBeDisabled();
  await page.getByRole("button", { name: "作業中", exact: true }).click();
  await page.locator("#save-issue").click();
  await expect.poll(() => payloads.length).toBe(3);
  expect(payloads.map((p) => p.status)).toEqual(["完了", "完了", "作業中"]);
  expect(payloads.every((p) => !Object.hasOwn(p, "state"))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).Whiteboard.getSnapshot().tasks[1].state,
      ),
    )
    .toBe("CLOSED");
});

for (const via of ["detail", "drag", "changed-status"])
  test(`known partial close failure via ${via} keeps close intent and explicitly retries only after fresh recovery`, async ({
    page,
  }) => {
    const s = await setup(page);
    let posts = 0;
    const payloads: any[] = [];
    await page.route("**/api/issues/100", async (route) => {
      const data = route.request().postDataJSON();
      payloads.push(data);
      posts++;
      Object.assign(s.board.tasks[0], {
        status: "完了",
        revision: `2026-10-27T02:00:0${posts}Z`,
      });
      if (posts === 1)
        return route.fulfill({
          status: 502,
          json: {
            ok: false,
            error: "github_error",
            partial: true,
            ambiguous: false,
            completed: ["status"],
            issue: s.board.tasks[0],
          },
        });
      Object.assign(s.board.tasks[0], {
        state: "CLOSED",
        stateReason: "COMPLETED",
      });
      return route.fulfill({ json: { ok: true, issue: s.board.tasks[0] } });
    });
    if (via !== "drag") {
      await page.locator('[data-open="t0-0-0"]').click();
      await page.getByRole("button", { name: "完了", exact: true }).click();
      await page.locator("#save-issue").click();
    } else {
      await page
        .locator('[data-task="t0-0-0"]')
        .dragTo(page.locator('[data-lane="p0"][data-status="Done"]'));
      await expect(page.locator("#save-problems button")).toBeVisible();
      await page.locator("#save-problems button").click();
    }
    await expect(page.locator("#recover-edit")).toBeEnabled();
    await page.locator("#recover-edit").click();
    await expect(page.locator("#save-issue")).toHaveText("完了処理を再試行");
    await expect(page.locator("#save-issue")).toBeEnabled();
    expect(posts).toBe(1);
    if (via === "changed-status") {
      await page.getByRole("button", { name: "作業中", exact: true }).click();
      await expect(page.locator("#save-issue")).not.toHaveText("完了処理を再試行");
    }
    await page.locator("#save-issue").click();
    await expect.poll(() => posts).toBe(2);
    expect(payloads[1].status).toBe(via === "changed-status" ? "作業中" : "完了");
    if (via !== "changed-status") expect(payloads[1].expectedState).toBe("OPEN");
    expect(payloads[1].requestId).not.toBe(payloads[0].requestId);
    await expect(page.locator("#save-issue")).toBeDisabled();
    await expect(page.locator("#save-problems")).toBeHidden();
  });

test("unknown close outcome stays blocked after successful GET", async ({
  page,
}) => {
  const s = await setup(page);
  let posts = 0;
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    s.board.tasks[0].status = "完了";
    await route.fulfill({
      status: 502,
      json: {
        ok: false,
        partial: true,
        ambiguous: true,
        error: "github_error",
        issue: s.board.tasks[0],
      },
    });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.locator("#save-issue").click();
  await expect(page.locator("#recover-edit")).toBeEnabled();
  await page.locator("#recover-edit").click();
  await expect(page.locator("#save-issue")).toBeDisabled();
  await expect(page.locator("#detail-error")).toContainText("結果が不明");
  expect(posts).toBe(1);
});

test("fresh confirmation of Done and CLOSED clears a known failure without duplicate close", async ({
  page,
}) => {
  const s = await setup(page);
  let posts = 0;
  await page.route("**/api/issues/100", async (route) => {
    posts++;
    Object.assign(s.board.tasks[0], {
      status: "完了",
      state: "CLOSED",
      stateReason: "COMPLETED",
    });
    await route.fulfill({
      status: 502,
      json: {
        ok: false,
        partial: true,
        ambiguous: false,
        error: "github_error",
        issue: s.board.tasks[0],
      },
    });
  });
  await page.locator('[data-open="t0-0-0"]').click();
  await page.getByRole("button", { name: "完了", exact: true }).click();
  await page.locator("#save-issue").click();
  await expect(page.locator("#recover-edit")).toBeEnabled();
  await page.locator("#recover-edit").click();
  await expect(page.locator("#detail-error")).toBeHidden();
  await expect(page.locator("#save-problems")).toBeHidden();
  await expect(page.locator("#save-issue")).toBeDisabled();
  expect(posts).toBe(1);
});
