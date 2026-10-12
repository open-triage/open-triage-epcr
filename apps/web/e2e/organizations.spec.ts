import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { newAgencySettings } from "../components/agency-settings";

let script: string, css: string;
const rootId = "10000000-0000-4000-8000-000000000001";
const catalogId = "20000000-0000-4000-8000-000000000001";
const formId = "30000000-0000-4000-8000-000000000001";
const validationId = "40000000-0000-4000-8000-000000000001";
const agencies = Array.from({ length: 35 }, (_, index) => ({
  id: index === 0 ? rootId : `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name: index === 0 ? "Parent EMS" : `Agency ${index + 1}`, parentOrganizationId: index === 0 ? null : rootId,
  groupId: rootId, hostname: `agency${index + 1}.example.test`, active: true, revision: 1, timeZone: "UTC",
}));
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminShell} from './components/admin-shell';
      const session={user:{id:'owner',displayName:'Owner'},organization:{id:'${rootId}',name:'Parent EMS'},
        homeOrganizationId:'${rootId}',installationOwner:true,csrfToken:'csrf',startedAt:new Date().toISOString(),
        expiresAt:new Date(Date.now()+3600000).toISOString(),capabilities:['admin-dashboard:read','settings:read','settings:write']};
      createRoot(document.getElementById('root')).render(<AdminShell session={session}
        onOpenAgency={async id=>{window.openedAgency=id}}/>);` } });
  script = result.outputFiles[0]!.text;
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`owner can configure agencies with bounded lists at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__organizations", (route) => route.fulfill({ contentType: "text/html", body:
      `<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head>
       <body style="--green:#315ba8;--green-dark:#24447e;--inactive-button:#edf1fa;--text-color:#202850"><div id="root"></div><script src="/__organization-script"></script></body></html>` }));
    await page.route("**/__organization-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/api/admin/context", (route) => route.fulfill({ json: {
      organization: { id: rootId, name: "Parent EMS" }, panels: ["dashboard", "settings", "agencies"],
      capabilities: ["admin-dashboard:read", "settings:read", "settings:write"], dashboard: null, activeConfiguration: null,
    } }));
    let ordinarySettings = { ...newAgencySettings(), demographics: { ...newAgencySettings().demographics,
      agencyUniqueStateId: "OWNER", agencyNumber: "OWNER", stateCode: "36" } };
    await page.route("**/api/admin/agency-settings", (route) => {
      if (route.request().method() === "PUT") {
        const command = route.request().postDataJSON();
        expect(command.timeZone).toBe("Asia/Tokyo");
        ordinarySettings = { ...ordinarySettings, ...command, revision: ordinarySettings.revision + 1 };
      }
      return route.fulfill({ json: ordinarySettings });
    });
    let created: Record<string, unknown> | null = null;
    let conflict = true;
    let directoryLoads = 0;
    await page.route("**/api/super-admin/agencies", async (route) => {
      if (route.request().method() === "POST") {
        created = route.request().postDataJSON() as Record<string, unknown>;
        expect(route.request().headers()["x-csrf-token"]).toBe("csrf");
        if (conflict) return route.fulfill({ status: 409, json: { code: "admin.hostnameReserved", params: {} } });
        return route.fulfill({ json: { ...agencies[1], ...created, hostname: `${created?.hostname}.example.test`, id: "new-agency" } });
      }
      directoryLoads += 1;
      return route.fulfill({ json: { agencies: created && !conflict ? [...agencies, { ...agencies[1], ...created, hostname: `${created?.hostname}.example.test`, id: "new-agency" }] : agencies,
        hostnameSuffix: "example.test", catalogs: [{ id: catalogId, name: directoryLoads > 1 ? "Refreshed catalog" : "Baseline", activatedByAgencies: [{ id: rootId, name: "Parent EMS" }] }],
        forms: [{ id: formId, name: "Standard form · v1", organizationId: rootId, catalogReleaseId: catalogId,
          activatedByAgencies: [{ id: rootId, name: "Parent EMS" }] },
          { id: "unrelated", name: "Different catalog form", catalogReleaseId: "other", activatedByAgencies: [] }],
        validations: [{ id: validationId, name: "Standard validation · v1", organizationId: rootId, catalogReleaseId: catalogId, activatedByAgencies: [] }],
        activeConfigurations: [{ organizationId: rootId, catalogName: "Baseline", formName: "Standard form · v1", validationName: "Standard validation · v1" }],
      } });
    });
    await page.goto("/__organizations");
    await page.getByRole("button", { name: "Agency Settings", exact: true }).click();
    await expect(page.locator("#agency-time-zone")).toHaveRole("combobox");
    await page.locator("#agency-time-zone").selectOption("Asia/Tokyo");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".agency-settings-notice")).toBeVisible();
    await page.getByRole("button", { name: "Super-admin", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(15);
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
    const dimensions = await page.locator(".agency-table").evaluate((element) => ({ height: element.clientHeight, content: element.scrollHeight }));
    expect(dimensions.content).toBeGreaterThan(dimensions.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("tbody tr").first()).toContainText("Standard validation · v1");
    await page.getByRole("button", { name: "New agency", exact: true }).click();
    await expect(page.getByLabel("Starting form", { exact: true })).toBeDisabled();
    await page.getByLabel("Agency name", { exact: true }).fill("Ambulance division");
    await expect(page.getByLabel("Subdomain", { exact: true })).toHaveAttribute("placeholder", "test");
    await page.getByLabel("Subdomain", { exact: true }).fill("test.example.test");
    expect(await page.getByLabel("Subdomain", { exact: true }).evaluate((element: HTMLInputElement) => element.validity.patternMismatch)).toBe(true);
    await page.getByLabel("Subdomain", { exact: true }).fill("ambulance");
    await expect(page.locator("#agency-hostname-help")).toContainText("ambulance.example.test");
    await page.getByLabel("Parent agency", { exact: true }).selectOption(rootId);
    await page.getByLabel("Catalog", { exact: true }).selectOption("20000000-0000-4000-8000-000000000001");
    await expect(page.getByLabel("Starting form", { exact: true }).locator("option")).toHaveCount(2);
    await expect(page.getByLabel("Starting form", { exact: true }).locator("option").last()).toContainText("Activated by: Parent EMS");
    await expect(page.getByLabel("Starting validation rules").locator("option").last()).toContainText("Not activated by any agency");
    await page.getByLabel("Starting form", { exact: true }).selectOption(formId);
    await page.getByLabel("Starting validation rules").selectOption(validationId);
    await expect(page.locator("#starting-form-usage")).toHaveText("Activated by: Parent EMS");
    await expect(page.locator("#starting-validation-usage")).toHaveText("Not activated by any agency");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator(".agency-configuration-selectors select")).toHaveCount(4);
    const selectorPositions = await page.locator(".agency-configuration-selectors select").evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top));
    expect(new Set(selectorPositions).size).toBe(4);
    const selectorLefts = await page.locator(".agency-configuration-selectors select").evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().left));
    expect(new Set(selectorLefts).size).toBe(1);
    await page.screenshot({ path: `/tmp/starting-config-${viewport.width}.png`, fullPage: true });
    await expect(page.locator("#new-agency-time-zone")).toHaveRole("combobox");
    await page.locator("#new-agency-time-zone").selectOption("Europe/Stockholm");
    await page.locator("#new-agency-language").selectOption("sv");
    await page.locator("#new-agency-regional-format").selectOption("sv-SE");
    await page.locator(".agency-management").getByLabel("Brand text", { exact: true }).fill("New agency brand");
    await page.locator(".agency-management").getByLabel("dAgency.01 — EMS Agency Unique State ID", { exact: true }).fill("TEST");
    await page.locator(".agency-management").getByLabel("dAgency.02 — EMS Agency Number", { exact: true }).fill("TEST-01");
    await page.locator(".agency-management").getByLabel("dAgency.04 — ANSI state code", { exact: true }).fill("36");
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.getByRole("button", { name: "Super-admin", exact: true }).click();
    await expect(page.getByLabel("Catalog", { exact: true }).locator("option").last()).toContainText("Refreshed catalog");
    await expect(page.locator("#new-agency-time-zone")).toHaveValue("Europe/Stockholm");
    await expect(page.getByLabel("Agency name", { exact: true })).toHaveValue("Ambulance division");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("already assigned");
    await expect(page.getByLabel("Agency name", { exact: true })).toHaveValue("Ambulance division");
    conflict = false;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByLabel("Find agency")).toBeVisible();
    expect(created).toMatchObject({ parentOrganizationId: rootId, hostname: "ambulance",
      startingFormVersionId: formId, startingValidationVersionId: validationId,
      settings: { language: "sv", regionalFormat: "sv-SE", timeZone: "Europe/Stockholm", appearance: { brandText: "New agency brand" },
        demographics: { agencyUniqueStateId: "TEST", agencyNumber: "TEST-01", stateCode: "36" } } });
    await page.getByLabel("Find agency").fill("Ambulance division");
    await page.getByRole("button", { name: "Open admin", exact: true }).click();
    expect(await page.evaluate(() => (window as Window & { openedAgency?: string }).openedAgency)).toBe("new-agency");
    await page.getByRole("button", { name: "Edit: Ambulance division", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Agency name", { exact: true })).toHaveValue("Ambulance division");
    await expect(page.getByLabel("Subdomain", { exact: true })).toHaveValue("ambulance");
    await expect(page.locator("#agency-hostname-help")).toHaveText("Full hostname: ambulance.example.test");
    await page.screenshot({ path: `/tmp/multi-org-${viewport.width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
