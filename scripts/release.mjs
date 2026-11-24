#!/usr/bin/env node
// develop の選んだ SHA を main（本番）へ昇格させる唯一の入口。手順と理由は docs/RELEASE.md。
//
//   npm run release -- --plan              昇格候補を表示するだけ
//   npm run release                        origin/develop の先頭を昇格（CI → merge → 配信 → tag）
//   npm run release -- --sha <sha>         develop 上の特定 SHA を昇格
//   npm run release -- --version v1.2.0    tag 名を指定（既定は直近 v* の patch +1、無ければ v1.0.0）
//   npm run release -- --continue          merge 済みで配信待ち/失敗中の main を見届け直し、成功なら tag
//
// 終了コード: 0 成功・変更なし / 10 リリースCI赤 / 11 main の CI・配信が赤 / 12 前提違反 / 1 その他
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const REPO = "junhat6/ideaboost-whiteboard";
const TRUNK = "develop";
const PROD = "main";
const WORKFLOW = "ci.yml";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const log = (message) => console.log(`[release] ${message}`);
class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function run(cmd, cmdArgs, { allowFail = false, inherit = false, cwd } = {}) {
  try {
    const out = execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      cwd,
    });
    return typeof out === "string" ? out.trim() : "";
  } catch (error) {
    if (allowFail) return null;
    const detail = String(error.stderr || error.message || "").trim();
    throw new Error(`${cmd} ${cmdArgs.join(" ")} が失敗しました: ${detail}`);
  }
}
const git = (...a) => run("git", a);
const gh = (...a) => run("gh", a);
const ghJson = (...a) => JSON.parse(gh(...a) || "null");
const isAncestor = (a, b) => run("git", ["merge-base", "--is-ancestor", a, b], { allowFail: true }) !== null;

function nextVersion() {
  const explicit = option("--version");
  if (explicit) {
    if (!/^v\d+\.\d+\.\d+$/.test(explicit)) throw new Stop(12, `--version は vX.Y.Z 形式です: ${explicit}`);
    if (git("tag", "-l", explicit)) throw new Stop(12, `tag ${explicit} は既にあります`);
    return explicit;
  }
  const tags = git("tag", "-l", "v*.*.*", "--sort=-v:refname").split("\n").filter(Boolean);
  if (!tags.length) return "v1.0.0";
  const [major, minor, patch] = tags[0].slice(1).split(".").map(Number);
  return `v${major}.${minor}.${patch + 1}`;
}

function commitsBetween(base, head) {
  const out = git("log", "--no-merges", "--format=%h %s", `${base}..${head}`);
  return out ? out.split("\n") : [];
}

async function waitFor(label, fn, { timeoutMin = 60, everySec = 20 } = {}) {
  const until = Date.now() + timeoutMin * 60_000;
  let last = "";
  for (;;) {
    const result = fn();
    if (result.done) return result.value;
    if (result.note && result.note !== last) log(`${label}: ${result.note}`);
    last = result.note || last;
    if (Date.now() > until) throw new Stop(1, `${label} が ${timeoutMin} 分以内に終わりませんでした`);
    await delay(everySec * 1000);
  }
}

