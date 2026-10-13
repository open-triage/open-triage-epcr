import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
let script: string, css: string;
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {AuthenticationPolicyPanel} from './components/authentication-policy'; createRoot(document.getElementById('root')).render(<AuthenticationPolicyPanel language={new URLSearchParams(location.search).get("language") || "en"} csrfToken="csrf" canWrite={!new URLSearchParams(location.search).has("readonly")}/>);` } });
  script = result.outputFiles[0]!.text;
});
for (const width of [390,1440]) test(`inherited policy requires personal authentication and preserves a failed draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/__authentication", route => route.fulfill({ contentType: "text/html", body: `<html lang="en"><head><style>${css}</style></head><body style="--green:#315ba8;--text-color:#202850"><div class="admin-panel" id="root"></div><script src="/__auth-script"></script></body></html>` }));
  await page.route("**/__auth-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  let policy = { groupName: "Root EMS", groupId: "root-group", organizationId: "child", inherited: true, revision: 1, maximumSessionHours: 12, temporaryPasswordHours: 72, accountAttemptsPer15Minutes: 20, networkAttemptsPer5Minutes: 60, history: [] };
  let fail = true, authenticated = false;
  await page.route("**/api/sessions/reauthenticate", route => { expect(route.request().headers()["x-csrf-token"]).toBe("csrf"); expect(route.request().postDataJSON().currentPassword).toBe("Personal password 42!"); authenticated = true; return route.fulfill({ json: { reauthenticatedUntil: new Date(Date.now()+300000).toISOString() } }); });
  await page.route("**/api/admin/authentication", route => {
    if (route.request().method() === "PUT") {
      expect(authenticated).toBe(true); expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
      const command = route.request().postDataJSON(); expect(command).not.toHaveProperty("groupId");
      if (fail) return route.fulfill({ status: 409, json: { code: "admin.authenticationPolicyStale" } });
      policy = { ...policy, ...command, revision: 2 };
    }
    return route.fulfill({ json: policy });
  });
  await page.goto("/__authentication");
  await expect(page.getByText("Owning group: Root EMS (inherited)")).toBeVisible();
  await page.getByLabel("Maximum session duration (hours)").fill("8");
  await page.getByLabel("Your current password is required to save").fill("Personal password 42!");
  await page.getByRole("button", { name: "Save group policy" }).click();
  await expect(page.getByRole("alert")).toHaveText("Authentication policy changed. Reload the effective policy and review your changes before saving.");
  await expect(page.getByLabel("Maximum session duration (hours)")).toHaveValue("8");
  await expect(page.getByLabel("Your current password is required to save")).toHaveValue("");
  fail = false;
  await page.getByLabel("Your current password is required to save").fill("Personal password 42!");
  await page.getByRole("button", { name: "Save group policy" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/authentication-policy-${width}.png` });
  await page.getByLabel("Maximum session duration (hours)").focus();
  await expect(page.getByLabel("Maximum session duration (hours)")).toBeFocused();
});

test("Swedish inherited policy remains read-only without sensitive credentials", async ({ page }) => {
  await page.route("**/__authentication?*", route => route.fulfill({ contentType: "text/html", body: `<html lang="sv"><head><style>${css}</style></head><body><div id="root"></div><script src="/__auth-script"></script></body></html>` }));
  await page.route("**/__auth-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/api/admin/authentication", route => route.fulfill({ json: { groupName: "Region EMS", groupId: "root", organizationId: "child", inherited: true, revision: 1, maximumSessionHours: 8, temporaryPasswordHours: 24, accountAttemptsPer15Minutes: 20, networkAttemptsPer5Minutes: 60, history: [] } }));
  await page.goto("/__authentication?language=sv&readonly=1");
  await expect(page.getByRole("heading", { name: "Autentisering", exact: true })).toBeVisible();
  await expect(page.getByText("Ägande grupp: Region EMS (ärvd)")).toBeVisible();
  await expect(page.getByLabel("Maximal sessionslängd (timmar)")).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Spara gruppolicy" })).toHaveCount(0);
});
