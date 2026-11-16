// 全 worktree で共有する port 割当台帳。git の共通ディレクトリ (.git) に置くため、
// どの worktree から見ても同じ 1 ファイルになり、作業ツリーや commit には入らない。
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_PORTS, SLOT_COUNT, portsForSlot } from "./ports.mjs";

const LOCK_STALE_MS = 60_000;

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function gitCommonDir(cwd) {
  return path.resolve(cwd, git(cwd, "rev-parse", "--git-common-dir"));
}

export function worktreePaths(cwd) {
  return git(cwd, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => canonical(line.slice("worktree ".length)));
}

// /tmp と /private/tmp のような別名で同じ worktree を二重登録しないよう実体パスで比べる。
export function canonical(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function registryPath(commonDir) {
  return path.join(commonDir, "orca-worktree-ports.json");
}

function readRegistry(commonDir) {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(commonDir), "utf8"));
    return parsed && typeof parsed.slots === "object" ? parsed : { slots: {} };
  } catch {
    return { slots: {} };
  }
}

function writeRegistry(commonDir, registry) {
  // 途中で落ちても壊れた JSON を残さないよう rename で置き換える。
  const file = registryPath(commonDir);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n");
  renameSync(tmp, file);
}

// Orca は複数 worktree を同時に作れるため、台帳の読み書きは mkdir ロックで直列化する。
export async function withRegistryLock(commonDir, fn) {
  const lock = path.join(commonDir, "orca-worktree-ports.lock");
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() > deadline) {
        throw new Error(`port registry lock is busy: ${lock}`);
      }
      await delay(100);
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function slotFree(slot) {
  for (const port of Object.values(portsForSlot(slot))) {
    if (!(await portFree(port))) return false;
  }
  return true;
}

// 既に割当済みならそれを返す。消えた worktree の割当は回収してから空き slot を探す。
export async function allocatePorts(worktree) {
  const commonDir = gitCommonDir(worktree);
  return withRegistryLock(commonDir, async () => {
    const registry = readRegistry(commonDir);
    const live = new Set(worktreePaths(worktree));
    for (const owner of Object.keys(registry.slots)) {
      if (!live.has(owner) && !existsSync(owner)) delete registry.slots[owner];
    }
    let slot = registry.slots[worktree];
    if (!slot) {
      const used = new Set(Object.values(registry.slots));
      for (let candidate = 1; candidate <= SLOT_COUNT; candidate++) {
        if (used.has(candidate)) continue;
        if (await slotFree(candidate)) {
          slot = candidate;
          break;
        }
      }
      if (!slot) throw new Error("no free worktree port slot (1..99)");
      registry.slots[worktree] = slot;
    }
    writeRegistry(commonDir, registry);
    return { slot, ...portsForSlot(slot) };
  });
}

export async function releasePorts(worktree) {
  const commonDir = gitCommonDir(worktree);
  return withRegistryLock(commonDir, async () => {
    const registry = readRegistry(commonDir);
    const slot = registry.slots[worktree];
    if (!slot) return undefined;
    delete registry.slots[worktree];
    writeRegistry(commonDir, registry);
    return slot;
  });
}

export { DEFAULT_PORTS };
