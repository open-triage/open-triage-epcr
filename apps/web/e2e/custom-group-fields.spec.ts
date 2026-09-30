import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {CustomGroupFields} from './components/custom-group-fields';
      import {syntheticEncounter} from './app/standard-encounter';
      const group={id:'f064177e-d9aa-487e-b9d3-ad581e117b87',namespace:'org.example.ems',slug:'MedicationResponse',title:'Medication response',recurrence:'multiple',correlatesTo:'eMedications.MedicationGroup'};
      const base={...syntheticEncounter.document,groups:[...syntheticEncounter.document.groups.filter(g=>g.id!=='eMedications.MedicationGroup'),
        {id:'eMedications.MedicationGroup',instances:[{instanceId:'med-a',elements:[]},{instanceId:'med-b',elements:[]}]}]};
      const common={namespace:group.namespace,usage:'Optional',identifying:false,recurrence:'multiple',groupDefinitionId:group.id,correlatesTo:group.correlatesTo};
      const text={...common,id:'d1519097-23a4-40e7-b097-631c8a134478',slug:'ResponseNote',title:'Response note',definition:'Response',datatype:'string',constraints:{}};
      const coded={...common,id:'ed776393-d3b7-4a15-9836-f32824464a63',slug:'ResponseCode',title:'Response code',definition:'Code',datatype:'coded',codeSystem:'https://example.org/code',choices:[{code:'A',label:'Improved'}],permittedNotValues:['7701003'],permittedPertinentNegatives:['8801019']};
      const fields=[text,coded].map(d=>({key:d.slug,source:{kind:'custom',elementDefinitionId:d.id,groupDefinitionId:group.id},allowedAbsenceStates:['7701003','8801019']}));
      function Harness(){ const [doc,setDoc]=useState(()=>JSON.parse(localStorage.getItem('grouped-document')||'null')||base);
        const [view,setView]=useState('stationary'); const [section,setSection]=useState('history');
        const update=next=>{setDoc(next);localStorage.setItem('grouped-document',JSON.stringify(next));};
        return <><button onClick={()=>setView(view==='stationary'?'mobile':'stationary')}>Switch view</button>
          <button onClick={()=>setSection(section==='history'?'treatment':'history')}>Move section</button>
          <section aria-label={view+' '+section}><CustomGroupFields document={doc} fields={fields} definitions={{[text.id]:text,[coded.id]:coded}}
            groups={{[group.id]:group}} onDocumentChange={update}/></section><output data-testid="document">{JSON.stringify(doc)}</output></>; }
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test("grouped text and coded results retain explicit medication parents through layout and reload", async ({ page }) => {
  await page.route("**/__custom-group-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__custom-group-harness", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__custom-group-script"></script></body></html>' }));
  await page.goto("/__custom-group-harness");
  const parentA = page.locator('[data-custom-group-parent-id="med-a"]');
  const parentB = page.locator('[data-custom-group-parent-id="med-b"]');
  await parentA.getByRole("button", { name: "Add group" }).click();
  await parentB.getByRole("button", { name: "Add group" }).click();
  const a = parentA.locator('[data-custom-group-instance-id]');
  const b = parentB.locator('[data-custom-group-instance-id]');
  await a.getByRole("group", { name: "Response note" }).getByRole("button", { name: "Add value" }).click();
  await a.getByRole("textbox", { name: "Response note 1" }).fill("Improved");
  await b.getByRole("group", { name: "Response note" }).getByRole("button", { name: "Add value" }).click();
  await b.getByRole("textbox", { name: "Response note 1" }).fill("Unchanged");
  await a.getByRole("group", { name: "Response code" }).getByRole("button", { name: "Add value" }).click();
  await a.getByRole("combobox", { name: "Response code 1" }).selectOption("code:A");
  await b.getByRole("group", { name: "Response code" }).getByRole("button", { name: "Add value" }).click();
  await b.getByRole("combobox", { name: "Response code 1" }).selectOption("not:7701003");
  const before = JSON.parse((await page.getByTestId("document").textContent())!);
  const group = before.groups.find((entry: { id: string }) => entry.id === "org.example.ems.MedicationResponse");
  expect(group.instances.map((entry: { parentInstanceId: string }) => entry.parentInstanceId)).toEqual(["med-a", "med-b"]);
  await page.getByRole("button", { name: "Move section" }).click();
  await page.getByRole("button", { name: "Switch view" }).click();
  await page.reload();
  await expect(page.locator('[data-custom-group-parent-id="med-a"] textarea')).toHaveValue("Improved");
  await expect(page.locator('[data-custom-group-parent-id="med-b"] textarea')).toHaveValue("Unchanged");
  expect(JSON.parse((await page.getByTestId("document").textContent())!)).toEqual(before);
});
