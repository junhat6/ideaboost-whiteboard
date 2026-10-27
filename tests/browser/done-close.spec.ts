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
