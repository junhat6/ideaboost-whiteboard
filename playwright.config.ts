import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "node scripts/preview.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "wide", use: { viewport: { width: 2560, height: 1440 } } },
  ],
  reporter: "list",
});
