import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  maxFailures: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:4183", headless: true },
  webServer: {
    command: "node scripts/preview.mjs",
    url: "http://127.0.0.1:4183",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "wide", use: { viewport: { width: 2560, height: 1440 } } },
  ],
  reporter: "list",
});
