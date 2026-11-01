import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";
import { buildDemoFixtures } from "../scripts/demo-fixture-core";
import type { DispatchValidationCatalog } from "../../api/src/dispatch/dispatch-assignment.validation";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {StationaryNonRepeatingRecord} from './components/stationary-non-repeating-record';
      import {STATIONARY_NON_REPEATING_GROUPS} from './app/stationary-non-repeating';
      const groups=STATIONARY_NON_REPEATING_GROUPS.filter(group => group.id.startsWith('ePatient'));
      createRoot(document.getElementById('root')).render(
        <StationaryNonRepeatingRecord document={window.fixture} groups={groups} onDocumentChange={()=>{}}/>);`
    } });
  script = result.outputFiles[0]!.text;
});

for (const [index, name] of ["andrea", "arne"].entries()) {
  test(`opens the ${name} dispatch with the EPS sample identity and demographics`, async ({ page }) => {
    const root = path.resolve(__dirname, "../../..");
    const patient = JSON.parse(readFileSync(path.join(root, `packages/contracts/examples/hospital/${name}-patient.json`), "utf8"));
    const bytes = readFileSync(path.join(root, `packages/contracts/examples/dispatch/synthetic-assignment-0${index + 1}.json`));
    const catalog = JSON.parse(readFileSync(path.join(root, "defines/catalog/catalog_nemsis-3.5.1.json"), "utf8")) as DispatchValidationCatalog;
    const document = buildDemoFixtures(JSON.parse(bytes.toString()), catalog, bytes).encounterDocument;
    await page.route("**/__patient-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__patient-harness", route => route.fulfill({ contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><body><div id="root"></div><script>window.fixture=${JSON.stringify(document)}</script><script src="/__patient-script"></script></body></html>` }));
    await page.goto("/__patient-harness");
    await expect(page.locator('[data-element-id="ePatient.01"] input')).toHaveValue(patient.identifier[0].value);
    await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue(patient.name[0].given[0]);
    await expect(page.getByRole("textbox", { name: "Last Name", exact: true })).toHaveValue(patient.name[0].family);
    await expect(page.locator('[data-element-id="ePatient.17"] input')).toHaveValue(patient.birthDate);
    await expect(page.locator('fieldset[data-element-id="ePatient.18"] input[type="tel"]').first()).toHaveValue(patient.telecom.find((item: { system: string }) => item.system === "phone").value);
    const home = patient.address.find((address: { use: string }) => address.use === "home");
    await expect(page.locator('[data-element-id="ePatient.05"] input')).toHaveValue(home.line[0]);
    await expect(page.locator('[data-element-id="ePatient.09"] input')).toHaveValue(home.postalCode.replaceAll(" ", ""));
    await expect(page.getByRole('group', { name: 'Sex', exact: true })).toContainText(patient.gender === "female" ? "Female" : "Male");
  });
}