// gh pr checks は失敗・実行中でも非0で終わるため、stdout をそのまま読む。
function prChecks(pr) {
  try {
    return JSON.parse(execFileSync("gh", ["pr", "checks", String(pr), "--repo", REPO, "--json", "name,state,bucket,link"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) || "[]");
  } catch (error) {
    try {
      return JSON.parse(String(error.stdout || "[]"));
    } catch {
      return []; // まだ check が1つも報告されていない
    }
  }
}

// PR の必須チェック（check）が終わるまで待つ。
async function waitForPrChecks(pr) {
  return waitFor(`PR #${pr} の CI`, () => {
    const checks = prChecks(pr);
    const gate = checks.find((c) => c.name === "check");
    const failed = checks.filter((c) => c.bucket === "fail" || c.bucket === "cancel");
    if (failed.length) return { done: true, value: { ok: false, failed } };
    if (gate && gate.bucket === "pass") return { done: true, value: { ok: true } };
    const pending = checks.filter((c) => c.bucket === "pending").map((c) => c.name);
    return { done: false, note: pending.length ? `実行中 ${pending.join(", ")}` : "開始待ち" };
  });
}

// main への push で起きる Verify run（CI + 配信）を見届ける。
async function watchMainRun(sha) {
  const runId = await waitFor(
    `main ${sha.slice(0, 7)} の run`,
    () => {
      const runs = ghJson("run", "list", "--workflow", WORKFLOW, "--branch", PROD, "--event", "push", "--commit", sha, "--json", "databaseId,status,conclusion", "-L", "5") || [];
      return runs.length ? { done: true, value: runs[0].databaseId } : { done: false, note: "run の作成待ち" };
    },
    { timeoutMin: 10, everySec: 10 },
  );
  log(`main の CI・配信を見届けます: https://github.com/${REPO}/actions/runs/${runId}`);
  const final = await waitFor(`main run ${runId}`, () => {
    const r = ghJson("run", "view", String(runId), "--json", "status,conclusion,jobs");
    if (r.status !== "completed") {
      const active = (r.jobs || []).filter((j) => j.status !== "completed").map((j) => j.name);
      return { done: false, note: `実行中 ${active.join(", ") || "-"}` };
    }
    return { done: true, value: r };
  }, { timeoutMin: 60, everySec: 30 });
  if (final.conclusion !== "success") {
    const bad = (final.jobs || []).filter((j) => j.conclusion && j.conclusion !== "success" && j.conclusion !== "skipped");
    throw new Stop(11, [
      `main の run ${runId} が ${final.conclusion} でした（失敗 job: ${bad.map((j) => j.name).join(", ") || "不明"}）。`,
      `原因: gh run view ${runId} --log-failed`,
      "一時的な失敗なら gh run rerun " + runId + " --failed の後に npm run release -- --continue。",
      "コードの問題なら develop で直して push し、npm run release をやり直す（main は直接直さない）。",
    ].join("\n"));
  }
  const deploy = (final.jobs || []).find((j) => j.name === "deploy");
  if (!deploy || deploy.conclusion !== "success") throw new Stop(11, `run ${runId} で deploy job が成功していません（${deploy?.conclusion ?? "無し"}）`);
  return runId;
}

// main の merge commit を develop に戻し、次の昇格 PR が strict（base が head の祖先）を満たすようにする。
function syncTrunk(mainSha) {
  git("fetch", "-q", "origin", TRUNK, PROD);
  const trunk = git("rev-parse", `origin/${TRUNK}`);
  if (isAncestor(mainSha, trunk)) return log(`${TRUNK} は既に main を含んでいます`);
  if (isAncestor(trunk, mainSha)) {
    git("push", "origin", `${mainSha}:refs/heads/${TRUNK}`);
    return log(`${TRUNK} を main（${mainSha.slice(0, 7)}）へ fast-forward しました`);
  }
  // develop が先へ進んでいる。木は同じなので main を merge しても内容は変わらない。
  const dir = mkdtempSync(join(tmpdir(), "ibw-release-"));
  try {
    git("worktree", "add", "-q", "--detach", dir, trunk);
    run("git", ["merge", "--no-ff", "--no-edit", "-m", `Merge ${PROD} into ${TRUNK} after release`, mainSha], { cwd: dir });
    run("git", ["push", "origin", `HEAD:refs/heads/${TRUNK}`], { cwd: dir });
    log(`${TRUNK} に main を merge して push しました`);
  } catch (error) {
    throw new Stop(1, `${TRUNK} への main の取り込みに失敗しました。手で git merge origin/main して push してください。\n${error.message}`);
  } finally {
    run("git", ["worktree", "remove", "--force", dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

function tagAndPublish(mainSha, version, runId) {
  git("fetch", "-q", "--tags", "origin");
  const existing = git("tag", "--points-at", mainSha).split("\n").filter((t) => /^v\d/.test(t));
  if (existing.length) return log(`${mainSha.slice(0, 7)} には既に ${existing.join(", ")} があります`);
  const previous = git("tag", "-l", "v*.*.*", "--sort=-v:refname").split("\n").filter(Boolean)[0];
  const lines = commitsBetween(previous || `${mainSha}~1`, mainSha).filter((l) => !/ Release v\d/.test(l));
  // 公開リポジトリのため、本番 URL・個人情報は書かない（commit の件名だけ）。
  const notes = [
    `本番配信: main ${mainSha.slice(0, 7)}（Verify run ${runId} の check・deploy・smoke 成功）`,
    "",
    previous ? `## ${previous} からの変更` : "## 変更",
    ...lines.map((l) => `- ${l}`),
  ].join("\n");
  gh("release", "create", version, "--repo", REPO, "--target", mainSha, "--title", version, "--notes", notes);
  git("fetch", "-q", "--tags", "origin");
  log(`tag ${version} と GitHub Release を作りました`);
}

async function main() {
  if (git("status", "--porcelain") && !flag("--plan")) log("注意: 作業ツリーに未commitの変更があります（昇格対象は origin 上の SHA なので影響しません）");
  git("fetch", "-q", "--tags", "origin", TRUNK, PROD);
  const prodSha = git("rev-parse", `origin/${PROD}`);

  if (flag("--continue")) {
    const runId = await watchMainRun(prodSha);
    tagAndPublish(prodSha, nextVersion(), runId);
    syncTrunk(prodSha);
    return;
  }

  const sha = git("rev-parse", option("--sha") || `origin/${TRUNK}`);
  if (!isAncestor(sha, `origin/${TRUNK}`)) throw new Stop(12, `${sha.slice(0, 7)} は origin/${TRUNK} の履歴にありません`);
  if (!isAncestor(prodSha, sha))
    throw new Stop(12, [
      `main（${prodSha.slice(0, 7)}）に ${TRUNK} の ${sha.slice(0, 7)} が含まない commit があります。`,
      `${TRUNK} で git merge origin/${PROD} して push してからやり直してください（main を直接変えた人がいる）。`,
    ].join("\n"));
  const pending = commitsBetween(prodSha, sha);
  if (!pending.length) return log("昇格する変更はありません");
  const version = nextVersion();
  log(`${version} 候補: ${TRUNK} ${sha.slice(0, 7)}（main ${prodSha.slice(0, 7)} から ${pending.length} commit）`);
  for (const line of pending) console.log(`  ${line}`);
  if (flag("--plan")) return;

  const branch = `rc/${sha.slice(0, 7)}`;
  // 古い候補の PR は閉じる（列車は常に1本）。
  for (const pr of ghJson("pr", "list", "--repo", REPO, "--base", PROD, "--state", "open", "--json", "number,headRefName", "-L", "50") || []) {
    if (pr.headRefName.startsWith("rc/") && pr.headRefName !== branch) {
      gh("pr", "close", String(pr.number), "--repo", REPO, "--delete-branch", "--comment", `新しい候補 ${branch} に置き換えます。`);
      log(`古い候補 PR #${pr.number}（${pr.headRefName}）を閉じました`);
    }
  }
  git("push", "-q", "origin", `${sha}:refs/heads/${branch}`);
  let pr = (ghJson("pr", "list", "--repo", REPO, "--head", branch, "--base", PROD, "--state", "open", "--json", "number", "-L", "1") || [])[0]?.number;
  if (!pr) {
    const body = [
      `\`npm run release\` が作った昇格 PR です。${TRUNK} の \`${sha}\` を main（本番）へ出します。`,
      "",
      "この PR の CI（check）が green になると、release スクリプトが merge し、main への push で配信・smoke を行います。",
      "",
      "## 含まれる commit",
      ...pending.map((l) => `- ${l}`),
    ].join("\n");
    const url = gh("pr", "create", "--repo", REPO, "--base", PROD, "--head", branch, "--title", `Release ${version}: ${TRUNK} ${sha.slice(0, 7)}`, "--body", body);
    pr = Number(url.split("/").pop());
  }
  log(`昇格 PR #${pr}: https://github.com/${REPO}/pull/${pr}`);

  const result = await waitForPrChecks(pr);
  if (!result.ok)
    throw new Stop(10, [
      `リリース CI が通りませんでした: ${result.failed.map((c) => `${c.name} ${c.link}`).join(" / ")}`,
      "gh run view <run-id> --log-failed で原因を特定し、develop で直して push してから npm run release をやり直してください。",
      "一時的な失敗（runner 都合など）と判断したら gh run rerun <run-id> --failed の後に同じコマンドを再実行すれば、この PR を使い続けます。",
    ].join("\n"));

  gh("pr", "merge", String(pr), "--repo", REPO, "--merge", "--delete-branch", "--subject", `Release ${version}: ${TRUNK} ${sha.slice(0, 7)}`);
  git("fetch", "-q", "origin", PROD);
  const mergeSha = git("rev-parse", `origin/${PROD}`);
  log(`main を ${mergeSha.slice(0, 7)} に進めました。配信を待ちます`);
  const runId = await watchMainRun(mergeSha);
  tagAndPublish(mergeSha, version, runId);
  syncTrunk(mergeSha);
  log(`${version} を本番に出しました`);
}

main().catch((error) => {
  console.error(`[release] ${error.message}`);
  process.exit(error instanceof Stop ? error.code : 1);
});
