import { test, expect, type Page } from "@playwright/test";
import { setup } from "./fixtures";
const card = (page: Page, id: string) => page.locator(`[data-task="${id}"]`);
const cell = (page: Page, status: string, lane = "p0") =>
  page.locator(`[data-lane="${lane}"][data-status="${status}"]`);
async function nativeMove(page: Page, id: string, status: string) {
  // Real mouse/native HTML drag, not dispatchEvent or injected app methods.
  await card(page, id).dragTo(cell(page, status));
}
for (const phase of ["first-post", "after-ack-get"] as const)
  test(`別Issueの2枚目は${phase}保留中もnative dragで移動できる`, async ({
    page,
  }) => {
    const f = await setup(page);
    let release!: () => void,
      posts = 0,
      refreshStarted = false;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.evaluate(() => {
      (window as any).__dragEvents = [];
      for (const type of ["dragstart", "drop", "dragend"])
        document.addEventListener(type, (e) => {
          (window as any).__dragEvents.push({
            type,
            id:
              (e.target as Element)
                ?.closest("[data-task]")
                ?.getAttribute("data-task") || null,
          });
        });
    });
    await page.route("**/api/issues/*", async (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const index = ++posts,
        patch = r.request().postDataJSON();
      const target = f.board.tasks.find(
        (t) =>
          t.number ===
          Number(new URL(r.request().url()).pathname.split("/").pop()),
      )!;
      if (index === 1 && phase === "first-post") await gate;
      Object.assign(target, patch, { revision: `2026-10-28T00:00:0${index}Z` });
      return r.fulfill({ json: { ok: true, issue: target } });
    });
    if (phase === "after-ack-get")
      await page.route("**/api/board", async (r) => {
        refreshStarted = true;
        await gate;
        return r.fulfill({ json: f.board });
      });
    try {
      await nativeMove(page, "t0-0-0", "Doing");
      await expect.poll(() => posts).toBe(1);
      if (phase === "after-ack-get")
        await expect.poll(() => refreshStarted).toBe(true);
      const secondDraggable = await card(page, "t0-0-1").getAttribute(
        "draggable",
      );
      await nativeMove(page, "t0-0-1", "Wait");
      console.log(
        JSON.stringify({
          metric: "second-native-drag",
          phase,
          width: page.viewportSize()!.width,
          secondDraggable,
          posts,
          events: await page.evaluate(() => (window as any).__dragEvents),
        }),
      );
      await expect.poll(() => posts).toBe(2);
      await expect(
        cell(page, "Wait").locator('[data-task="t0-0-1"]'),
      ).toHaveCount(1);
    } finally {
      release();
    }
  });
