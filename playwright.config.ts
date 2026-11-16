import { defineConfig } from "@playwright/test";
import { localPorts } from "./scripts/worktree/ports.mjs";

// 並列 worktree の e2e が同じ port を奪い合わないよう、worktree ごとの port を使う。
const base = `http://127.0.0.1:${localPorts().preview}`;
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  maxFailures: process.env.CI ? 2 : 0,
  use: {
    baseURL: base,
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/preview.mjs",
    url: base,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "wide", use: { viewport: { width: 2560, height: 1440 } } },
  ],
  reporter: "list",
});
