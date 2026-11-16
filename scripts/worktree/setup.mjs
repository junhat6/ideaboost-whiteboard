// Orca の worktree 作成時 (orca.yaml scripts.setup) に走る準備処理。手動でも再実行できる。
// 冪等: 2 回目以降は変わったものだけをやり直す。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DEFAULT_PORTS, portsFile, repoRoot } from "./ports.mjs";
import { allocatePorts, canonical, worktreePaths } from "./registry.mjs";

const worktree = canonical(process.env.ORCA_WORKTREE_PATH || repoRoot);
const mainCheckout = canonical(
  process.env.ORCA_ROOT_PATH || worktreePaths(worktree)[0],
);
const isMainCheckout = mainCheckout === worktree;
const log = (message) => console.log(`[worktree-setup] ${message}`);

function run(command, args, { optional = false } = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: worktree, stdio: "inherit" });
  if (result.status === 0) return true;
  if (optional) {
    log(`warning: ${command} ${args[0]} が失敗しました (続行)`);
    return false;
  }
  throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

// 1. Node: package.json engines (>=22)。CI と README は 24 を使う。
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  throw new Error(`Node ${process.versions.node} は非対応です (>=22、推奨 24)`);
}
if (major !== 24) log(`note: Node ${process.versions.node} (CI は 24)`);

// 2. ローカル専用の設定ファイル (.dev.vars 等) は main checkout から symlink で共有する。
//    コピーにしないのは、秘密の複製を worktree の数だけ増やさず、更新も 1 か所で済ませるため。
//    値は読まない・表示しない。
if (!isMainCheckout) {
  const shared = readdirSync(mainCheckout).filter(
    (name) =>
      (name.startsWith(".dev.vars") || name.startsWith(".env")) &&
      name !== ".env.example",
  );
  for (const name of shared) {
    const target = path.join(worktree, name);
    let present = false;
    try {
      lstatSync(target);
      present = true;
    } catch {}
    if (present) {
      log(`skip ${name}: worktree 側に既にあります`);
      continue;
    }
    symlinkSync(path.join(mainCheckout, name), target);
    log(`linked ${name} -> main checkout`);
  }
  if (shared.length === 0) {
    log("main checkout に .dev.vars はありません (test/e2e には不要)");
  }
}

// 3. 依存: lockfile が変わったときだけ npm ci。node_modules は worktree ごとに持つ
//    (branch ごとに依存が違いうるため、共有 symlink にはしない)。
const lockHash = createHash("sha256")
  .update(readFileSync(path.join(worktree, "package-lock.json")))
  .digest("hex");
const stamp = path.join(worktree, "node_modules", ".worktree-lock-sha256");
const installed = existsSync(stamp) && readFileSync(stamp, "utf8") === lockHash;
if (installed) {
  log("node_modules は package-lock.json と一致 (npm ci を省略)");
} else {
  run("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"]);
  writeFileSync(stamp, lockHash);
}

// 4. 生成物: web/*.js の bundle は git 管理外。preview / e2e / build が前提にする。
run("npm", ["run", "build:editor"]);

// 5. e2e 用 Chromium。共有キャッシュにあれば即終了する。失敗しても setup は止めない。
run("npx", ["--no-install", "playwright", "install", "chromium"], {
  optional: true,
});

// 6. port: main checkout は既定値のまま、追加 worktree だけ専用 port を割り当てる。
mkdirSync(path.dirname(portsFile), { recursive: true });
let ports = DEFAULT_PORTS;
if (isMainCheckout) {
  log("main checkout のため既定 port を使います");
} else {
  ports = await allocatePorts(worktree);
  writeFileSync(portsFile, JSON.stringify(ports, null, 2) + "\n");
}

log(
  `ready: preview(e2e)=${ports.preview} wrangler dev=${ports.dev} inspector=${ports.inspector}`,
);
log("次: npm run check / npm run test:e2e / npm run dev");
