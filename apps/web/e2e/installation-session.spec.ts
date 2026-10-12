import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_AGENCY_APPEARANCE } from "@open-triage/contracts";
import { selectedInstallationSettings } from "../app/installation-settings";

let script: string, css: string;
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ClinicianSessionGate} from './components/clinician-session-gate';
      createRoot(document.getElementById('root')).render(<ClinicianSessionGate><p>Clinical workspace</p></ClinicianSessionGate>);` } });
  script = result.outputFiles[0]!.text;
});
for (const width of [390, 1440]) {
  test(`installation administrator can sign in and reload without an agency at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const session = { user: { id: "owner", displayName: "Installation Owner" }, organization: null,
      installationOwner: true, installationSuperadmin: true, agencies: [], capabilities: [], workspaceAvailable: true,
      csrfToken: "csrf", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+3600000).toISOString() };
    await page.route("**/__installation", route => route.fulfill({ contentType: "text/html", body:
      `<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__installation-script"></script></body></html>` }));
    await page.route("**/__installation-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/api/installation", route => route.fulfill({ json: { settings: selectedInstallationSettings(), appearance: DEFAULT_AGENCY_APPEARANCE } }));
    await page.route("**/api/sessions", route => route.fulfill({ status: 201, json: session }));
    await page.route("**/api/sessions/current", route => route.fulfill({ json: route.request().method() === "DELETE" ? { ended: true } : session }));
    await page.route("**/api/super-admin/agencies", route => route.fulfill({ json: { agencies: [], catalogs: [], forms: [], validations: [], activeConfigurations: [], hostnameSuffix: "example.test" } }));
    await page.goto("/__installation");
    await page.getByLabel("Username", { exact: true }).fill("install.owner");
    await page.getByLabel("Password", { exact: true }).fill("Installation-Password-42!");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Super-admin", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New agency", exact: true })).toBeVisible();
    await expect(page.getByText("Clinical workspace", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Super-admin", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/installation-session-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
