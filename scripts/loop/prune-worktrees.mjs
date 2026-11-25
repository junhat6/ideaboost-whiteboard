#!/usr/bin/env node
// automation の run が作った worktree のうち、もう要らないものを片付ける。
// engineer-first/idea-boost の scripts/loop/prune-worktrees.mjs（同じオーナーのループ）を写したもの。
// Orca は new-per-run の worktree を run 後も消さない。tidy が無かったころは run の worktree が残り続け、
// node_modules 込みで 1 個数百 MB ずつたまった（2026-11-25 に release の worktree 5 個を手で消した）。
//
//   node scripts/loop/prune-worktrees.mjs            … 何を消すかを表示するだけ（既定）
//   node scripts/loop/prune-worktrees.mjs --apply    … 実際に消す
//   node scripts/loop/prune-worktrees.mjs --apply --precheck
//        … Orca automation `ibw tidy` の precheck 用。片付けたあと必ず exit 1 で終わり、agent を起こさない。
//
// 消すのは次の全部を満たす worktree だけ。1つでも確かめられなければ残す（分からない＝残す）。
//   1. ideaboost-whiteboard の、Orca automation が作った worktree（main worktree・常駐レーン・人の worktree は対象外）
//   2. ピン留めされていない、いま画面で開かれていない
//   3. 作った run が終わっている（run が履歴に無いときは 24 時間以上動きが無い）
//   4. そこにいる agent がすべて done で、最後の活動（workspace と agent の更新）から 60 分以上たっている（Orca 標準ルールの猶予と同じ）
//      ターミナル出力の時刻は使わない。終わった Claude もステータス行を描き直すので、いつまでも新しく見えるため
//      例外：agent が done でない・run が終わっていなくても、最後の活動から IBW_PRUNE_STALL_HOURS（既定 6）時間たったものは
//      「止まった run」とみなし、5・6 の確認に進む（API エラーなどで止まった Claude は working のまま残り、Orca も 6 時間で見るのをやめるため）。
//      5・6 で残ったものは「要確認」と表示する
//   5. 未 commit の変更が無い（untracked も含む。.gitignore 済みのものは数えない）
//      .gitignore 済みでも .env*・.dev.vars* は残す。ただし symlink は数えない。
//      scripts/worktree/setup.mjs は main checkout の .dev.vars・.env* を symlink で共有するので、
//      worktree を消しても実体は main checkout に残る。これを数えると setup を走らせる run の worktree がすべて残る
//   6. HEAD の commit がすべて origin/develop に入っている（git cherry で patch 単位に確かめる）。
//      複数 commit の squash マージは patch が一致しないので、HEAD を head とする PR がマージ済みなら入ったとみなす
// 1回に消すのは IBW_PRUNE_MAX 個（既定 20）まで、持ち時間 IBW_PRUNE_BUDGET_SECONDS（既定 420 秒）まで。
// 消すときは、残っている idle のターミナルを閉じてから `orca worktree rm --delete-branch` する。
// ブランチの削除は Orca が「入っていると証明できたもの」だけに行い、それ以外は残る。
// このファイルは precheck と同じく origin/develop から一時ファイルへ書き出して実行されるので、相対 import をしない。
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

const REPO_NAME = process.env.IBW_REPO_NAME || "ideaboost-whiteboard";
const GH_REPO = process.env.IBW_LOOP_REPO || "junhat6/ideaboost-whiteboard";
const BASE = "develop";
const QUIET_MS = 60 * 60 * 1000;
const NO_RUN_QUIET_MS = 24 * 60 * 60 * 1000;
// Orca の runtime-terminal-run-observer も 6 時間で run を見るのをやめる（OBSERVE_DEADLINE_MS）
const STALL_MS =
  Number(process.env.IBW_PRUNE_STALL_HOURS || 6) * 60 * 60 * 1000;
const MAX_REMOVALS = Number(process.env.IBW_PRUNE_MAX || 20);
// precheck の上限は 600 秒（Orca の MAX_AUTOMATION_PRECHECK_TIMEOUT_SECONDS）。1個消すのに 20〜30 秒かかるので、持ち時間を超えたら次回に回す
const BUDGET_MS = Number(process.env.IBW_PRUNE_BUDGET_SECONDS || 420) * 1000;
const startedAt = Date.now();
const FINAL = new Set([
  "completed",
  "dispatch_failed",
  "skipped_precheck",
  "skipped_missed",
  "skipped_unavailable",
  "skipped_needs_interactive_auth",
]);

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const asPrecheck = args.has("--precheck");

