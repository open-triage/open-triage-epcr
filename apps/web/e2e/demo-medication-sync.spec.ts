import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useReducer} from 'react'; import {createRoot} from 'react-dom/client';
      import {useReportWorkspace} from './app/report-workspace';
      import {INITIAL_SHELL_STATE,transitionShell,bundledEncounterDefinition} from './app/standard-encounter';
      import {encounterEvents,removeCanonicalEvent,saveCanonicalEvent} from './app/canonical-events';
      import {populateStationaryDemoData} from './app/stationary-demo-data';
      import {encounterDocumentToDraftMutations} from './app/draft-report';
      import {cacheOpenedReport} from './app/offline-reports';
      const document=populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
      const report={id:'42000000-0000-4000-8000-000000000013',revision:2,formVersionId:'form',catalogReleaseId:'catalog',
        documentingUserId:'32000000-0000-4000-8000-000000000002',status:'draft',document,demoMutable:true};
      const session={user:{id:report.documentingUserId},csrfToken:'proof',capabilities:['clinical:demo']};
      window.medicationFixture={document,mutations:encounterDocumentToDraftMutations(report.id,document)};
      cacheOpenedReport(localStorage,session,{assignmentId:'fixture',report,replacementAssignment:null},'PCR-FIXTURE');
      const noop=()=>{};
      function App(){
        const [shell,dispatch]=useReducer(transitionShell,INITIAL_SHELL_STATE);
        const workspace=useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,presentationMode:'mobile',
          online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
        const event=encounterEvents(shell.encounter.document,bundledEncounterDefinition).find(e=>e.medication);
        function edit(legacy){
          if(legacy){
            const next={...event,medication:{...event.medication,medicationCode:'7052',label:'Morphine'}};
            dispatch({type:'document-opened',document:saveCanonicalEvent(removeCanonicalEvent(shell.encounter.document,event.id),next,bundledEncounterDefinition)});
          } else {
            dispatch({type:'medication-opened',id:event.id});
            dispatch({type:'medication-selected',code:'7052',codeType:'RxNorm',label:'Morphine'});
            dispatch({type:'medication-saved'});
          }
        }
        return <><output aria-label="Sync status">{workspace.syncStatus}</output>
          <output aria-label="Medication">{event?.medication.medicationCode}</output>
          <button disabled={!workspace.restored||!event} onClick={()=>edit(false)}>Change medication</button>
          <button disabled={!workspace.restored||!event} onClick={()=>edit(true)}>Replay old edit</button>
          <button onClick={workspace.retryFailedSave}>Retry save</button></>;
      }
      createRoot(window.document.getElementById('root')).render(<App/>);` } });
  script = result.outputFiles[0]!.text;
});

for (const legacy of [false, true]) {
  test(`populated medication edit saves${legacy ? " after retrying an old queued edit" : " with its existing identities"}`, async ({ page }) => {
    let saves = 0;
    let attempts = 0;
    let allowRecovery = !legacy;
    await page.route("**/__medication-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__medication-harness", route => route.fulfill({ contentType: "text/html",
      body: '<html lang="en"><body><div id="root"></div><script src="/__medication-script"></script></body></html>' }));
    const fixture = () => page.evaluate(() => (window as unknown as { medicationFixture: {
      document: unknown; mutations: { groups: Array<{ id: string }>; occurrences: Array<{ id: string }> };
    } }).medicationFixture);
    await page.route("**/api/reports/*/active", async route => route.fulfill({
      json: { reportId: "42000000-0000-4000-8000-000000000013", reportRevision: 2,
        dispatchRevision: 0, document: (await fixture()).document, dispatchConflicts: [], dispatchCancellation: null },
      headers: { etag: '"report-2"' },
    }));
    await page.route("**/api/reports/*/draft-changes", async route => {
      const command = route.request().postDataJSON();
      attempts++;
      if (!allowRecovery) return route.fulfill({ status: 409, json: { message: "The command conflicts with existing clinical data" } });
      const baseline = (await fixture()).mutations;
      expect(command.demoAction).toBeUndefined();
      expect(command.groups.every((group: { id: string; tombstone?: boolean }) =>
        !group.tombstone && baseline.groups.some(({ id }) => id === group.id))).toBe(true);
      expect(command.occurrences.every((value: { id: string; tombstone?: boolean }) =>
        !value.tombstone && baseline.occurrences.some(({ id }) => id === value.id))).toBe(true);
      expect(command.occurrences.find((value: { elementId: string }) => value.elementId === 'eMedications.03').value.code).toBe('7052');
      saves++;
      return route.fulfill({ json: { id: "42000000-0000-4000-8000-000000000013", status: "draft", revision: 3 } });
    });
    await page.goto("/__medication-harness");
    await expect(page.getByRole("button", { name: "Change medication" })).toBeEnabled();
    await page.getByRole("button", { name: legacy ? "Replay old edit" : "Change medication" }).click();
    await expect(page.getByLabel("Medication")).toHaveText("7052");
    if (legacy) {
      await expect(page.getByLabel("Sync status")).toHaveText("Conflict", { timeout: 10_000 });
      expect(attempts).toBe(2);
      allowRecovery = true;
      await page.getByRole("button", { name: "Retry save" }).click();
    }
    await expect.poll(() => saves, { timeout: 10_000 }).toBe(1);
    await expect(page.getByLabel("Sync status")).toHaveText("Saved");
    await expect(page.getByLabel("Medication")).toHaveText("7052");
  });
}
