import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useReducer} from 'react'; import {createRoot} from 'react-dom/client';
      import {useReportWorkspace} from './app/report-workspace';
      import {INITIAL_SHELL_STATE, transitionShell} from './app/standard-encounter';
      import {populateStationaryDemoData} from './app/stationary-demo-data';
      import {removeRepeatingGroupOccurrence} from './app/stationary-repeating-group';
      import {cacheOpenedReport} from './app/offline-reports';
      const populatedDocument = populateStationaryDemoData(INITIAL_SHELL_STATE.encounter.document);
      window.vitalsServerDocument = populatedDocument;
      const report = {id:'42000000-0000-4000-8000-000000000013', revision:2,
        formVersionId:'form', catalogReleaseId:'catalog', status:'draft',
        documentingUserId:'32000000-0000-4000-8000-000000000002', document:populatedDocument, demoMutable:true};
      const session = {user:{id:'32000000-0000-4000-8000-000000000002'}, csrfToken:'proof', capabilities:['clinical:demo']};
      cacheOpenedReport(localStorage,session,{assignmentId:'fixture',report,replacementAssignment:null},'PCR-FIXTURE');
      const noop = ()=>{};
      function App(){
        const [shell,dispatch] = useReducer(transitionShell, INITIAL_SHELL_STATE);
        const workspace = useReportWorkspace({session,report,shell,dispatch,validationErrorCount:0,
          presentationMode:'stationary',online:true,onSessionEnded:noop,onReportCompleted:noop,onNotesChange:noop});
        const vitals = shell.encounter.document.groups.find(g=>g.id==='eVitals.VitalGroup')?.instances ?? [];
        return <><output aria-label="Sync status">{workspace.syncStatus}</output>
          <output aria-label="Vitals sets">{vitals.length}</output>
          <button disabled={!workspace.restored||!vitals.length} onClick={()=>{
            const changed=removeRepeatingGroupOccurrence(shell.encounter.document,'eVitals.VitalGroup',vitals[0].instanceId);
            if(changed.ok)dispatch({type:'document-opened',document:changed.document});
          }}>Remove vitals</button></>;
      }
      createRoot(document.getElementById('root')).render(<App/>);` } });
  script = result.outputFiles[0]!.text;
});

for (const conflict of [false, true]) {
  test(`removing demo vitals persists as an authorized clear${conflict ? " after conflict recovery" : ""}`, async ({ page }) => {
    let revision = 2;
    const commands: Array<{ demoAction?: string; groups: Array<{ groupId: string; tombstone?: boolean }>; occurrences: Array<{ elementId: string; tombstone?: boolean }> }> = [];
    await page.route("**/__vitals-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__vitals-harness", route => route.fulfill({ contentType: "text/html",
      body: '<html lang="en"><body><div id="root"></div><script src="/__vitals-script"></script></body></html>' }));
    await page.route("**/api/reports/*/active", async route => {
      // Obtain the current server baseline from the initial browser document.
      const document = await page.evaluate(() => (window as unknown as { vitalsServerDocument: unknown }).vitalsServerDocument);
      return route.fulfill({ json: { reportId: "42000000-0000-4000-8000-000000000013", reportRevision: revision,
        dispatchRevision: 0, document, dispatchConflicts: [], dispatchCancellation: null },
        headers: { etag: `"report-${revision}"` } });
    });
    await page.route("**/api/reports/*/draft-changes", async route => {
      const command = route.request().postDataJSON(); commands.push(command);
      expect(command.demoAction).toBe("clear");
      expect(command.groups.some((group: { groupId: string }) => group.groupId === "eVitals.VitalGroup")).toBe(true);
      expect(command.groups.every((group: { tombstone?: boolean }) => group.tombstone)).toBe(true);
      expect(command.occurrences.every((occurrence: { tombstone?: boolean }) => occurrence.tombstone)).toBe(true);
      if (conflict && commands.length === 1) {
        revision += 1;
        return route.fulfill({ status: 409, json: { category: "server-conflict" } });
      }
      revision += 1;
      return route.fulfill({ json: { id: "42000000-0000-4000-8000-000000000013", status: "draft", revision } });
    });
    await page.goto("/__vitals-harness");
    await expect(page.getByRole("button", { name: "Remove vitals" })).toBeEnabled();
    await page.getByRole("button", { name: "Remove vitals" }).click();
    await expect(page.getByLabel("Vitals sets")).toHaveText("0");
    await expect.poll(() => commands.length, { timeout: 8_000 }).toBe(conflict ? 2 : 1);
    await expect(page.getByLabel("Sync status")).toHaveText("Saved", { timeout: 8_000 });
    await expect(page.getByLabel("Vitals sets")).toHaveText("0");
  });
}
