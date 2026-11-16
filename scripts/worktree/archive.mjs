// Orca の worktree 削除時 (orca.yaml scripts.archive) に走る後片付け。手動でも再実行できる。
// 削除を妨げないよう、各手順の失敗は警告にとどめて常に exit 0 で終える。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { portsFile, repoRoot } from "./ports.mjs";
import { canonical, git, releasePorts, worktreePaths } from "./registry.mjs";

const worktree = canonical(process.env.ORCA_WORKTREE_PATH || repoRoot);
const log = (message) => console.log(`[worktree-archive] ${message}`);

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    log(`warning: ${name}: ${error.message}`);
  }
}

function lsof(args) {
  try {
    return execFileSync("lsof", args, { encoding: "utf8" });
  } catch {
    return ""; // 該当なしでも lsof は非 0 で終わる。
  }
}

function cwdOf(pid) {
  const line = lsof(["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .split("\n")
    .find((entry) => entry.startsWith("n"));
  return line ? canonical(line.slice(1)) : undefined;
}

function inside(dir) {
  return dir === worktree || dir?.startsWith(worktree + path.sep);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (canonical(worktreePaths(worktree)[0]) === worktree) {
  log("main checkout では後片付けをしません");
  process.exit(0);
}

let ports;
try {
  ports = JSON.parse(readFileSync(portsFile, "utf8"));
} catch {
  log("割当 port はありません");
}

// 1. この worktree の port で待ち受けている preview / wrangler dev を止める。
//    wrangler は子の workerd を止めても再起動するため、listener の pid だけでなく
//    起動元 (npm / node / wrangler) まで遡り、その配下のプロセス木をまとめて止める。
//    shell や agent まで遡らないよう、遡るのは cwd がこの worktree 配下の
//    node / npm / wrangler / workerd に限る。
function processTable() {
  const rows = new Map();
  for (const line of execFileSync("ps", ["-ax", "-o", "pid=,ppid=,comm="], {
    encoding: "utf8",
  }).split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (match) {
      rows.set(Number(match[1]), {
        ppid: Number(match[2]),
        name: path.basename(match[3]),
      });
    }
  }
  return rows;
}

const SERVER_PROCESS = /^(node|npm|npx|wrangler|workerd)$/;

function launcherOf(pid, rows) {
  let top = pid;
  for (;;) {
    const parent = rows.get(top)?.ppid;
    const row = parent && rows.get(parent);
    if (!row || parent === process.pid || !SERVER_PROCESS.test(row.name)) break;
    if (!inside(cwdOf(parent))) break;
    top = parent;
  }
  return top;
}

function descendants(root, rows) {
  const tree = [root];
  for (let i = 0; i < tree.length; i++) {
    for (const [pid, row] of rows) {
      if (row.ppid === tree[i] && !tree.includes(pid)) tree.push(pid);
    }
  }
  return tree;
}

if (ports) {
  await step("stop servers", async () => {
    const rows = processTable();
    const targets = new Set();
    for (const port of [ports.preview, ports.dev, ports.inspector]) {
      for (const pid of lsof(["-t", `-iTCP:${port}`, "-sTCP:LISTEN"])
        .split("\n")
        .filter(Boolean)
        .map(Number)) {
        if (pid === process.pid || !inside(cwdOf(pid))) continue;
        for (const member of descendants(launcherOf(pid, rows), rows)) {
          if (member !== process.pid) targets.add(member);
        }
      }
    }
    if (targets.size === 0) return log("停止するサーバーはありません");
    // 親から順に送ると、子を再起動する前に親が止まる。
    for (const pid of targets) {
      log(`SIGTERM pid ${pid} (${rows.get(pid)?.name})`);
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
    await delay(3000);
    for (const pid of targets) {
      if (!alive(pid)) continue;
      log(`SIGKILL pid ${pid}`);
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  });
}

// 2. port 台帳から外し、次の worktree が再利用できるようにする。
await step("release ports", async () => {
  const slot = await releasePorts(worktree);
  log(slot ? `port slot ${slot} を解放しました` : "台帳に割当はありません");
});

// 3. 消える前に、push していない作業が無いかを記録に残す (削除の判断は Orca / 利用者)。
await step("report unpushed work", async () => {
  const dirty = git(worktree, "status", "--porcelain");
  if (dirty) {
    log(`warning: 未コミットの変更 ${dirty.split("\n").length} 件`);
  }
  const unpushed = git(
    worktree,
    "log",
    "--oneline",
    "HEAD",
    "--not",
    "--remotes",
  );
  if (unpushed) {
    log(`warning: どの remote にも無い commit:\n${unpushed}`);
    log(
      `branch ${git(worktree, "rev-parse", "--abbrev-ref", "HEAD")} は残ります`,
    );
  }
  if (!dirty && !unpushed) log("未 push の作業はありません");
});
