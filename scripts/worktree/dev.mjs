// `npm run dev`: worktree ごとの port で wrangler dev を起動する。追加引数はそのまま渡す。
import { spawn } from "node:child_process";
import { localPorts } from "./ports.mjs";

const { dev, inspector } = localPorts();
const child = spawn(
  "wrangler",
  [
    "dev",
    "--port",
    String(dev),
    "--inspector-port",
    String(inspector),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
