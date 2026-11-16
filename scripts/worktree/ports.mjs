// worktree ごとのローカル port。並列 worktree で e2e / wrangler dev が衝突しないようにする。
// 割当は setup (scripts/worktree/setup.mjs) が .worktree/ports.json に書く。
// ファイルが無い checkout (main の作業ツリー・CI) は従来どおりの既定 port を使う。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_PORTS = Object.freeze({
  preview: 4183,
  dev: 8787,
  inspector: 9229,
});

// slot n (1..SLOT_COUNT) → 既定値と重ならない帯へ置く。
export const SLOT_COUNT = 99;
export function portsForSlot(slot) {
  return { preview: 4300 + slot, dev: 8800 + slot, inspector: 9300 + slot };
}

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const portsFile = fileURLToPath(
  new URL("../../.worktree/ports.json", import.meta.url),
);

function envPort(name) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a TCP port number: ${raw}`);
  }
  return port;
}

function readAssigned() {
  try {
    const parsed = JSON.parse(readFileSync(portsFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// 優先順: 環境変数 > .worktree/ports.json > 既定値。
export function localPorts() {
  const assigned = readAssigned();
  const pick = (key, env) =>
    envPort(env) ??
    (Number.isInteger(assigned[key]) ? assigned[key] : DEFAULT_PORTS[key]);
  return {
    preview: pick("preview", "PREVIEW_PORT"),
    dev: pick("dev", "WRANGLER_DEV_PORT"),
    inspector: pick("inspector", "WRANGLER_INSPECTOR_PORT"),
  };
}
