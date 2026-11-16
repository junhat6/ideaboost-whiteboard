import { test, expect, type Page } from "@playwright/test";
import { snapshot } from "./fixtures";

// 合成データのみ。Close済みPBIは既定のopen-onlyボードから外れるが、
// スプリントレビューのために利用者が明示した時だけ候補へ戻せることを守る。
function boards() {
  const open = snapshot();
  const closedLane = {
    ...structuredClone(open.lanes[0]),
    id: "closed1",
    nodeId: "closed1",
    number: 90,
    url: "https://github.com/engineer-first/idea-boost/issues/90",
    title: "スプリントで完了した成果を振り返る",
    state: "CLOSED",
    stateReason: "COMPLETED",
  };
  const closedTasks = open.tasks
    .filter((task) => task.lane === "p0")
    .map((task, index) => ({
      ...structuredClone(task),
      id: `closed-task-${index}`,
      nodeId: `closed-task-${index}`,
      number: 900 + index,
      lane: "closed1",
      status: "完了",
    }));
  const withClosed = {
    ...structuredClone(open),
    // Project order: the closed PBI stays where GitHub placed it.
    lanes: [closedLane, ...structuredClone(open.lanes)],
    tasks: [...structuredClone(open.tasks), ...closedTasks],
    scope: {
      ...open.scope,
      recentClosed: { days: 28, filter: "type:PBI is:closed" },
    },
  };
  return { open, withClosed };
}

async function start(page: Page) {
  const reads: string[] = [];
  const { open, withClosed } = boards();
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"/>',
    }),
  );
  await page.route("**/api/**", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() !== "GET")
      return route.fulfill({ status: 403, json: { error: "no_writes" } });
    reads.push(url.pathname + url.search);
    if (url.pathname === "/api/health")
      return route.fulfill({ json: { configured: true, accessMode: "team" } });
    if (url.pathname === "/api/board")
      return route.fulfill({
        json: url.searchParams.get("closed") === "recent" ? withClosed : open,
      });
    if (url.pathname === "/api/current-sprint")
      return route.fulfill({
        json: {
          ok: true,
          status: "none",
          currentSprint: null,
          checkedAt: new Date().toISOString(),
        },
      });
    return route.fulfill({ status: 404, json: { error: "unexpected" } });
  });
  await page.goto("/");
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  return reads;
}

async function openPicker(page: Page) {
  if (
    (await page.locator("#operations").getAttribute("aria-expanded")) !== "true"
  )
    await page.locator("#operations").click();
  await page.locator("#choose-pbis").click();
  await expect(page.locator("#pbi-picker")).toBeVisible();
}

const closedOption = (page: Page) =>
  page.locator('#pbi-options [data-select-pbi="closed1"]');

test("Close済みPBIは明示opt-inで候補に戻り、ボードで区別され、設定はブラウザーに残る", async ({
  page,
}) => {
  const reads = await start(page);
  expect(reads.some((path) => path.includes("closed="))).toBe(false);
  await expect(page.locator('[data-pbi-row="closed1"]')).toHaveCount(0);

  await openPicker(page);
  await expect(closedOption(page)).toHaveCount(0);
  const toggle = page.locator("#pbi-include-closed");
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  // The picker stays open with the current draft while the closed rows load.
  await expect(closedOption(page)).toBeVisible();
  expect(reads).toContain("/api/board?closed=recent");
  await expect(toggle).toBeChecked();
  await expect(page.locator("#pbi-closed-note")).toContainText("Close済み 1件");
  await expect(
    page.locator('#pbi-options .pbi-option:has([data-select-pbi="closed1"])'),
  ).toContainText("Close済み");

  await closedOption(page).check();
  await page.locator("#pbi-apply").click();
  await expect(page.locator("#pbi-picker")).toBeHidden();
  const row = page.locator('.pbi-cell[data-pbi-row="closed1"]');
  await expect(row).toHaveClass(/is-closed/);
  await expect(row.locator(".pbi-closed-label")).toHaveText("Close済み");

  // Reload keeps the opt-in and reads closed rows again; no extra stale rows.
  reads.length = 0;
  await page.reload();
  await expect(page.locator("#board")).toHaveAttribute("aria-busy", "false");
  await expect(row).toBeVisible();
  expect(reads).toContain("/api/board?closed=recent");

  // Opting out returns to the open-only read; the selection is kept as out of range.
  await openPicker(page);
  await toggle.uncheck();
  await expect(closedOption(page)).toHaveCount(0);
  await expect(page.locator("#pbi-missing")).toContainText("closed1");
  await page.locator("#pbi-cancel").click();
  await expect(row).toHaveCount(0);
});
