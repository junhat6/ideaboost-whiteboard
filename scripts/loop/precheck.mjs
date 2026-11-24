#!/usr/bin/env node
// Orca automation の precheck。exit 0 のときだけ agent を起こす（仕事が無い時間は費用ゼロ）。
// 使い方: node scripts/loop/precheck.mjs <release|finish|mend|replan>
// automation 側は origin/develop のこのファイルを一時ファイルへ書き出して実行する（docs/loop/README.md）。
import { execFileSync } from "node:child_process";

const REPO = "junhat6/ideaboost-whiteboard";
const mode = process.argv[2];

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gh = (...args) => JSON.parse(sh("gh", args) || "null");
const issues = (...labels) =>
  gh("issue", "list", "--repo", REPO, "--state", "open", "--json", "number,labels", "-L", "100", ...labels.flatMap((l) => ["--label", l])) || [];
const hasLabel = (issue, name) => issue.labels.some((l) => l.name === name);
const say = (ok, reason) => {
  console.log(`[precheck ${mode}] ${ok ? "起こす" : "見送り"}: ${reason}`);
  process.exit(ok ? 0 : 1);
};

function latestHealth() {
  const runs = gh("run", "list", "--repo", REPO, "--workflow", "develop-health.yml", "--branch", "develop", "--event", "push", "-L", "1", "--json", "conclusion,status,headSha") || [];
  return runs[0];
}

try {
  sh("git", ["fetch", "-q", "origin", "develop", "main"]);
  if (mode === "release") {
    if (issues("P0").length) say(false, "open な P0 Issue があるため列車を止める");
    const mainRuns = gh("run", "list", "--repo", REPO, "--workflow", "ci.yml", "--branch", "main", "--event", "push", "-L", "1", "--json", "status") || [];
    if (mainRuns[0] && mainRuns[0].status !== "completed") say(false, "main の配信が実行中");
    const openRc = (gh("pr", "list", "--repo", REPO, "--base", "main", "--state", "open", "--json", "headRefName") || []).filter((p) => p.headRefName.startsWith("rc/"));
    if (openRc.length) say(true, `出しきれていない昇格 PR（${openRc.map((p) => p.headRefName).join(", ")}）の続き`);
    const health = latestHealth();
    if (health?.conclusion === "failure") say(false, "develop-health が赤（先に mend）");
    const pending = sh("git", ["log", "--no-merges", "--oneline", "origin/main..origin/develop"]);
    say(Boolean(pending), pending ? `未リリースの commit ${pending.split("\n").length} 件` : "未リリースの commit なし");
  } else if (mode === "finish") {
    const open = issues("loop:finish");
    const claimed = open.filter((i) => hasLabel(i, "claimed")).length;
    if (claimed >= 2) say(false, `着手中が ${claimed} 件（上限2）`);
    const ready = open.filter((i) => !["claimed", "blocked", "needs-human"].some((l) => hasLabel(i, l)));
    say(ready.length > 0, `未着手の loop:finish ${ready.length} 件`);
  } else if (mode === "mend") {
    const health = latestHealth();
    say(health?.conclusion === "failure", `develop-health の最新は ${health?.conclusion || health?.status || "なし"}`);
  } else if (mode === "replan") {
    const open = issues("loop:finish");
    const ready = open.filter((i) => !["claimed", "blocked", "needs-human"].some((l) => hasLabel(i, l)));
    const blocked = open.filter((i) => hasLabel(i, "blocked")).length;
    say(ready.length < 2 || blocked >= 3, `未着手 ${ready.length} 件・blocked ${blocked} 件`);
  } else {
    console.error("usage: precheck.mjs <release|finish|mend|replan>");
    process.exit(2);
  }
} catch (error) {
  // 確かめられないときは起こさない（gh 未認証・通信断で agent を無駄に起動しない）。
  console.error(`[precheck ${mode}] 確認に失敗したため見送り: ${String(error.message).split("\n")[0]}`);
  process.exit(1);
}
