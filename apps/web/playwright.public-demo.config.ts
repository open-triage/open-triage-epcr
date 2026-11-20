import { defineConfig } from "@playwright/test";

const target = process.env.DEMO_WEB_URL;
if (!target) throw new Error("Set DEMO_WEB_URL to the deployed demo’s HTTPS origin");
const url = new URL(target);
if (url.protocol !== "https:" || url.username || url.password || url.href !== url.origin + "/") {
  throw new Error("DEMO_WEB_URL must be the deployed demo's HTTPS origin");
}

export default defineConfig({
  testDir: "./post-deployment",
  outputDir: "./test-results/public-demo",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { actionTimeout: 15_000, navigationTimeout: 30_000, baseURL: url.origin, locale: "en-US", viewport: { width: 1280, height: 800 } },
});
