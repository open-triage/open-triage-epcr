import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {syntheticEncounter} from './app/standard-encounter';
      import {validateStationaryRecord} from './app/stationary-validation';
      import {ChecklistFieldEditor} from './components/checklist-field-editor';
      import {CustomGroupFields,addCustomGroupInstance} from './components/custom-group-fields';
      import {setCustomOccurrence} from './components/repeated-custom-fields';
      import {serializeEncounterDocument,deserializeEncounterDocument} from './app/encounter-document';
      const group={id:'f064177e-d9aa-487e-b9d3-ad581e117b87',namespace:'org.example.ems',slug:'MedicationResponse',title:'Medication response',recurrence:'multiple',correlatesTo:'eMedications.MedicationGroup'};
      const field={id:'d1519097-23a4-40e7-b097-631c8a134478',namespace:group.namespace,
        slug:'ResponseNote',title:'Response note',definition:'Response',datatype:'string',recurrence:'multiple',
        groupDefinitionId:group.id,correlatesTo:group.correlatesTo,usage:'Optional',constraints:{maxLength:3},identifying:false};
      const grouped={key:'response',source:{kind:'custom',elementDefinitionId:field.id,groupDefinitionId:group.id}};
      const complication={key:'complication',source:{kind:'nemsis',elementId:'eMedications.08'}};
      const form={definition:{schemaVersion:1,sections:[{key:'treatment',fields:[grouped,complication]}]},
        catalogFields:{},customFields:{[field.id]:field},customGroups:{[group.id]:group}};
      let base={...syntheticEncounter.document,groups:[...syntheticEncounter.document.groups.filter(g=>g.id!=='eMedications.MedicationGroup'),
        {id:'eMedications.MedicationGroup',instances:[{instanceId:'med-a',elements:[]},{instanceId:'med-b',elements:[]}]}]};
      base=addCustomGroupInstance(base,group,'med-a','group-a');
      base=addCustomGroupInstance(base,group,'med-b','group-b');
      base=setCustomOccurrence(base,field,'group-a',{kind:'scalar',occurrenceId:'value-a',value:'LONG A'},undefined,'org.example.ems.MedicationResponse');
      base=setCustomOccurrence(base,field,'group-b',{kind:'scalar',occurrenceId:'value-b',value:'LONG B'},undefined,'org.example.ems.MedicationResponse');
      function Harness(){const [doc,setDoc]=useState(()=>JSON.parse(localStorage.getItem('checklist-document')||'null')||base);
        const [view,setView]=useState('checklist'); const [section,setSection]=useState('treatment');
        const [pinned,setPinned]=useState(null);
        const update=next=>{setDoc(next);localStorage.setItem('checklist-document',JSON.stringify(next));};
        const findings=validateStationaryRecord(doc,form,'2026-09-30T00:00:00Z').filter(f=>f.target.fieldId==='org.example.ems.ResponseNote'||f.target.fieldId==='eMedications.08');
        const shown=pinned&&!findings.some(f=>f.id===pinned.id)?[...findings,pinned]:findings;
        return <><button onClick={()=>setView(view==='checklist'?'stationary':'checklist')}>Switch view</button>
          <button onClick={()=>setSection(section==='treatment'?'history':'treatment')}>Move section</button>
          <button onClick={()=>update(deserializeEncounterDocument(serializeEncounterDocument(doc)))}>Recover report</button>
          <section aria-label={view+' '+section}>{view==='stationary'?<CustomGroupFields document={doc} fields={[grouped]}
            definitions={{[field.id]:field}} groups={{[group.id]:group}} onDocumentChange={update}/>
            :shown.map(f=><article key={f.id} data-finding-id={f.id}><ChecklistFieldEditor finding={f} document={doc}
              form={form} language="en" disabled={false} onDocumentChange={update}
              onMultiChoiceOpenChange={open=>setPinned(open?f:null)}/></article>)}</section>
          <output data-testid="document">{JSON.stringify(doc)}</output></>;}
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test("grouped occurrence correction keeps medication context and survives movement and recovery", async ({ page }) => {
  await page.route("**/__checklist-repeat-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__checklist-repeat-harness", (route) => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__checklist-repeat-script"></script></body></html>' }));
  await page.goto("/__checklist-repeat-harness");
  const a = page.locator('article').filter({ has: page.locator('[data-custom-target-id="group-a"]') });
  const b = page.locator('article').filter({ has: page.locator('[data-custom-target-id="group-b"]') });
  await expect(a.locator(".checklist-target-context")).toContainText("Medication");
  await expect(b.locator(".checklist-target-context")).toContainText("Medication");
  await a.getByRole("textbox", { name: /Response note/ }).fill("Yes");
  await expect(a).toHaveCount(0);
  await expect(b.getByRole("textbox", { name: /Response note/ })).toHaveValue("LONG B");
  const before = JSON.parse((await page.getByTestId("document").textContent())!);
  await page.getByRole("button", { name: "Move section" }).click();
  await page.getByRole("button", { name: "Switch view" }).click();
  await expect(page.locator('[data-custom-group-instance-id="group-a"] textarea')).toHaveValue("Yes");
  await page.getByRole("button", { name: "Recover report" }).click();
  await page.reload();
  expect(JSON.parse((await page.getByTestId("document").textContent())!)).toEqual(before);
});

test("multi-choice checklist commits each selection without dismissing and keeps both on reopen", async ({ page }) => {
  await page.route("**/__checklist-repeat-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__checklist-repeat-harness", (route) => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__checklist-repeat-script"></script></body></html>' }));
  await page.goto("/__checklist-repeat-harness");
  const first = page.locator('article[data-finding-id*="med-a"]').filter({ has: page.locator('[data-element-id="eMedications.08"]') });
  await first.locator(".clinical-searchable-trigger").click();
  await page.getByRole("option", { name: "Altered Mental Status" }).click();
  await expect(page.locator(".clinical-searchable-popup")).toBeVisible();
  await page.getByRole("option", { name: "Apnea" }).click();
  await expect(page.locator(".clinical-searchable-popup")).toBeVisible();
  await expect(first.locator(".clinical-searchable-trigger")).toContainText("Altered Mental Status, Apnea");
  await page.getByRole("combobox", { name: /Search Medication Complication/ }).press("Escape");
  const before = JSON.parse((await page.getByTestId("document").textContent())!);
  await page.reload();
  expect(JSON.parse((await page.getByTestId("document").textContent())!)).toEqual(before);
});
