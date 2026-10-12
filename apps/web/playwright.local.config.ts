import { defineConfig } from "@playwright/test";

// Uses the database-backed servers started by `npm run dev` and the existing demo fixture.
export default defineConfig({
  testDir: "./e2e-local",
  reporter: "line",
  use: { baseURL: "http://localhost:3000", browserName: "chromium" },
});
