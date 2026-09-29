import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {RepeatedCustomFields} from './components/repeated-custom-fields';
      import {syntheticEncounter} from './app/standard-encounter';
      const base={...syntheticEncounter.document,groups:[...syntheticEncounter.document.groups.filter(g=>g.id!=='eMedications.MedicationGroup'),
        {id:'eMedications.MedicationGroup',instances:[
          {instanceId:'med-a',elements:[{id:'eMedications.03',values:[{kind:'coded',occurrenceId:'drug-a',code:'A',display:'Medication A'}]}]},
          {instanceId:'med-b',elements:[{id:'eMedications.03',values:[{kind:'coded',occurrenceId:'drug-b',code:'B',display:'Medication B'}]}]}]}]};
      const common={namespace:'org.example.ems',usage:'Optional',identifying:false,recurrence:'multiple'};
      const definitions={
        text:{...common,id:'10000000-0000-4000-8000-000000000001',slug:'ResponseNote',title:'Response note',definition:'Medication response',datatype:'string',constraints:{},correlatesTo:'eMedications.MedicationGroup'},
        coded:{...common,id:'10000000-0000-4000-8000-000000000002',slug:'ResponseCode',title:'Response code',definition:'Coded response',datatype:'coded',correlatesTo:'eMedications.MedicationGroup',codeSystem:'https://example.org/codes',choices:[{code:'A',label:'Improved'}],permittedNotValues:['7701003'],permittedPertinentNegatives:['8801019']},
        number:{...common,id:'10000000-0000-4000-8000-000000000003',slug:'Score',title:'Score',definition:'Numeric result',datatype:'number',constraints:{}},
        boolean:{...common,id:'10000000-0000-4000-8000-000000000004',slug:'Flag',title:'Flag',definition:'Boolean result',datatype:'boolean',constraints:{}},
        dateTime:{...common,id:'10000000-0000-4000-8000-000000000005',slug:'ObservedAt',title:'Observed at',definition:'Time result',datatype:'dateTime',constraints:{}},
        binary:{...common,id:'10000000-0000-4000-8000-000000000006',slug:'Attachment',title:'Attachment',definition:'Binary result',datatype:'binary',constraints:{}}
      };
      const fields=Object.entries(definitions).map(([key,definition])=>({key,source:{kind:'custom',elementDefinitionId:definition.id},
        allowedAbsenceStates:key==='coded'?['7701003','8801019']:[]}));
      const customFields=Object.fromEntries(Object.values(definitions).map(d=>[d.id,d]));
      function Harness(){
        const [doc,setDoc]=useState(()=>JSON.parse(localStorage.getItem('repeated-custom-document')||'null')||base);
        const [view,setView]=useState('stationary');
        const [moved,setMoved]=useState(false);
        const update=next=>{setDoc(next);localStorage.setItem('repeated-custom-document',JSON.stringify(next));};
        return <><button onClick={()=>setView(view==='stationary'?'mobile':'stationary')}>Switch view</button>
          <button onClick={()=>setMoved(!moved)}>Move section</button>
          <section aria-label={view+' '+(moved?'treatment':'history')}>
            <RepeatedCustomFields document={doc} fields={fields} definitions={customFields} onDocumentChange={update}/>
          </section><output data-testid="document">{JSON.stringify(doc)}</output></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

async function open(page: Page) {
  await page.route("**/__repeated-custom-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__repeated-custom-harness", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__repeated-custom-script"></script></body></html>' }));
  await page.goto("/__repeated-custom-harness");
}
async function stored(page: Page) {
  return JSON.parse((await page.getByTestId("document").textContent())!);
}
const field = (page: Page, name: string) => page.getByRole("group", { name });

test("medication values retain separate occurrence identities across section, view, and browser recovery", async ({ page }) => {
  await open(page);
  const original = await stored(page);
  const notes = field(page, "Response note");
  const first = notes.locator('[data-custom-target-id="med-a"]');
  const second = notes.locator('[data-custom-target-id="med-b"]');
  await expect(first).toContainText("Medication A");
  await expect(second).toContainText("Medication B");
  await first.getByRole("button", { name: "Add value" }).click();
  expect(await stored(page)).toEqual(original);
  await first.getByRole("textbox", { name: "Response note 1" }).fill("Better");
  await second.getByRole("button", { name: "Add value" }).click();
  await second.getByRole("textbox", { name: "Response note 1" }).fill("No change");
  await first.getByRole("button", { name: "Add value" }).click();
  await first.getByRole("textbox", { name: "Response note 2" }).fill("Reassessed");
  const before = await stored(page);
  await page.getByRole("button", { name: "Move section" }).click();
  await page.getByRole("button", { name: "Switch view" }).click();
  await expect(page.getByRole("region", { name: "mobile treatment" })).toBeVisible();
  expect(await stored(page)).toEqual(before);
  await page.reload();
  expect(await stored(page)).toEqual(before);
  const recovered = field(page, "Response note");
  await expect(recovered.locator('[data-custom-target-id="med-a"] textarea').nth(0)).toHaveValue("Better");
  await expect(recovered.locator('[data-custom-target-id="med-a"] textarea').nth(1)).toHaveValue("Reassessed");
  await expect(recovered.locator('[data-custom-target-id="med-b"] textarea')).toHaveValue("No change");
  const groups = (await stored(page)).groups.find((group: {id: string}) => group.id === "eMedications.MedicationGroup").instances;
  expect(groups[0].elements.find((element: {id: string}) => element.id.endsWith("ResponseNote")).values).toHaveLength(2);
  expect(groups[1].elements.find((element: {id: string}) => element.id.endsWith("ResponseNote")).values).toHaveLength(1);
});

test("coded, exceptional, scalar and binary paths wait for an explicit value", async ({ page }) => {
  await open(page);
  const original = await stored(page);
  const codes = field(page, "Response code").locator('[data-custom-target-id="med-a"]');
  await codes.getByRole("button", { name: "Add value" }).click();
  expect(await stored(page)).toEqual(original);
  await codes.getByRole("combobox", { name: "Response code 1" }).selectOption("code:A");
  await codes.getByRole("button", { name: "Add value" }).click();
  await codes.getByRole("combobox", { name: "Response code 2" }).selectOption("not:7701003");
  await codes.getByRole("button", { name: "Add value" }).click();
  await codes.getByRole("combobox", { name: "Response code 3" }).selectOption("pn:8801019");
  const score = field(page, "Score");
  await score.getByRole("button", { name: "Add value" }).click();
  await score.getByRole("spinbutton", { name: "Score 1" }).fill("12.5");
  const flag = field(page, "Flag");
  await flag.getByRole("button", { name: "Add value" }).click();
  await flag.getByRole("combobox", { name: "Flag 1" }).selectOption("true");
  const time = field(page, "Observed at");
  await time.getByRole("button", { name: "Add value" }).click();
  await time.getByLabel("Observed at 1").fill("2026-09-29T12:30");
  const binary = field(page, "Attachment");
  await binary.getByRole("button", { name: "Add value" }).click();
  await binary.locator('input[type="file"]').setInputFiles({ name: "sample.bin", mimeType: "application/octet-stream", buffer: Buffer.from([1, 2, 3]) });
  const document = await stored(page);
  const root = document.groups.find((group: {id: string}) => group.id === "PatientCareReportGroup").instances[0];
  expect(root.elements.find((element: {id: string}) => element.id.endsWith("Score")).values[0].value).toBe(12.5);
  expect(root.elements.find((element: {id: string}) => element.id.endsWith("Flag")).values[0].value).toBe(true);
  expect(root.elements.find((element: {id: string}) => element.id.endsWith("ObservedAt")).values[0].value).toMatch(/^2026-09-29T/);
  expect(root.elements.find((element: {id: string}) => element.id.endsWith("Attachment")).values[0].value).toBe("AQID");
  const medication = document.groups.find((group: {id: string}) => group.id === "eMedications.MedicationGroup").instances[0];
  expect(medication.elements.find((element: {id: string}) => element.id.endsWith("ResponseCode")).values.map((value: {kind: string}) => value.kind))
    .toEqual(["coded", "null", "pertinent-negative"]);
});
