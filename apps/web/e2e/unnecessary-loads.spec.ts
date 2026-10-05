import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
const counts = new Map<string, number>();
const reportId = "report-1", itemId = "item-1";
const item = { id: itemId, reportId, reportNumber: "PCR-1", criterionId: "criterion", criterionName: "Check",
  kind: "criterion", priority: "high", status: "new", assigneeId: null, version: 1,
  firstMatchedAt: "2026-10-01T12:00:00Z", signedAt: "2026-10-01T12:00:00Z", findings: [],
  assignmentHistory: [], progressHistory: [], amendmentHistory: [], comments: [], canComment: true };

test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {AssignedCalls} from './components/assigned-calls';
      import {OpenReports} from './components/open-reports';
      import {ReviewShell} from './components/review-shell';
      import {ReviewSettingsPanel} from './components/review-settings';
      import {DefinitionFileImport} from './components/definition-file-import';
      const base={user:{id:'user',displayName:'User'},organization:{id:'org',name:'EMS'},
        csrfToken:'fixture',startedAt:'2026-10-01T12:00:00Z',capabilities:['review:admin','review:all']};
      function App(){const [revision,setRevision]=useState(0),[active,setActive]=useState(true),[draft,setDraft]=useState(true);
        const session={...base,capabilities:[...base.capabilities]};
        const mode=new URLSearchParams(location.search).get('mode');
        return <><button onClick={()=>setRevision(revision+1)}>Parent update {revision}</button>
          <button onClick={()=>setActive(!active)}>Toggle active</button>
          <button onClick={()=>setDraft(!draft)}>Toggle draft</button>
          {mode==='calls'?<><AssignedCalls session={session} language="en" paused={!active}/>
            <OpenReports session={session} language="en" paused={!active} onCompleted={()=>{}} onSessionEnded={()=>{}}/></>:
          mode==='settings'?<div hidden={!active}><ReviewSettingsPanel session={session} language="en" online active={active}/></div>:
          mode==='import'?<DefinitionFileImport kind="catalog" busy={false} enabled={active} hasDraft={draft} onImport={async()=>{}}/>:
          <ReviewShell session={session} language="en" online attention={null} onAttentionRefresh={()=>{}}/>}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  counts.clear();
  page.on("pageerror", error => { throw error; });
  await page.clock.install();
  await page.route("**/__load-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__loads*", route => route.fulfill({ contentType: "text/html",
    body: '<html><body><div id="root"></div><script src="/__load-script"></script></body></html>' }));
  await page.route("**/api/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    counts.set(pathname, (counts.get(pathname) ?? 0) + 1);
    const responses: Record<string, unknown> = {
      "/api/calls/assigned": { assignedCalls: [] },
      "/api/reports/open": { openCalls: [], completedReportIds: [] },
      "/api/review/queue": { dataset: "real", page: 1, pageSize: 25, total: 1, items: [item], assignmentCounts: { all: 1, mine: 0, unassigned: 1 } },
      [`/api/review/items/${itemId}`]: item,
      [`/api/review/reports/${reportId}`]: { id: reportId, groups: [], values: [], notes: [], reviewItems: [], amendmentSequence: 0 },
      "/api/review/eligible-reviewers": [], "/api/review/routes": [], "/api/review/outcomes": [],
      "/api/review/backlog": { work: [] },
      "/api/review/overdue-policy": { deadlineHours: 24, version: 1 },
      "/api/review/amendment-policy": { clearance: "confirm", version: 1 },
      "/api/admin/canonical/catalog": [{ file: "catalog.json", compatible: true }],
    };
    return route.fulfill({ json: responses[pathname] ?? {} });
  });
});
const total = () => [...counts.values()].reduce((a, b) => a + b, 0);

test("call polling survives parent renders and pauses with the directory", async ({ page }) => {
  await page.goto("/__loads?mode=calls");
  await expect.poll(() => counts.get("/api/calls/assigned")).toBe(1);
  await expect.poll(() => counts.get("/api/reports/open")).toBe(1);
  await page.getByRole("button", { name: "Parent update" }).click();
  await page.clock.runFor(100);
  expect(total()).toBe(2);
  await page.clock.runFor(10_000);
  await expect.poll(total).toBe(4);
  await page.getByRole("button", { name: "Toggle active" }).click();
  await page.clock.runFor(30_000);
  expect(total()).toBe(4);
  await page.getByRole("button", { name: "Toggle active" }).click();
  await expect.poll(total).toBe(6);
});

