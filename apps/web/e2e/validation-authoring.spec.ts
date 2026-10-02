import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminLanguageContext} from './app/admin-localization';
      import {ValidationAuthoring} from './components/validation-authoring';
      createRoot(document.getElementById('root')).render(
        <AdminLanguageContext.Provider value="en"><ValidationAuthoring language="en" csrfToken="proof"
          catalogReleaseId="catalog" capabilities={['validation:read','validation:write','validation:publish']}/>
        </AdminLanguageContext.Provider>);`
    } });
  script = result.outputFiles[0]!.text;
});

test("validation rule creation, language, severity, targets, source, save, and validation survive reload", async ({ page }) => {
  const element = { elementId: "ePatient.02", label: "Last Name", baseDatatype: "string",
    storageSemantics: { groupPath: ["PatientCareReportGroup", "ePatient.PatientNameGroup"] },
    constraints: { minOccurs: 0, maxOccurs: 1 } };
  let draft = { id: "draft", revision: 1, displayName: "Agency rules", catalogReleaseId: "catalog", rules: [] as Record<string, unknown>[] };
  const catalog = { id: "catalog", definition: { elements: [element], codeLists: [] } };
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  await page.route("**/__validation-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__validation-harness", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__validation-script"></script></body></html>' }));
  await page.route("**/api/admin/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/admin/", "");
    const method = route.request().method();
    const body = method === "GET" ? undefined : route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ path, method, ...(body ? { body } : {}) });
    if (path === "validation-draft") return route.fulfill({ json: draft });
    if (path === "validation-versions" || path === "form-versions") return route.fulfill({ json: [] });
    if (path === "catalog-versions/catalog") return route.fulfill({ json: catalog });
    if (path.startsWith("validation-rules")) return route.fulfill({ json: { items: draft.rules.map(rule => ({
      rule, source: "agency", validity: "valid", diagnostics: [] })), total: draft.rules.length, nextCursor: null } });
    if (path === "validation-drafts/draft/rules" && method === "POST") {
      draft = { ...draft, revision: draft.revision + 1,
        rules: [...draft.rules, { ...body, id: "52000000-0000-4000-8000-000000000001" }] };
      return route.fulfill({ json: draft });
    }
    if (path === "validation-drafts/draft" && method === "PUT") {
      draft = { ...draft, revision: draft.revision + 1, displayName: body!.displayName as string,
        rules: body!.rules as Record<string, unknown>[] };
      return route.fulfill({ json: draft });
    }
    if (path === "validation-drafts/draft/validate") return route.fulfill({ json: { valid: true, diagnostics: [], explanation: "One rule checked." } });
    return route.fulfill({ status: 404, body: path });
  });
  await page.goto("/__validation-harness");
  await page.getByRole("button", { name: "Create agency rule" }).click();
  const editor = page.locator(".validation-rule-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Name (en)").fill("Require patient name");
  await editor.getByLabel("Message (en)").fill("Enter the patient name");
  await editor.getByLabel("Severity", { exact: true }).selectOption("error");
  await editor.getByRole("group", { name: "Targets" }).getByLabel("sign").check();
  await editor.getByRole("group", { name: "Targets" }).getByLabel("review").check();
  await editor.getByLabel("Review priority").selectOption("high");
  await editor.getByLabel("Wording language").selectOption("sv");
  await editor.getByLabel("Name (sv)").fill("Ange patientnamn");
  await editor.getByLabel("Message (sv)").fill("Ange patientens namn");
  await editor.getByLabel("Rule source").fill("required ePatient.02");
  await expect(page.getByRole("alert", { name: "Inline rule diagnostics" })).toBeVisible();
  await editor.getByLabel("Rule source").fill('require present("ePatient.02")');
  await expect(page.getByRole("alert", { name: "Inline rule diagnostics" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save validation draft" }).click();
  await expect(page.getByRole("button", { name: "Validate draft" })).toBeEnabled();
  await page.getByRole("button", { name: "Validate draft" }).click();
  await expect(page.locator(".validation-result")).toContainText("Validation passed");
  expect(draft.rules[0]).toMatchObject({ name: "Require patient name", severity: "error", reviewPriority: "high",
    executionTargets: ["live", "sign", "review"], source: 'require present("ePatient.02")',
    localization: { sv: { name: "Ange patientnamn", message: "Ange patientens namn" } } });
  expect(requests.some(({ path, method }) => path === "validation-drafts/draft" && method === "PUT")).toBe(true);
  await page.reload();
  await expect(page.locator(".validation-rule-editor").getByLabel("Name (en)")).toHaveValue("Require patient name");
  await expect(page.locator(".validation-rule-editor").getByLabel("Review priority")).toHaveValue("high");
  await expect(page.locator(".validation-rule-table")).toContainText("High");
});
