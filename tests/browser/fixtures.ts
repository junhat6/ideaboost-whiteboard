import { expect, type Page } from "@playwright/test";
const statuses = ["未整理", "作業中", "レビュー中", "完了"];
export function snapshot() {
  const base = {
    revision: "2026-10-26T00:00:00Z",
    state: "OPEN",
    assignees: [
      {
        login: "tester",
        name: "検証担当者",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      },
    ],
    projectItemId: "item",
    statusEditable: true,
    body: "## ユーザーに提供する体験\n- 原文の **Markdown** を保持する\n\n## 詳細\n本文の全体",
  };
  const lanes = Array.from({ length: 7 }, (_, i) => ({
    ...base,
    id: `p${i}`,
    nodeId: `p${i}`,
    number: i + 1,
    type: "PBI",
    url: `https://github.com/engineer-first/idea-boost/issues/${i + 1}`,
    status: "作業中",
    title: `チームのアイデアを共有して育てる ${i + 1}`,
  }));
  const tasks = lanes.flatMap((l, i) =>
    statuses.flatMap((status, j) =>
      Array.from({ length: j === 0 ? 5 : 4 }, (_, k) => ({
        ...base,
        id: `t${i}-${j}-${k}`,
        nodeId: `t${i}-${j}-${k}`,
        number: 100 + i * 20 + j * 5 + k,
        type: "Task",
        url: `https://github.com/engineer-first/idea-boost/issues/${100 + i * 20 + j * 5 + k}`,
        title: `利用者が投稿したアイデアの内容を確認して、チームへ共有できる ${k + 1}`,
        status,
        lane: l.id,
      })),
    ),
  );
  return {
    lanes,
    tasks,
    assigneeOptions: base.assignees,
    scope: {
      owner: "engineer-first",
      repo: "idea-boost",
      projectNumber: 3,
      viewNumber: 16,
      filterApplied: true,
    },
    fetchedAt: "2026-10-26T00:00:00Z",
  };
}
export async function setup(
  page: Page,
  {
    failure = false,
    slow = false,
    abort = false,
    conflict = false,
    prefix = "",
    longPbi = false,
  } = {},
) {
  const board = snapshot();
  if (longPbi)
    board.lanes[0].title =
      "日本語の非常に長いPBIタイトルを読みながら進捗も確認する".repeat(8);
  let posts = 0;
  let reads = 0;
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname.slice(prefix.length);
    if (p === "/api/health")
      return route.fulfill({
        json: {
          configured: true,
          accessMode: prefix ? "public-temporary" : "team",
        },
      });
    if (p === "/api/board") {
      reads++;
      return route.fulfill({ json: board });
    }
    posts++;
    if (conflict)
      return route.fulfill({
        status: 409,
        json: { ok: false, error: "conflict" },
      });
    if (abort) return route.abort("connectionreset");
    if (slow) await new Promise((r) => setTimeout(r, 500));
    if (failure)
      return route.fulfill({
        status: 502,
        json: { ok: false, ambiguous: true, partial: true },
      });
    const patch = route.request().postDataJSON();
    const id = Number(p.split("/").pop());
    const issue = [...board.lanes, ...board.tasks].find(
      (i) => i.number === id,
    )!;
    Object.assign(issue, { ...patch, revision: "2026-10-26T00:00:01Z" });
    return route.fulfill({ json: { ok: true, issue } });
  });
  await page.goto(prefix + "/");
  await expect(page.locator(".pbi-title")).toHaveCount(6);
  return { board, posts: () => posts, reads: () => reads };
}
