import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {StationaryRepeatingGroups} from './components/stationary-repeating-groups';
      import {StationaryFormPreview} from './components/stationary-form-preview';
      import {COMPILED_STATIONARY_LAYOUT} from './app/stationary-layout';
      import {configuredRepeatingGroupRoots} from './app/stationary-repeating-group';
      import synthetic from './app/data/synthetic-encounter-document.json';
      const initial = {...synthetic, groups: synthetic.groups.filter(g=>!g.id.startsWith('eVitals.') && !g.id.startsWith('ePatient'))};
      const definition = {schemaVersion:1, sections:[{key:'vitals', fields:[
        {key:'systolic',source:{kind:'nemsis',elementId:'eVitals.06'}},
        {key:'temperature',source:{kind:'nemsis',elementId:'eVitals.24'}}]}]};
      function Harness() {
        const [document,setDocument]=useState(()=>JSON.parse(localStorage.getItem('nested-document')||'null')||initial);
        const [readOnly,setReadOnly]=useState(false);
        const flatten = groups=>groups.flatMap(g=>[g,...flatten(g.children)]);
        const compiled = flatten(COMPILED_STATIONARY_LAYOUT.hierarchy);
        const patient = compiled.find(g=>g.id==='ePatientSection');
        const deep = {...compiled.find(g=>g.id==='PatientCareReportGroup'),
          mode:'editable',presentation:{kind:'table',label:'Report'},elements:[],children:[{
            ...patient,elements:[],children:patient.children.filter(g=>g.id==='ePatient.PatientNameGroup')}]};
        const groups=(location.search==='?deep'?[deep]:configuredRepeatingGroupRoots()).filter(g=>g.id==='eVitals.VitalGroup'||g.id==='PatientCareReportGroup')
          .map(g=>readOnly?{...g,mode:'read-only'}:g);
        return <><button onClick={()=>setReadOnly(!readOnly)}>Toggle read only</button>
          <StationaryRepeatingGroups document={document} groups={groups} onDocumentChange={next=>{
            setDocument(next);localStorage.setItem('nested-document',JSON.stringify(next));}}/>
          <output data-testid="document">{JSON.stringify(document)}</output></>;
      }
      createRoot(document.getElementById('root')).render(location.search==='?preview'
        ? <StationaryFormPreview draft={{definition}} onReturn={()=>{}}/> : <Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

async function open(page: Page, variant = "") {
  await page.route("**/__nested-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__nested-harness*", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__nested-script"></script></body></html>' }));
  await page.goto(`/__nested-harness${variant ? `?${variant}` : ""}`);
}
const bp = (page: Page) => page.getByRole("dialog").locator('.stationary-dialog-field[data-element-id="eVitals.06"] input');
const stored = async (page: Page) => JSON.parse((await page.getByTestId("document").textContent())!);

test("single children are immediately usable, scoped to parents and saved only on commit", async ({ page }) => {
  await open(page);
  const before = await stored(page);
  await page.getByRole("button", { name: "Add Vital", exact: true }).click();
  await expect(bp(page)).toBeVisible();
  await expect(page.getByRole("button", { name: /Add .* fields/ })).toHaveCount(0);
  await bp(page).fill("120");
  await bp(page).press("Tab");
  expect(await stored(page)).toEqual(before);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await stored(page)).toEqual(before);
  for (const value of ["120", "140"]) {
    await page.getByRole("button", { name: "Add Vital", exact: true }).click();
    await expect(bp(page)).toHaveValue("");
    await bp(page).fill(value);
    await bp(page).press("Tab");
    await page.getByRole("button", { name: "Add row", exact: true }).click();
  }
  const saved = await stored(page);
  const children = saved.groups.find((g: {id: string}) => g.id === "eVitals.BloodPressureGroup").instances;
  expect(children).toHaveLength(2);
  expect(new Set(children.map((i: {parentInstanceId: string})=>i.parentInstanceId)).size).toBe(2);
  await page.reload();
  for (const [index, value] of ["120", "140"].entries()) {
    await page.getByRole("button", { name: "Edit Vital row" }).nth(index).click();
    await expect(bp(page)).toHaveValue(value);
    await bp(page).fill("160");
    await bp(page).press("Tab");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(await stored(page)).toEqual(saved);
  await page.getByRole("button", { name: "Edit Vital row" }).first().click();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(await stored(page)).toEqual(saved);
  await page.getByRole("button", { name: "Toggle read only" }).click();
  await page.getByRole("button", { name: "View Vital row" }).first().click();
  await expect(page.getByRole("dialog").locator('[data-element-id="eVitals.06"]')).toContainText("120");
  await expect(page.getByRole("dialog").locator("input, select, textarea")).toHaveCount(0);
});

test("existing empty entries and read-only descendants show fields without inventing occurrences", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Add Vital", exact: true }).click();
  await bp(page).focus();
  await bp(page).press("Tab");
  await page.getByRole("button", { name: "Add row", exact: true }).click();
  const saved = await stored(page);
  expect(saved.groups.some((g: {id: string})=>g.id==='eVitals.BloodPressureGroup')).toBe(false);
  await page.getByRole("button", { name: "Edit Vital row" }).click();
  await expect(bp(page)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Toggle read only" }).click();
  await page.getByRole("button", { name: "View Vital row" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator('[data-group-id="eVitals.BloodPressureGroup"]')).toContainText("Not recorded");
  await expect(dialog.locator("input, select, textarea")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Add/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(await stored(page)).toEqual(saved);
});

test("form preview shows included single children immediately", async ({ page }) => {
  await open(page, "preview");
  await page.getByRole("button", { name: "Add Vital", exact: true }).click();
  await expect(bp(page)).toBeVisible();
  await expect(page.getByRole("dialog").locator('[data-element-id="eVitals.24"] input')).toBeVisible();
  await expect(page.getByRole("dialog").locator('[data-element-id="eVitals.07"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add .* fields/ })).toHaveCount(0);
});


test("nested single descendants retain the entire parent occurrence chain", async ({ page }) => {
  await open(page, "deep");
  await page.getByRole("button", { name: "Edit Report row" }).click();
  const name = page.getByRole("dialog").locator('.stationary-dialog-field[data-element-id="ePatient.02"] input');
  await expect(name).toBeVisible();
  await name.fill("Synthetic surname");
  await name.press("Tab");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  const saved = await stored(page);
  const section = saved.groups.find((g: {id: string})=>g.id==='ePatientSection').instances;
  const names = saved.groups.find((g: {id: string})=>g.id==='ePatient.PatientNameGroup').instances;
  expect(section).toHaveLength(1);
  expect(names).toHaveLength(1);
  expect(names[0].parentInstanceId).toBe(section[0].instanceId);
  expect(section[0].parentInstanceId).toBe(saved.groups.find((g: {id: string})=>g.id==='PatientCareReportGroup').instances[0].instanceId);
  await page.getByRole("button", { name: "Edit Report row" }).click();
  await expect(name).toHaveValue("Synthetic surname");
});
