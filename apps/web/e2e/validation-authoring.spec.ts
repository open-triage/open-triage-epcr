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

for (const newlyPublished of [false, true]) {
  test(`validation activation reviews incompatible rules ${newlyPublished ? "after publication" : "from version selection"}`, async ({ page }) => {
    const rules = Array.from({ length: 408 }, (_, index) => ({ id: `rule-${index}`, name: `NEMSIS check ${index + 1}` }));
    const requests: Record<string, unknown>[] = [];
    const candidate = { id: "validation", displayName: "NEMSIS full", status: "published", version: 2, catalogReleaseId: "catalog" };
    const previous = { id: "previous", displayName: "Existing rules", status: "active", version: 1, catalogReleaseId: "catalog" };
    const compatible = { id: "compatible", displayName: "NEMSIS full (form compatibility)", status: "active", version: 3, catalogReleaseId: "catalog" };
    let activated = false;
    const draft = { id: "draft", revision: 1, displayName: candidate.displayName, catalogReleaseId: "catalog", rules: [{
      id: "52000000-0000-4000-8000-000000000001", name: "Require patient name", message: "Enter the patient name",
      source: 'require present("ePatient.02")', primaryTargetElementId: "ePatient.02", sourceKind: "agency",
      enabled: true, severity: "error", executionTargets: ["live", "sign"],
    }] };
    await page.route("**/__validation-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__validation-harness", route => route.fulfill({ contentType: "text/html",
      body: '<html lang="en"><body><div id="root"></div><script src="/__validation-script"></script></body></html>' }));
    await page.route("**/api/admin/**", route => {
      const pathname = new URL(route.request().url()).pathname.replace("/api/admin/", "");
      if (pathname === "canonical/validation/synchronize") return route.fulfill({ json: { errors: [] } });
      if (pathname === "validation-draft") return route.fulfill({ json: newlyPublished ? draft : null });
      if (pathname === "validation-versions") return route.fulfill({ json: activated
        ? [{ ...previous, status: "published" }, candidate, compatible] : [previous, candidate] });
      if (pathname === "form-versions") return route.fulfill({ json: [
        { id: "form", displayName: "Reduced form", status: "active", version: 1, catalogReleaseId: "catalog" },
        { id: "other-form", displayName: "Other form", status: "published", version: 2, catalogReleaseId: "catalog" },
      ] });
      if (pathname === "catalog-definition" || pathname === "catalog-versions/catalog") return route.fulfill({ json: {
        id: "catalog", definition: { elements: [{ elementId: "ePatient.02", label: "Last Name", baseDatatype: "string",
          storageSemantics: { groupPath: ["PatientCareReportGroup", "ePatient.PatientNameGroup"] },
          constraints: { minOccurs: 0, maxOccurs: 1 } }], codeLists: [] },
      } });
      if (pathname === "validation-rules") return route.fulfill({ json: { items: draft.rules.map(rule => ({ rule,
        source: "agency", validity: "valid", diagnostics: [] })), total: 1, nextCursor: null } });
      if (pathname.endsWith("/validate")) return route.fulfill({ json: { valid: true, diagnostics: [] } });
      if (pathname.endsWith("/publish")) return route.fulfill({ json: { ...candidate, ruleIds: [draft.rules[0]!.id] } });
      if (pathname === "validation-versions/validation/activate") {
        const body = route.request().postDataJSON(); requests.push(body);
        expect(route.request().headers()["x-csrf-token"]).toBe("proof");
        if (!body.removeImpactedRuleIds) return route.fulfill({ status: 422, json: {
          code: "admin.formValidationRemovalRequired", params: { count: rules.length }, impactedRules: rules,
        } });
        activated = true;
        return route.fulfill({ json: { validationVersionId: compatible.id, formVersionId: body.formVersionId, catalogReleaseId: "catalog" } });
      }
      return route.fulfill({ status: 404, body: pathname });
    });
    await page.goto("/__validation-harness");
    if (newlyPublished) {
      await page.getByRole("button", { name: "Validate draft", exact: true }).click();
      await page.getByLabel("Publication note", { exact: true }).fill("Publish NEMSIS rules");
      await page.getByRole("button", { name: "Publish immutable Validation version", exact: true }).click();
    } else {
      await page.getByLabel("Version", { exact: true }).selectOption(candidate.id);
    }
    const activate = page.getByRole("button", { name: newlyPublished ? "Activate for clinical use" : "Activate selected version", exact: true });
    await page.getByLabel("Activation note", { exact: true }).fill("Use NEMSIS rules with reduced form");
    await activate.click();
    const confirmation = page.getByRole("alertdialog", { name: "Remove impacted validation rules?" });
    await expect(confirmation).toBeFocused();
    await expect(confirmation.getByRole("listitem")).toHaveCount(408);
    await expect(confirmation).toContainText("NEMSIS check 408");
    expect(activated).toBe(false);
    expect(requests).toHaveLength(1);
    await confirmation.getByRole("button", { name: "Cancel activation" }).click();
    await expect(confirmation).toHaveCount(0);
    expect(requests).toHaveLength(1);
    await activate.click();
    await expect(confirmation).toBeVisible();
    await page.getByLabel("Form editor", { exact: true }).selectOption("other-form");
    await expect(confirmation).toHaveCount(0);
    expect(requests).toHaveLength(2);
    await activate.click();
    await confirmation.getByRole("button", { name: "Agree, remove rules and activate" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByLabel("Version", { exact: true })).toHaveValue(compatible.id);
    await expect(page.locator(".authoring-version-state")).toHaveText("Active");
    expect(requests).toHaveLength(4);
    expect(requests[3]).toEqual({ formVersionId: "other-form", catalogReleaseId: "catalog",
      changeNote: "Use NEMSIS rules with reduced form", removeImpactedRuleIds: rules.map(({ id }) => id) });
  });
}

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
    const body = !route.request().postData() ? undefined : route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ path, method, ...(body ? { body } : {}) });
    if (path === "canonical/validation/synchronize") return route.fulfill({ json: { errors: [] } });
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
  await expect(page.getByText("Canonical JSON files", { exact: true })).toHaveCount(0);
  await expect.poll(() => requests.filter(({ path }) => path === "canonical/validation/synchronize").length).toBe(1);
  await page.getByRole("button", { name: "Create agency rule" }).click();
  const editor = page.locator(".validation-rule-editor");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Name (en)").fill("Require patient name");
  await editor.getByLabel("Message (en)").fill("Enter the patient name");
  await editor.getByLabel("Documentation severity", { exact: true }).selectOption("none");
  await editor.getByRole("group", { name: "Targets" }).getByLabel("sign").check();
  await editor.getByRole("group", { name: "Targets" }).getByLabel("review").check();
  await editor.getByLabel("Review priority").selectOption("none");
  await expect(editor.getByLabel("Review priority")).toHaveValue("none");
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
  expect(draft.rules[0]).toMatchObject({ name: "Require patient name", severity: "none", reviewPriority: "high",
    executionTargets: ["live", "sign", "review"], source: 'require present("ePatient.02")',
    localization: { sv: { name: "Ange patientnamn", message: "Ange patientens namn" } } });
  expect(requests.some(({ path, method }) => path === "validation-drafts/draft" && method === "PUT")).toBe(true);
  await page.reload();
  await expect(page.locator(".validation-rule-editor").getByLabel("Name (en)")).toHaveValue("Require patient name");
  await expect(page.locator(".validation-rule-editor").getByLabel("Documentation severity", { exact: true })).toHaveValue("none");
  await expect(page.locator(".validation-rule-editor").getByLabel("Review priority")).toHaveValue("high");
  await expect(page.locator(".validation-rule-table")).toContainText("High");
});