const ORCA =
  process.env.ORCA_CLI ||
  (existsSync("/Applications/Orca.app/Contents/Resources/bin/orca")
    ? "/Applications/Orca.app/Contents/Resources/bin/orca"
    : "orca");

const run = (cmd, argv, timeout = 60_000) =>
  execFileSync(cmd, argv, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const tryRun = (cmd, argv, timeout) => {
  try {
    return { ok: true, out: run(cmd, argv, timeout) };
  } catch (error) {
    return {
      ok: false,
      out: String(error.stderr || error.message || "").trim(),
    };
  }
};
const orcaJson = (...argv) =>
  JSON.parse(run(ORCA, [...argv, "--json"], 120_000)).result;
const git = (dir, ...argv) => tryRun("git", ["-C", dir, ...argv], 60_000);

// scripts/worktree/setup.mjs が main checkout から張った symlink か。
// symlink を消しても指す先は消えないので、その worktree にしか無い設定には当たらない。
const isSharedLink = (dir, path) => {
  try {
    return lstatSync(join(dir, path)).isSymbolicLink();
  } catch {
    return false;
  }
};

// squash マージ済みの PR の head が、この worktree の HEAD と同じか
const mergedByPr = (dir) => {
  const head = git(dir, "rev-parse", "HEAD");
  if (!head.ok) return false;
  const found = tryRun(
    "gh",
    [
      "pr",
      "list",
      "-R",
      GH_REPO,
      "--state",
      "merged",
      "--search",
      head.out,
      "--json",
      "headRefOid",
    ],
    60_000,
  );
  if (!found.ok) return false;
  try {
    return JSON.parse(found.out || "[]").some((p) => p.headRefOid === head.out);
  } catch {
    return false;
  }
};

const finish = (code) => process.exit(asPrecheck ? 1 : code);

let worktrees;
let runs;
let agents;
try {
  worktrees = orcaJson("worktree", "ps").worktrees;
  runs = orcaJson("automations", "runs", "--limit", "100").runs ?? [];
  const listed = orcaJson("agent", "list");
  agents = Array.isArray(listed) ? listed : (listed.agents ?? []);
} catch (error) {
  console.log(
    `prune: Orca に繋がらないので何もしない (${String(error.message).split("\n")[0]})`,
  );
  finish(0);
}
const runByWorkspace = new Map();
for (const r of runs) if (r.workspaceId) runByWorkspace.set(r.workspaceId, r);
const agentsByWorkspace = new Map();
for (const a of agents) {
  if (!a.worktreeId) continue;
  if (!agentsByWorkspace.has(a.worktreeId))
    agentsByWorkspace.set(a.worktreeId, []);
  agentsByWorkspace.get(a.worktreeId).push(a);
}

const now = Date.now();
const kept = [];
const removable = [];

for (const w of worktrees) {
  if (w.repo !== REPO_NAME || w.workspaceKind !== "git" || w.isMainWorktree)
    continue;
  if (!w.automationCreated) continue; // 常駐レーンと人の worktree には触らない
  const name = w.displayName;
  let stalled = false;
  const keep = (why) =>
    kept.push({ name, why: stalled ? `要確認（止まった run）: ${why}` : why });

  if (w.isPinned) {
    keep("ピン留め");
    continue;
  }
  if (w.isActive) {
    keep("いま画面で開いている");
    continue;
  }
  const here = agentsByWorkspace.get(w.worktreeId) ?? [];
  const busy = here.find((a) => a.state !== "done");
  const r = runByWorkspace.get(w.worktreeId);
  const lastSeen = Math.max(
    w.lastActivityAt || 0,
    w.createdAt || 0,
    ...here.map((a) => a.updatedAt || 0),
  );
  const hoursQuiet = Math.floor((now - lastSeen) / 3_600_000);
  if (busy || (r && !FINAL.has(r.status))) {
    if (now - lastSeen < STALL_MS) {
      keep(
        busy
          ? `agent が動いている (${busy.state ?? "状態不明"})`
          : `run が終わっていない (${r.status})`,
      );
      continue;
    }
    stalled = true; // 長く動きが無い。中身を確かめて、安全なら消す
  } else if (r) {
    if (now - lastSeen < QUIET_MS) {
      keep("最後の動きから 60 分たっていない");
      continue;
    }
  } else if (now - lastSeen < NO_RUN_QUIET_MS) {
    keep("run が履歴に無く、24 時間たっていない");
    continue;
  }
  if (!existsSync(w.path)) {
    removable.push({ w, name, note: "フォルダが既に無い" });
    continue;
  }
  if (!git(w.path, "fetch", "-q", "origin", BASE).ok) {
    keep(`origin/${BASE} を取得できない`);
    continue;
  }
  const status = git(w.path, "status", "--porcelain");
  if (!status.ok) {
    keep("git status を読めない");
    continue;
  }
  if (status.out) {
    keep(`未 commit の変更 ${status.out.split("\n").length} 件`);
    continue;
  }
  // .gitignore 済みでも、その worktree にしか無いかもしれない設定ファイルは消さない（Orca の ignored-files と同じ考え）
  const ignored = git(
    w.path,
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  );
  if (!ignored.ok) {
    keep("ignore 済みのファイルを読めない");
    continue;
  }
  const localConfig = ignored.out
    .split("\n")
    .filter(
      (p) =>
        /(^|\/)(\.env[^/]*|\.dev\.vars[^/]*)$/.test(p) &&
        !p.includes("node_modules/") &&
        !isSharedLink(w.path, p),
    );
  if (localConfig.length > 0) {
    keep(`ローカル設定ファイルがある (${localConfig.slice(0, 3).join(", ")})`);
    continue;
  }
  const cherry = git(w.path, "cherry", `origin/${BASE}`, "HEAD");
  if (!cherry.ok) {
    keep(`commit が ${BASE} に入ったか確かめられない`);
    continue;
  }
  const unlanded = cherry.out
    .split("\n")
    .filter((line) => line.startsWith("+")).length;
  if (unlanded > 0 && !mergedByPr(w.path)) {
    keep(`${BASE} に入っていない commit ${unlanded} 件`);
    continue;
  }
  removable.push({
    w,
    name,
    note: stalled
      ? `止まった run・${hoursQuiet} 時間動きなし`
      : r
        ? `run ${r.status}`
        : "run 履歴なし・24h 以上静か",
  });
}

const removed = [];
const failed = [];
let deferred = 0;
for (const item of removable.slice(
  0,
  apply ? MAX_REMOVALS : removable.length,
)) {
  if (!apply) continue;
  if (Date.now() - startedAt > BUDGET_MS) {
    deferred += 1;
    continue;
  }
  const selector = `id:${item.w.worktreeId}`;
  if ((item.w.liveTerminalCount || 0) > 0 || item.w.hasAttachedPty) {
    const closed = tryRun(
      ORCA,
      ["terminal", "close", "--worktree", selector, "--all", "--json"],
      60_000,
    );
    if (!closed.ok) {
      failed.push({
        name: item.name,
        why: `ターミナルを閉じられない: ${closed.out.split("\n")[0]}`,
      });
      continue;
    }
  }
  const rm = tryRun(
    ORCA,
    ["worktree", "rm", "--worktree", selector, "--delete-branch", "--json"],
    180_000,
  );
  if (rm.ok)
    removed.push(
      item.note.startsWith("止まった")
        ? `${item.name} (${item.note})`
        : item.name,
    );
  else failed.push({ name: item.name, why: rm.out.split("\n")[0] });
}

const summary = apply
  ? `prune: 削除 ${removed.length} / 残す ${kept.length} / 失敗 ${failed.length}` +
    (deferred + Math.max(0, removable.length - MAX_REMOVALS) > 0
      ? ` / 次回に回す ${deferred + Math.max(0, removable.length - MAX_REMOVALS)}`
      : "")
  : `prune (dry-run): 削除候補 ${removable.length} / 残す ${kept.length}`;
console.log(summary);
for (const name of removed) console.log(`  removed  ${name}`);
if (!apply)
  for (const item of removable)
    console.log(`  would-rm ${item.name} (${item.note})`);
for (const f of failed) console.log(`  failed   ${f.name}: ${f.why}`);
for (const k of kept) console.log(`  keep     ${k.name}: ${k.why}`);
finish(failed.length > 0 ? 2 : 0);