test("retained settings stop all requests while inactive and refresh on return", async ({ page }) => {
  await page.goto("/__loads?mode=settings");
  await expect.poll(total).toBe(6);
  await page.getByRole("spinbutton").fill("48");
  await page.getByRole("button", { name: "Parent update" }).click();
  await page.clock.runFor(100);
  expect(total()).toBe(6);
  await page.getByRole("button", { name: "Toggle active" }).click();
  await page.clock.runFor(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(total()).toBe(6);
  await page.getByRole("button", { name: "Toggle active" }).click();
  await expect.poll(total).toBe(12);
  await expect(page.getByRole("spinbutton")).toHaveValue("48");
});

test("review search coalesces typing without refreshing other resources", async ({ page }) => {
  const searches: string[] = [];
  page.on("request", request => { const url = new URL(request.url());
    if (url.pathname === "/api/review/queue") searches.push(url.searchParams.get("search") ?? ""); });
  await page.goto("/__loads?mode=review");
  await expect(page.getByRole("button", { name: "View PCR-1", exact: true })).toBeVisible();
  const initial = total();
  await page.getByRole("searchbox").fill("P"); await page.clock.runFor(50);
  await page.getByRole("searchbox").fill("PC"); await page.clock.runFor(50);
  await page.getByRole("searchbox").fill("PCR"); await page.clock.runFor(250);
  await expect.poll(() => searches).toEqual(["", "PCR"]);
  expect(total()).toBe(initial + 1);
});

test("review stops hidden queue and detail polling while preserving the selection", async ({ page }) => {
  await page.goto("/__loads?mode=review");
  await page.getByRole("button", { name: "View PCR-1", exact: true }).click();
  await expect.poll(() => counts.get(`/api/review/reports/${reportId}`)).toBe(1);
  const queueLoads = counts.get("/api/review/queue");
  await page.clock.runFor(16_000);
  await expect.poll(() => counts.get(`/api/review/reports/${reportId}`)).toBe(2);
  expect(counts.get("/api/review/queue")).toBe(queueLoads);
  await page.getByRole("tab", { name: "Analytics", exact: true }).click();
  const initial = total();
  await page.clock.runFor(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(total()).toBe(initial);
  await page.getByRole("tab", { name: "Review", exact: true }).click();
  await expect.poll(() => counts.get(`/api/review/reports/${reportId}`)).toBe(3);
  expect(counts.get("/api/review/queue")).toBe(queueLoads);
});

test("definition files are loaded only when importing is available", async ({ page }) => {
  await page.goto("/__loads?mode=import");
  await page.clock.runFor(500);
  expect(total()).toBe(0);
  await page.getByRole("button", { name: "Toggle draft" }).click();
  await expect(page.getByRole("button", { name: "Import selected file" })).toBeEnabled();
  expect(total()).toBe(1);
  await page.getByRole("button", { name: "Parent update" }).click();
  await page.clock.runFor(100);
  expect(total()).toBe(1);
  await page.getByRole("button", { name: "Refresh files" }).click();
  await expect.poll(total).toBe(2);
});


test("queue polling does not also reload on the detail timer", async ({ page }) => {
  await page.goto("/__loads?mode=review");
  await expect(page.getByRole("button", { name: "View PCR-1", exact: true })).toBeVisible();
  await page.clock.runFor(16_000);
  await expect.poll(() => counts.get("/api/review/queue")).toBe(6);
  expect(counts.get("/api/review/outcomes")).toBeUndefined();
});

test("call polling skips hidden browser tabs and overlapping requests", async ({ page }) => {
  let assigned = 0;
  let release!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/calls/assigned", async route => {
    assigned++;
    await response;
    await route.fulfill({ json: { assignedCalls: [] } });
  });
  await page.goto("/__loads?mode=calls");
  await expect.poll(() => assigned).toBe(1);
  await page.clock.runFor(21_000);
  expect(assigned).toBe(1);
  release();
  await expect(page.locator(".assigned-calls").first().getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const openLoads = counts.get("/api/reports/open");
  await page.clock.runFor(21_000);
  expect(assigned).toBe(1);
  expect(counts.get("/api/reports/open")).toBe(openLoads);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => assigned).toBe(2);
});
