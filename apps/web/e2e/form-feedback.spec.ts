import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminLanguageContext} from './app/admin-localization';
      import {StationaryFormAuthoring} from './components/stationary-form-authoring';
      function Harness() { const [language,setLanguage]=useState('en'); return <AdminLanguageContext.Provider value={language}>
        <button onClick={()=>setLanguage(language==='en'?'sv':'en')}>Switch language</button>
        <StationaryFormAuthoring language={language} csrfToken="test-csrf" catalogReleaseId="catalog"
          capabilities={['forms:read','forms:write','forms:publish','validation:read','validation:write','validation:publish']}/>
      </AdminLanguageContext.Provider>; } createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

async function editor(page: import("@playwright/test").Page) {
  let draft = { id: "draft", formId: "form", catalogReleaseId: "catalog", revision: 1,
    displayName: "Reduced form", definitionSha256: "a".repeat(64), diagnostics: [],
    updatedAt: "2026-09-29T12:00:00Z", definition: { schemaVersion: 1, sections: [{ key: "patient", fields: [
      { key: "name", source: { kind: "nemsis", elementId: "ePatient.02" } },
      { key: "age", source: { kind: "nemsis", elementId: "ePatient.15" } },
    ] }, { key: "assessment", fields: [] }] } };
  const requests: Record<string, unknown>[] = [];
  let loads = 0;
  await page.route("**/__feedback-harness", (route) => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__feedback-script"></script></body></html>' }));
  await page.route("**/__feedback-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/api/admin/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/form-draft")) { loads++; return route.fulfill({ json: draft }); }
    if (pathname.endsWith("/form-drafts/draft")) {
      const body = route.request().postDataJSON();
      draft = { ...draft, ...body, revision: draft.revision + 1 };
      return route.fulfill({ json: draft });
    }
    if (pathname.endsWith("/catalog-elements")) return route.fulfill({ json: { items: [
      { elementId: "ePatient.01", name: "Patient ID", baseDatatype: "string", groupPath: ["ePatient"] },
    ], nextCursor: null } });
    if (pathname.endsWith("/form-versions")) return route.fulfill({ json: [
      { id: "published", displayName: "Reduced form", status: "published", version: 2, catalogReleaseId: "catalog" },
    ] });
    if (pathname.endsWith("/validation-versions")) return route.fulfill({ json: [
      { id: "validation", displayName: "Existing rules", status: "active", version: 1, catalogReleaseId: "catalog" },
    ] });
    if (pathname.endsWith("/activate")) {
      const body = route.request().postDataJSON(); requests.push(body);
      expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
      if (!body.removeImpactedRuleIds) return route.fulfill({ status: 422, json: {
        code: "admin.formValidationRemovalRequired", params: { count: 2 }, impactedRules: [
          { id: "rule-1", name: "Patient name required" }, { id: "rule-2", name: "Related patient check" },
        ],
      } });
      return route.fulfill({ json: { formVersionId: "published", catalogReleaseId: "catalog" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/__feedback-harness");
  return { requests, loads: () => loads };
}

test("field removal survives language changes and save/reload", async ({ page }) => {
  const state = await editor(page);
  await expect(page.getByText("Required on this form", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Required by the catalog", { exact: true })).toHaveCount(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove ePatient.02", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove ePatient.02", exact: true })).toHaveCount(0);
  const initialLoads = state.loads();
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.getByRole("button", { name: "Spara formulärutkast", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Switch language" }).click();
  await expect(page.getByRole("button", { name: "Remove ePatient.02", exact: true })).toHaveCount(0);
  expect(state.loads()).toBe(initialLoads);
  await page.getByRole("button", { name: "Save form draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save form draft", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove ePatient.15", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove ePatient.02", exact: true })).toHaveCount(0);
});

test("row actions preserve renamed groups and additions through save/reload", async ({ page }) => {
  await editor(page);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const actions = page.getByRole("group", { name: "Actions for assessment", exact: true });
  await actions.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Section name", { exact: true }).fill("Initial assessment");
  await actions.getByRole("button", { name: "Done", exact: true }).click();
  await actions.getByRole("button", { name: "Add elements", exact: true }).click();
  await page.getByRole("searchbox").fill("patient id");
  await page.getByRole("button", { name: "Add ePatient.01", exact: true }).click();
  await expect(page.getByRole("list", { name: "assessment form elements" })).toContainText("ePatient.01");
  await page.getByRole("button", { name: "Save form draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save form draft", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByLabel("Go to section").selectOption("assessment");
  await expect(page.locator(".form-section-heading").filter({ hasText: "Initial assessment" })).toBeVisible();
  await expect(page.getByRole("list", { name: "assessment form elements" })).toContainText("ePatient.01");
  await page.getByLabel("Go to section").selectOption("patient");
  const fields = page.getByRole("list", { name: "patient form elements" });
  await expect(fields).toContainText("ePatient.02");
  await expect(fields).not.toContainText("ePatient.01");
});

test("activation lists affected rules and requires explicit agreement after cancel", async ({ page }) => {
  const state = await editor(page);
  await page.getByLabel("Activation note", { exact: true }).fill("Remove unused patient fields");
  await page.getByRole("button", { name: "Activate selected version", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Remove impacted validation rules?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("Patient name required");
  await expect(confirmation).toContainText("Related patient check");
  expect(state.requests).toHaveLength(1);
  await confirmation.getByRole("button", { name: "Cancel activation" }).click();
  await expect(confirmation).toHaveCount(0);
  expect(state.requests).toHaveLength(1);
  await page.getByRole("button", { name: "Activate selected version", exact: true }).click();
  await confirmation.getByRole("button", { name: "Agree, remove rules and activate" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByText("Form activated for new reports. Existing reports remain pinned to their original versions.", { exact: true })).toBeVisible();
  expect(state.requests).toHaveLength(3);
  expect(state.requests[2]).toEqual({ validationVersionId: "validation", changeNote: "Remove unused patient fields",
    removeImpactedRuleIds: ["rule-1", "rule-2"] });
});
