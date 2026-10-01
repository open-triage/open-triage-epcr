import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import synthetic from './app/data/synthetic-encounter-document.json';
      import {StationaryNonRepeatingRecord} from './components/stationary-non-repeating-record';
      import {STATIONARY_NON_REPEATING_GROUPS} from './app/stationary-non-repeating';
      const groups=STATIONARY_NON_REPEATING_GROUPS.filter(group =>
        group.id==='ePatient.PatientNameGroup' || group.id==='eNarrativeSection');
      function Harness(){
        const [document,setDocument]=useState({...synthetic,groups:[]});
        return <><StationaryNonRepeatingRecord document={document} groups={groups} onDocumentChange={setDocument}/>
          <output data-testid="document">{JSON.stringify(document)}</output></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test("rapid first edits on a new patient retain adjacent fields and narrative", async ({ page }) => {
  await page.route("**/__new-patient-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__new-patient-harness", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__new-patient-script"></script></body></html>' }));
  await page.goto("/__new-patient-harness");
  await page.getByRole("textbox", { name: "First Name", exact: true }).fill("FIRST");
  await page.getByRole("textbox", { name: "Last Name", exact: true }).fill("LAST");
  await page.getByRole("textbox", { name: "Last Name", exact: true }).press("Tab");
  const narrative = page.locator('[data-element-id="eNarrative.01"] textarea');
  await narrative.fill("Rapidly entered narrative");
  await narrative.press("Tab");
  await expect(page.getByRole("textbox", { name: "First Name", exact: true })).toHaveValue("FIRST");
  await expect(page.getByRole("textbox", { name: "Last Name", exact: true })).toHaveValue("LAST");
  await expect(narrative).toHaveValue("Rapidly entered narrative");
  const document = JSON.parse(await page.getByTestId("document").innerText()) as {
    groups: Array<{ id: string; instances: Array<{ elements: Array<{ id: string; values: Array<{ value?: string }> }> }> }>;
  };
  const value = (groupId: string, elementId: string) => document.groups.find(group => group.id === groupId)
    ?.instances[0]?.elements.find(element => element.id === elementId)?.values[0]?.value;
  expect(value("ePatient.PatientNameGroup", "ePatient.03")).toBe("FIRST");
  expect(value("ePatient.PatientNameGroup", "ePatient.02")).toBe("LAST");
  expect(value("eNarrativeSection", "eNarrative.01")).toBe("Rapidly entered narrative");
});
