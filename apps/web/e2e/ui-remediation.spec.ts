import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import productionSettings from "@open-triage/contracts/config/installation.production.json";

let script: string;
let css: string;
const appearance = { brandText: "Example EMS", helperText: "Use your agency credentials.", logoPngDataUrl: null,
  accentColor: "#315ba8", accentDarkColor: "#24447e", destructiveColor: "#8a2670", inactiveButtonColor: "#edf1fa",
  textColor: "#202850", browserThemeColor: "#315ba8", pwaBackgroundColor: "#dfe5df", pwaName: "EMS", pwaShortName: "EMS" };
const now = "2026-10-03T10:00:00Z";
const session = { csrfToken: "fixture-only", user: { id: "owner", displayName: "Owner" },
  organization: { id: "organization", name: "Example EMS" }, startedAt: now, expiresAt: "2099-10-03T10:00:00Z",
  capabilities: ["clinical:document", "settings:read", "settings:write", "review:all", "review:admin"] };
const agency = { organizationId: "organization", language: "en", regionalFormat: null, timeZone: null,
  revision: 1, reportMediaAllowanceBytes: 52428800, imageMediaLimitBytes: 10485760,
  defaultReportMediaAllowanceBytes: 52428800, defaultImageMediaLimitBytes: 10485760, appearance,
  demographics: { agencyUniqueStateId: "STATE-1", agencyNumber: "AGENCY-1", stateCode: "36", stateDisplay: "New York",
    stateCodeSystem: "ANSI-STATE", stateTerminologyVersion: null, versionId: "version", version: 1,
    catalogReleaseId: "catalog", effectiveFrom: now } };
function item(index: number) {
  return { id: `item-${index}`, reportId: `report-${index}`, reportNumber: `PCR-${index}`, criterionId: "criterion",
    criterionName: "Narrative check", criterionDescription: "Explain the patient's condition and treatment.", priority: "high",
    status: "new", assigneeId: null, version: 1, firstMatchedAt: now, reportingDate: "2026-10-03", signedAt: now,
    findings: [], assignmentHistory: [], comments: [], progressHistory: [] };
}

test.beforeAll(async () => {
  css = (await Promise.all(["styles.css", "session-layout.css", "review-workspace.css", "analytics-workspace.css"].map(file =>
    readFile(path.resolve(__dirname, "../app", file), "utf8")))).join("\n");
  const result = await build({ bundle: true, write: false, jsx: "automatic", format: "iife", platform: "browser",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:3108" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react'; import{createRoot}from'react-dom/client';
      import Home from './app/page'; import{UsersPanel,RolesPanel}from'./components/admin-directory'; import{ReviewShell}from'./components/review-shell'; import{ReviewSettingsPanel}from'./components/review-settings';
      import{StationaryRecord}from'./components/stationary-record';
      import{AdminShell}from'./components/admin-shell'; import{ListRowAction}from'./components/list-row-action';
      import{EncounterTimeline}from'./components/encounter-timeline'; import{standardEncounterDefinition}from'./app/standard-encounter-definition';
      import{ValidationAuthoring}from'./components/validation-authoring';
      import{StationaryCodedValueField}from'./components/stationary-coded-field';
      import{applyAgencyAppearance}from'./app/installation-settings';
      import opened from './public/demo-open-assignment.json';
      const session=${JSON.stringify(session)}; applyAgencyAppearance(${JSON.stringify(appearance)},document);
      const view=new URLSearchParams(location.search).get('view');
      function Controls(){const[value,setValue]=useState();return <StationaryCodedValueField
        field={{elementId:'ePatient.13',label:'Gender',help:'Patient gender',options:[],maxOccurs:1,
          exceptionalChoices:[{key:'not-value:7701003',kind:'null',code:'7701003',label:'Not recorded'},
            {key:'not-value:7701001',kind:'null',code:'7701001',label:'Not applicable'}]}}
        value={value} onChange={setValue}/>;}
      function Record(){const[record,setRecord]=useState(opened.report.document);
        return <StationaryRecord document={record} onDocumentChange={setRecord}/>;}
      function Findings(){const[count,setCount]=useState(0);const[secondary,setSecondary]=useState(0);return <><ul className="review-findings"><li><ListRowAction label="Open affected field" itemName="Incident number missing" onAction={trigger=>{setCount(value=>value+1);trigger.focus();}}><strong>Incident number missing</strong><span>Add the incident number.</span><button onClick={()=>setSecondary(value=>value+1)}>Acknowledge</button></ListRowAction></li></ul><p role="status">Opened {count}; acknowledged {secondary}</p></>;}
      function Timeline(){const[count,setCount]=useState(0); const note={id:'note',reportId:'report',type:'text',content:'Patient feels better.',capturedAt:'2026-10-03T12:02:00Z',author:{id:'owner',displayName:'Owner'},persistenceState:'ready'};return <><EncounterTimeline events={[{id:'note',kind:'text-note',time:'12:02',sortTime:note.capturedAt,note}]} validationStatuses={new Map()} definition={standardEncounterDefinition} headingId="timeline" language="en" onOpenTextNote={(note,trigger)=>{setCount(value=>value+1);trigger.focus();}} onOpenPhoto={()=>{}} onOpenAudio={()=>{}} onOpenEvent={()=>{}}/><p role="status">Opened {count}</p></>;}
      createRoot(document.getElementById('root')).render(view==='findings'?<Findings/>:view==='admin'?<AdminShell session={session}/>:view==='timeline'?<Timeline/>:view==='validation'?<ValidationAuthoring csrfToken="fixture-only" capabilities={['validation:read','validation:write']} catalogReleaseId="catalog" language="en"/>:view==='users'?<UsersPanel canCreate canManage csrfToken="fixture-only"/>:view==='roles'?<RolesPanel csrfToken="fixture-only" capabilities={['roles:write']}/>:view==='session'?<Home/>:view==='record'?<Record/>:
        view==='review-settings'?<ReviewSettingsPanel session={session} language="en" online active/>:view==='controls-disabled'?<fieldset disabled><Controls/></fieldset>:view==='controls'?<Controls/>:
        <ReviewShell session={session} language="en" online attention={null} onAttentionRefresh={()=>{}}/>);
    ` } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/__ui-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__ui-fixture*", route => route.fulfill({ contentType: "text/html",
    body: `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__ui-script"></script></body></html>` }));
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname;
    const fixtures: Record<string, unknown> = {
      "/api/installation": { settings: { ...productionSettings, language: "en" }, appearance },
      "/api/sessions/current": session,
      "/api/calls/assigned": { assignedCalls: [], canceledAssignmentIds: [], refreshedAt: now },
      "/api/reports/open": { openCalls: [], completedReportIds: [] },
      "/api/admin/context": { organization: session.organization, panels: ["settings"], capabilities: session.capabilities,
        activeConfiguration: null, dashboard: null },
      "/api/admin/agency-settings": agency,
      "/api/review/queue": { dataset: "real", page: Number(url.searchParams.get("page") ?? 1), pageSize: 25, total: 75,
        asOf: now, assignmentCounts: { all: 75, mine: 0, unassigned: 75 }, items: Array.from({ length: 25 }, (_, index) => item(index)) },
      "/api/review/attention": { dataset: "real", asOf: now, total: 0, assignments: 0, responses: 0, reopened: 0 },
      "/api/review/routes": [{ criterionId: "criterion", name: "Narrative check", route: "unassigned", namedUserId: null,
        independentReview: false, version: 1 }],
      "/api/review/backlog": { work: [] }, "/api/review/eligible-reviewers": [], "/api/review/outcomes": [],
      "/api/review/amendment-policy": { clearance: "confirm", version: 1 },
      "/api/review/overdue-policy": { deadlineHours: 24, version: 1 },
    };
    if (endpoint.startsWith("/api/review/reports/")) return route.fulfill({ json: { id: endpoint.split("/").at(-1),
      reportingDate: "2026-10-03", signedAt: now, amendmentSequence: 0, identifying: false, groups: [], values: [], notes: [] } });
    if (endpoint.startsWith("/api/review/items/")) return route.fulfill({ json: item(Number(endpoint.split("-").at(-1))) });
    return route.fulfill({ json: fixtures[endpoint] ?? [] });
  });
});

async function open(page: Page, view: string) { await page.goto(`/__ui-fixture?view=${view}`); }

test("review reason help appears on the item immediately without a separate info button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "review");
  const reason = page.locator(".review-row-criterion").first();
  await expect(reason).toBeVisible();
  await expect(page.locator(".field-help-trigger")).toHaveCount(0);
  const row = reason.locator("xpath=ancestor::tr");
  const before = await row.boundingBox();
  const visibleOnNextFrame = await reason.evaluate(async element => {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise(requestAnimationFrame);
    const tooltip = document.querySelector('[role="tooltip"]');
    return !!tooltip && tooltip.getBoundingClientRect().height > 0 && getComputedStyle(tooltip).visibility === "visible";
  });
  expect(visibleOnNextFrame).toBe(true);
  await expect(page.getByRole("tooltip")).toHaveText("Explain the patient's condition and treatment.");
  expect((await row.boundingBox())!.height).toEqual(before!.height);
  await page.screenshot({ path: test.info().outputPath("review-reason-help-desktop.png") });
  await reason.click();
  await expect(page.locator("#review-inspector")).toHaveCount(0);
  await reason.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await reason.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(reason).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await reason.tap();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(page.locator("#review-inspector")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("review-reason-help-mobile.png") });
});

test("recovered routing exposes help directly on the criterion name", async ({ page }) => {
  await page.route("**/api/review/routes", request => request.fulfill({ json: [{
    criterionId: "criterion", name: "Narrative check", route: "unassigned", namedUserId: null,
    independentReview: false, version: 2, recoveryReason: "reviewer-ineligible",
  }] }));
  await open(page, "review-settings");
  const criterion = page.locator(".review-routing-criterion");
  await expect(criterion).toHaveText("Narrative check");
  await expect(page.locator(".field-help-trigger")).toHaveCount(0);
  await criterion.hover();
  await expect(page.getByRole("tooltip")).toHaveText("The configured reviewer lost eligibility. Future items will be unassigned.");
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await criterion.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await criterion.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(criterion).toBeFocused();
});
async function refresh(page: Page) { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); }

test("mode labels stay within the sliding switch on mobile and with enlarged text", async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(value)), session);
  await page.route("**/api/review/attention*", route => route.fulfill({ json: {
    dataset: "real", asOf: now, total: 125, assignments: 125, responses: 0, reopened: 0,
  } }));
  await open(page, "session");
  const selector = page.locator(".presentation-selector");
  await expect(selector.getByRole("button")).toHaveText(["Mobile", "Stationary", "Review (125)", "Admin"]);
  const fits = () => selector.evaluate(element => {
    const viewport = element.parentElement!.getBoundingClientRect();
    const header = element.closest<HTMLElement>(".session-bar")!;
    const buttons = [...element.querySelectorAll("button")];
    const active = buttons.find(button => button.getAttribute("aria-pressed") === "true")!;
    const selected = active.getBoundingClientRect();
    const indicator = getComputedStyle(element, "::before");
    const indicatorFits = Math.abs(parseFloat(indicator.width) - active.offsetWidth) <= 1 &&
      Math.abs(new DOMMatrix(indicator.transform).m41 - (active.offsetLeft - 2)) <= 1;
    const selectionVisible = selected.width <= viewport.width
      ? selected.left >= viewport.left - 1 && selected.right <= viewport.right + 1
      : Math.abs(selected.left - viewport.left) <= 3 || Math.abs(selected.right - viewport.right) <= 3;
    const labelsFit = buttons.every(button => {
        const box = button.getBoundingClientRect();
        const text = document.createRange();
        text.selectNodeContents(button);
        return [...text.getClientRects()].every(rect => rect.left >= box.left && rect.right <= box.right
          && rect.top >= box.top && rect.bottom <= box.bottom);
      });
    return header.scrollWidth <= header.clientWidth && selectionVisible && labelsFit && indicatorFits;
  });
  for (const width of [320, 390, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const index of [0, 1, 2, 3]) {
      await selector.getByRole("button").nth(index).click();
      await expect(selector.getByRole("button").nth(index)).toHaveAttribute("aria-pressed", "true");
      await expect.poll(fits).toBe(true);
      if (width === 1280) await page.locator(".session-bar").screenshot({ path: test.info().outputPath(`mode-selector-desktop-${index}.png`) });
    }
    await selector.getByRole("button").first().click();
    await expect.poll(() => selector.evaluate(element => new DOMMatrix(getComputedStyle(element, "::before").transform).m41)).toBe(0);
    await page.locator(".session-bar").screenshot({ path: test.info().outputPath(`mode-selector-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Choose language", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Svenska/ }).click();
  await expect(selector.getByRole("button")).toHaveText(["Mobil", "Stationär", "Granskning (125)", "Admin"]);
  await expect.poll(() => selector.evaluate(element => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);
  await page.locator(".session-bar").screenshot({ path: test.info().outputPath("mode-selector-swedish-390.png") });
  await page.setViewportSize({ width: 320, height: 900 });
  await selector.getByRole("button").evaluateAll(buttons => buttons.forEach(button => { button.style.fontSize = "32px"; }));
  for (const index of [0, 1, 2, 3]) {
    await selector.getByRole("button").nth(index).click();
    await expect.poll(fits).toBe(true);
  }
  await selector.getByRole("button").first().focus();
  await page.keyboard.press("Tab");
  await expect(selector.getByRole("button").nth(1)).toBeFocused();
  await expect(selector.getByRole("button").nth(1)).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect.poll(fits).toBe(true);
});

test("queue fits the desktop viewport and restores page, filters, and internal scroll after a full report", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "review");
  await page.getByRole("searchbox").fill("PCR");
  await expect(page.getByRole("table")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  const rows = page.locator(".review-table-scroll");
  await rows.evaluate(element => { element.scrollTop = 900; });
  const trigger = page.getByRole("button", { name: "View PCR-20", exact: true });
  await trigger.scrollIntoViewIfNeeded();
  const position = await rows.evaluate(element => element.scrollTop);
  expect(position).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await trigger.click();
  await expect(page.getByRole("article", { name: "Full report", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close full report", exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect.poll(() => rows.evaluate(element => element.scrollTop)).toBe(position);
  await expect(page.getByRole("searchbox")).toHaveValue("PCR");
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("queue-desktop.png") });
});

test("Admin Route to lists reviewers directly and saves each destination", async ({ page }) => {
  const reviewers = [
    { id: "reviewer-morgan", displayName: "Morgan Reviewer" },
    { id: "reviewer-sam", displayName: "Sam Reviewer" },
  ];
  let configured = { criterionId: "criterion", name: "Narrative check", route: "named",
    namedUserId: reviewers[0]!.id as string | null, independentReview: false, version: 1 };
  await page.route("**/api/review/eligible-reviewers", request => request.fulfill({ json: reviewers }));
  await page.route("**/api/review/routes", request => request.fulfill({ json: [configured] }));
  await page.route("**/api/review/routes/criterion", request => {
    const command = request.request().postDataJSON();
    expect(command.expectedVersion).toBe(configured.version);
    configured = { ...configured, route: command.route, namedUserId: command.namedUserId,
      independentReview: command.independentReview, version: configured.version + 1 };
    return request.fulfill({ json: configured });
  });
  await open(page, "review-settings");
  const destination = page.getByRole("combobox", { name: "Route to", exact: true });
  const save = page.getByRole("button", { name: "Save route", exact: true });
  await expect(destination).toHaveValue(reviewers[0]!.id);
  await expect(destination.locator("option:not([disabled])")).toHaveText([
    "Unassigned queue", "Documenting clinician", ...reviewers.map(reviewer => reviewer.displayName),
  ]);
  await expect(page.getByRole("combobox", { name: "Reviewer", exact: true })).toHaveCount(0);
  await destination.selectOption(reviewers[1]!.id);
  await save.click();
  await expect.poll(() => configured.namedUserId).toBe(reviewers[1]!.id);
  expect(configured.route).toBe("named");
  await page.reload();
  await expect(destination).toHaveValue(reviewers[1]!.id);
  await destination.selectOption("unassigned");
  await save.click();
  await expect.poll(() => configured.route).toBe("unassigned");
  expect(configured.namedUserId).toBeNull();
  await destination.selectOption("author");
  await save.click();
  await expect.poll(() => configured.route).toBe("author");
  expect(configured.namedUserId).toBeNull();
  await page.getByLabel("Require independent review").check();
  await expect(save).toBeDisabled();
  await destination.selectOption(reviewers[0]!.id);
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => configured.independentReview).toBe(true);
  await page.getByRole("checkbox", { name: "Require independent review", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Reports documented by this reviewer will remain unassigned for another reviewer.");
  await destination.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("route-to-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 800 });
  await destination.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("route-to-desktop.png") });
});

test("criterion routing uses compact bounded rows, independent controls, and accessible mobile fields", async ({ page }) => {
  const routes = Array.from({ length: 30 }, (_, index) => ({ criterionId: `criterion-${index}`,
    name: index === 1 ? "A longer criterion name that must remain readable without widening the screen" : `Narrative check ${index + 1}`,
    route: "named", namedUserId: "reviewer-morgan", independentReview: false, version: 1 }));
  await page.route("**/api/review/routes", request => request.fulfill({ json: routes }));
  await page.route("**/api/review/eligible-reviewers", request => request.fulfill({ json: [
    { id: "reviewer-morgan", displayName: "Morgan Reviewer" }, { id: "reviewer-sam", displayName: "Sam Reviewer" },
  ] }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "review-settings");
  const table = page.getByRole("table", { name: "Criterion routing" });
  const rows = table.locator("tbody tr");
  const first = rows.nth(0);
  const second = rows.nth(1);
  const panel = page.locator(".review-routing-scroll");
  await expect(rows).toHaveCount(30);
  await expect(table.getByRole("columnheader")).toHaveText(["Criterion", "Route to", "Require independent review", "Actions"]);
  expect(await first.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(80);
  expect(await panel.evaluate(element => element.clientHeight < element.scrollHeight && element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  const destination = first.getByRole("combobox", { name: "Route to", exact: true });
  await expect(first.getByRole("rowheader").getByRole("button")).toHaveCount(0);
  await expect(first.getByRole("rowheader")).toHaveText("Narrative check 1");
  await panel.focus();
  await page.keyboard.press("Tab");
  await expect(destination).toBeFocused();
  await second.getByRole("combobox", { name: "Route to", exact: true }).selectOption("reviewer-sam");
  await second.getByRole("checkbox", { name: "Require independent review", exact: true }).check();
  await second.getByRole("checkbox", { name: "Require independent review", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await second.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(second.getByRole("combobox", { name: "Route to", exact: true })).toHaveValue("reviewer-morgan");
  await expect(second.getByRole("checkbox")).not.toBeChecked();
  await destination.selectOption("reviewer-sam");
  await panel.evaluate(element => { element.scrollTop = 150; });
  const position = await panel.evaluate(element => element.scrollTop);
  await refresh(page);
  await expect(destination).toHaveValue("reviewer-sam");
  await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(position);
  await panel.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: test.info().outputPath("routing-list-desktop.png") });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addStyleTag({ content: ":root { --text-body: 18px; --text-caption: 16px; --text-control: 20px; --text-heading: 30px; }" });
  await expect(table).toHaveCount(1);
  await expect(first.getByText("Route to", { exact: true })).toBeVisible();
  await expect(first.getByText("Require independent review", { exact: true })).toBeVisible();
  await expect(first.getByText("Actions", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await first.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(destination).toHaveValue("reviewer-morgan");
  await first.getByRole("button", { name: "Save route", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("routing-list-mobile.png") });
});

test("routing refresh failures retain the criteria, drafts, and scroll position until retry succeeds", async ({ page }) => {
  await page.clock.install();
  const routes = Array.from({ length: 20 }, (_, index) => ({ criterionId: `criterion-${index}`,
    name: `Narrative check ${index + 1}`, route: "named", namedUserId: "reviewer-morgan",
    independentReview: false, version: 1 }));
  const reviewers = [{ id: "reviewer-morgan", displayName: "Morgan Reviewer" },
    { id: "reviewer-sam", displayName: "Sam Reviewer" }];
  let failedResource: "routes" | "reviewers" | null = null;
  let failedReads = 0;
  await page.route("**/api/review/routes", request => {
    if (failedResource === "routes") { failedReads++; return request.fulfill({ status: 503, json: {} }); }
    return request.fulfill({ json: routes });
  });
  await page.route("**/api/review/eligible-reviewers", request => {
    if (failedResource === "reviewers") { failedReads++; return request.fulfill({ status: 503, json: {} }); }
    return request.fulfill({ json: reviewers });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "review-settings");
  const panel = page.locator(".review-routing-scroll");
  const rows = panel.locator("tbody tr");
  await expect(rows).toHaveCount(20);
  const first = rows.first();
  const destination = first.getByRole("combobox", { name: "Route to", exact: true });
  await destination.selectOption("reviewer-sam");
  await first.getByRole("checkbox").check();
  await panel.evaluate(element => { element.scrollTop = 200; });
  const position = await panel.evaluate(element => element.scrollTop);
  for (const resource of ["routes", "reviewers"] as const) {
    failedResource = resource;
    const before = failedReads;
    await refresh(page);
    await expect.poll(() => failedReads).toBeGreaterThan(before);
    await expect(rows).toHaveCount(20);
    await expect(destination).toHaveValue("reviewer-sam");
    await expect(first.getByRole("checkbox")).toBeChecked();
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(position);
    await expect(page.getByRole("alert").filter({ hasText: "Could not refresh routing" })).toBeVisible();
    await expect(first.getByRole("button", { name: "Save route", exact: true })).toBeDisabled();
    await page.clock.fastForward(16000);
    await expect(rows).toHaveCount(20);
    failedResource = null;
    await page.getByRole("button", { name: "Retry routing", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not refresh routing" })).toHaveCount(0);
    await expect(rows).toHaveCount(20);
    await expect(destination).toHaveValue("reviewer-sam");
    await expect(first.getByRole("button", { name: "Save route", exact: true })).toBeEnabled();
    // Retry may scroll the page; the list keeps its own position.
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBe(position);
  }
});

test("policy drafts survive focus, polling, and task switches and use the original revision on conflict", async ({ page }) => {
  await page.clock.install();
  let version = 1;
  let reads = 0;
  await page.route("**/api/review/amendment-policy", route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 1, clearance: "automatic" });
      return route.fulfill({ status: 409, json: {} });
    }
    reads += 1;
    return route.fulfill({ json: { clearance: "confirm", version } });
  });
  await open(page, "review-settings");
  const clearance = page.getByLabel("When a criterion clears");
  await clearance.selectOption("automatic");
  version = 2;
  const before = reads;
  await refresh(page);
  await expect.poll(() => reads).toBeGreaterThan(before);
  await expect(clearance).toHaveValue("automatic");
  const beforePoll = reads;
  await page.clock.fastForward(16000);
  await expect.poll(() => reads).toBeGreaterThan(beforePoll);
  await expect(clearance).toHaveValue("automatic");
  const deadline = page.getByLabel("Hours after call completion");
  await deadline.fill("48");
  await refresh(page);
  await expect(deadline).toHaveValue("48");
  await expect(clearance).toHaveValue("automatic");
  await page.getByRole("button", { name: "Save clearance policy", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "changed" })).toBeVisible();
  await expect(clearance).toHaveValue("automatic");
});

test("Admin settings remain long, fit narrow screens, retain language edits, and protect mode changes", async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(value)), session);
  await open(page, "session");
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  const brand = page.getByLabel("Brand text", { exact: true });
  await brand.fill("Unsaved brand");
  const before = await page.locator("#agency-language").inputValue();
  await page.getByRole("button", { name: "Choose language", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /Svenska/ }).click();
  await expect(brand).toHaveCount(0); // Labels translate; the field value is retained.
  await expect(page.getByLabel("Varumärkestext", { exact: true })).toHaveValue("Unsaved brand");
  await page.getByRole("button", { name: "Välj språk", exact: true }).click();
  await page.getByRole("menuitemradio", { name: /English/ }).click();
  await expect(brand).toHaveValue("Unsaved brand");
  await expect(page.locator("#agency-language")).toHaveValue(before);
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await expect(brand).toHaveValue("Unsaved brand");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(1500);
  }
});

test("exceptional menus and field help work with a keyboard and return focus", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "controls");
  const trigger = page.getByRole("button", { name: "Set unavailable or pertinent-negative value for Gender" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Not recorded", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Not applicable", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click(); await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  const help = page.locator(".stationary-picker-label > span");
  await expect(page.locator(".stationary-picker-label .field-help-trigger")).toHaveCount(0);
  await help.hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("picker-title-help-desktop.png") });
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toBeHidden();
  await help.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(help).toBeFocused();
  await trigger.focus();
  await page.setViewportSize({ width: 360, height: 800 });
  await help.tap();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("picker-title-help-mobile.png") });
});

test("clinical record scrolls all sections in a desktop panel and uses a compact mobile selector", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "record");
  const content = page.locator(".stationary-record-page");
  await expect(content).toHaveCSS("overflow-y", "auto");
  const rail = page.getByRole("navigation", { name: "Stationary record sections" });
  await expect(rail).toHaveCSS("background-color", "rgb(237, 241, 250)");
  await expect(rail.locator(".stationary-section-selection")).toHaveCSS("background-color", "rgb(49, 91, 168)");
  await expect(rail).toHaveCSS("scrollbar-width", "none");
  await expect(content).toHaveCSS("scrollbar-width", "none");
  await expect.poll(() => page.locator(".stationary-record-layout").evaluate(element =>
    Math.abs(element.getBoundingClientRect().bottom - innerHeight) < 1)).toBe(true);
  const highlightMatchesSelection = () => rail.evaluate(element => {
    const selected = element.querySelector('button[aria-current="location"]')!.getBoundingClientRect();
    const highlight = element.querySelector(".stationary-section-selection")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return ["x", "y", "width", "height"].every(key => Math.abs(selected[key as keyof DOMRect] as number
      - (highlight[key as keyof DOMRect] as number)) < 1)
      && selected.top >= bounds.top && selected.bottom <= bounds.bottom;
  });
  await expect.poll(highlightMatchesSelection).toBe(true);
  await rail.getByRole("button", { name: /^Narrative:/ }).click();
  await expect(page.locator("#stationary-section-eNarrativeSection-heading")).toBeFocused();
  await expect(rail.getByRole("button", { name: /^Narrative:/ })).toHaveAttribute("aria-current", "location");
  await expect.poll(highlightMatchesSelection).toBe(true);
  await rail.screenshot({ path: test.info().outputPath("stationary-sliding-selector.png") });
  expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await content.evaluate(element => { element.scrollTop = 0; });
  await expect(rail.getByRole("button").first()).toHaveAttribute("aria-current", "location");
  await expect.poll(highlightMatchesSelection).toBe(true);
  await rail.getByRole("button").first().focus();
  await page.keyboard.press("Tab");
  await expect(rail.getByRole("button").nth(1)).toBeFocused();
  await expect(rail.getByRole("button").nth(1)).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(rail.getByRole("button").nth(1)).toHaveAttribute("aria-current", "location");
  await expect.poll(highlightMatchesSelection).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(rail.locator(".stationary-section-selection")).toHaveCSS("transition-duration", "0s");
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".stationary-section-selector")).toBeVisible();
    await expect(rail).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("stationary encounter fills the available screen without a page scrollbar", async ({ page }) => {
  const opened = JSON.parse(await readFile(path.resolve(__dirname, "../public/demo-open-assignment.json"), "utf8"));
  const assigned = JSON.parse(await readFile(path.resolve(__dirname, "../public/demo-assigned-calls.json"), "utf8"));
  await page.addInitScript(value => localStorage.setItem("open-triage.clinician-session.v1", JSON.stringify(value)), session);
  await page.route("**/api/calls/assigned", route => route.fulfill({ json: assigned }));
  await page.route("**/api/calls/*/open", route => route.fulfill({ json: opened }));
  await page.route("**/api/reports/*/protected-key-envelope", route => route.fulfill({ status: 409, json: {} }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, "session");
  await page.getByRole("button", { name: "Stationary", exact: true }).click();
  await page.getByRole("button", { name: "Open call", exact: true }).first().click();
  const workspace = page.locator(".stationary-record-layout");
  await expect(workspace).toBeVisible();
  for (const height of [640, 900, 1080]) {
    await page.setViewportSize({ width: 1280, height });
    await expect.poll(() => workspace.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - innerHeight) < 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    for (const selector of [".stationary-section-rail", ".stationary-record-page"]) {
      await expect(page.locator(selector)).toHaveCSS("scrollbar-width", "none");
      expect(await page.locator(selector).evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    }
  }
  const finalSection = page.locator(".stationary-section-rail button").last();
  await finalSection.click();
  await expect(finalSection).toHaveAttribute("aria-current", "location");
  expect(await page.locator(".stationary-record-page").evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath("stationary-full-height.png") });
});

test("field help remains keyboard accessible inside read-only fieldsets", async ({ page }) => {
  await open(page, "controls-disabled");
  const help = page.locator(".stationary-picker-label > span");
  await help.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(help).toBeFocused();
  await expect(page.getByRole("button", { name: "Set unavailable or pertinent-negative value for Gender" })).toBeDisabled();
});

test("user and role editor dismissal protects drafts and returns focus to the initiating action", async ({ page }) => {
  await page.route("**/api/admin/users?*", route => route.fulfill({ json: { items: [
    { id: "user", displayName: "Test user", username: "test.user", active: true, roles: [], revision: 1 },
  ], nextCursor: null } }));
  await page.route("**/api/admin/user-role-options", route => route.fulfill({ json: { items: [] } }));
  await open(page, "users");
  const manage = page.getByRole("button", { name: "Manage", exact: true });
  await manage.click();
  await page.locator(".admin-user-management-form").getByLabel("Display name", { exact: true }).fill("Unsaved identity");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".admin-user-management-form").getByLabel("Display name", { exact: true })).toHaveValue("Unsaved identity");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(manage).toBeFocused();
  const role = { id: "role", displayName: "Test role", description: "Clinical work", active: true, protected: false,
    version: 1, assigneeCount: 1, capabilities: [{ key: "clinical:document", description: "Clinical documentation" }] };
  await page.route("**/api/admin/roles?*", route => route.fulfill({ json: { items: [role] } }));
  await page.route("**/api/admin/role-capabilities", route => route.fulfill({ json: { items: [
    { key: "clinical:document", description: "Clinical documentation", mutable: true, prerequisites: [] },
  ] } }));
  await page.route("**/api/admin/roles/role", route => route.fulfill({ json: { ...role, version: 2,
    displayName: route.request().postDataJSON().displayName } }));
  await open(page, "roles");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  await page.getByLabel("Role name", { exact: true }).fill("Edited role");
  await page.getByRole("button", { name: "Save and activate", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(page.locator(".admin-role-editor")).toHaveCount(0);
});

test("validation retains invalid JSON while switching rules and saves corrected parameters", async ({ page }) => {
  const rules = ["First rule", "Second rule"].map((name, index) => ({ id: `rule-${index}`, name,
    enabled: true, severity: "error", executionTargets: ["live"], primaryTargetElementId: "eResponse.03",
    message: "Incident number required", source: 'assert present("eResponse.03")' }));
  const draft = { id: "validation", displayName: "Rules", catalogReleaseId: "catalog", revision: 1, rules, updatedAt: now };
  await page.route("**/api/admin/validation-draft", route => route.fulfill({ json: draft }));
  await page.route("**/api/admin/catalog-versions/catalog", route => route.fulfill({ json: {
    id: "catalog", definition: { elements: [{ elementId: "eResponse.03", label: "Incident number", baseDatatype: "string",
      storageSemantics: { groupPath: ["eResponse"] }, constraints: { minOccurs: 0, maxOccurs: 1 } }], codeLists: [] },
  } }));
  await page.route("**/api/admin/validation-rules?*", route => route.fulfill({ json: { total: 2, items: rules.map(rule => ({
    rule, source: "agency", validity: "valid", diagnostics: [],
  })) } }));
  let saved: unknown;
  await page.route("**/api/admin/validation-drafts/validation", route => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { ...draft, ...route.request().postDataJSON(), revision: 2 } });
  });
  await open(page, "validation");
  const input = page.locator("#validation-message-parameters");
  const save = page.getByRole("button", { name: "Save Validation draft", exact: true });
  await input.fill('{"count":');
  await page.getByRole("row").filter({ hasText: "Second rule" }).getByRole("rowheader").click();
  await expect(save).toBeDisabled();
  await page.getByRole("row").filter({ hasText: "First rule" }).getByRole("rowheader").click();
  await expect(input).toHaveValue('{"count":');
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill('{"count": 3}');
  await save.click();
  expect(saved).toMatchObject({ expectedRevision: 1, rules: [{ messageParameters: { count: 3 } }, {}] });
  await expect(page.getByRole("status").filter({ hasText: "Saved draft revision 2." })).toBeVisible();
});

test("queue failures retain rows, selections and scroll; failed pagination preserves the displayed page; revoked access clears rows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let status = 200;
  await page.route("**/api/review/queue?*", route => status !== 200 ? route.fulfill({ status, json: {} }) : route.fulfill({ json: {
    dataset: "real", page: Number(new URL(route.request().url()).searchParams.get("page")), pageSize: 25, total: 75,
    asOf: now, assignmentCounts: { all: 75, mine: 0, unassigned: 75 }, items: Array.from({ length: 25 }, (_, i) => item(i)),
  } }));
  await open(page, "review");
  const rows = page.locator(".review-queue-table tbody tr");
  await expect(rows).toHaveCount(25);
  await rows.first().getByRole("checkbox").check();
  const panel = page.locator(".review-table-scroll");
  await panel.evaluate(element => { element.scrollTop = 250; });
  const position = await panel.evaluate(element => element.scrollTop);
  status = 503;
  await refresh(page);
  await expect(page.getByRole("alert").filter({ hasText: "last loaded results" })).toBeVisible();
  await expect(rows).toHaveCount(25);
  await expect(rows.first().getByRole("checkbox")).toBeChecked();
  expect(await panel.evaluate(element => element.scrollTop)).toBe(position);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(rows.first().getByRole("checkbox")).toBeDisabled();
  status = 200;
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await expect(rows.first().getByRole("checkbox")).toBeEnabled();
  status = 403;
  await refresh(page);
  await expect(rows).toHaveCount(0);
});

test("outcomes and backlog retain loaded entries and unsaved outcome edits on failure and retry", async ({ page }) => {
  let failed = false;
  await page.route("**/api/review/outcomes", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: [
    { id: "outcome", label: "Approved", meaning: "Reviewed and approved", active: true, revision: 1 },
  ] }));
  await page.route("**/api/review/backlog?*", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: {
    work: [{ reportId: "pending-report", state: "queued", attempts: 1 }],
  } }));
  await open(page, "review-settings");
  const outcomes = page.locator('section[aria-labelledby="review-outcomes-heading"]');
  const backlog = page.locator('section[aria-labelledby="review-backlog-heading"]');
  await outcomes.getByRole("combobox").selectOption("outcome");
  const label = outcomes.getByRole("textbox").first();
  await label.fill("My outcome edit");
  await expect(backlog.getByRole("listitem")).toHaveCount(1);
  failed = true;
  await refresh(page);
  await expect(outcomes.getByRole("alert")).toBeVisible();
  await expect(backlog.getByRole("alert")).toBeVisible();
  await expect(outcomes.locator("option")).toHaveCount(2);
  await expect(backlog.getByRole("listitem")).toHaveCount(1);
  await expect(label).toHaveValue("My outcome edit");
  failed = false;
  await outcomes.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(outcomes.getByRole("alert")).toHaveCount(0);
  await expect(backlog.getByRole("alert")).toHaveCount(0);
  await expect(label).toHaveValue("My outcome edit");
});

test("user and role lists retain plain names after failed filters and retry the requested filter", async ({ page }) => {
  let failed = false;
  await page.route("**/api/admin/user-role-options", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/admin/role-capabilities", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/admin/users?*", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: {
    items: [{ id: "user", displayName: "Test user", username: "test.user", active: true, roles: [], revision: 1 }], nextCursor: null,
  } }));
  await page.route("**/api/admin/roles?*", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: {
    items: [{ id: "role", displayName: "Test role", description: "Clinical work", active: true, protected: false, version: 1, assigneeCount: 1, capabilities: [] }],
  } }));
  for (const view of ["users", "roles"]) {
    failed = false;
    await open(page, view);
    const rows = view === "users" ? page.locator(".admin-table-scroll tbody tr") : page.locator(".admin-role-matrix thead th").filter({ hasText: "Test role" });
    await expect(rows).toHaveCount(1);
    await expect((view === "users" ? rows.first().getByRole("rowheader") : rows.first()).locator("button")).toHaveCount(0);
    failed = true;
    if (view === "users") {
      await page.getByRole("searchbox").fill("Other user");
      await page.getByRole("button", { name: "Apply filters", exact: true }).click();
    } else await page.locator(".admin-role-state select").selectOption("all");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "last loaded results" })).toBeVisible();
    await expect(rows).toHaveCount(1);
    failed = false;
    await page.getByRole("button", { name: "Retry loading", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(rows).toHaveCount(1);
  }
});

test("validation filter errors retain rule rows and unsaved parameters until retry succeeds", async ({ page }) => {
  let failed = false;
  const rule = { id: "rule", name: "Incident check", enabled: true, severity: "error", executionTargets: ["live"],
    primaryTargetElementId: "eResponse.03", message: "Incident required", source: 'assert present("eResponse.03")' };
  await page.route("**/api/admin/validation-draft", route => route.fulfill({ json: {
    id: "validation", displayName: "Rules", catalogReleaseId: "catalog", revision: 1, rules: [rule], updatedAt: now,
  } }));
  await page.route("**/api/admin/catalog-versions/catalog", route => route.fulfill({ json: {
    id: "catalog", definition: { elements: [{ elementId: "eResponse.03", label: "Incident number", baseDatatype: "string",
      storageSemantics: { groupPath: ["eResponse"] }, constraints: { minOccurs: 0, maxOccurs: 1 } }], codeLists: [] },
  } }));
  await page.route("**/api/admin/validation-rules?*", route => failed ? route.fulfill({ status: 503 }) : route.fulfill({ json: {
    total: 1, items: [{ rule, source: "agency", validity: "valid", diagnostics: [] }],
  } }));
  await open(page, "validation");
  const rows = page.locator(".validation-rule-table tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("rowheader")).toHaveText("Incident check");
  await expect(rows.first().getByRole("rowheader").getByRole("button")).toHaveCount(0);
  await page.locator("#validation-message-parameters").fill('{"count":');
  failed = true;
  await page.locator(".validation-library-filters").getByRole("searchbox").fill("another rule");
  await expect(page.getByRole("alert").filter({ hasText: "last loaded results" })).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(page.locator("#validation-message-parameters")).toHaveValue('{"count":');
  failed = false;
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "last loaded results" })).toHaveCount(0);
  await expect(page.locator("#validation-message-parameters")).toHaveValue('{"count":');
  await page.screenshot({ path: test.info().outputPath("validation-list-actions.png") });
});

test("Admin connection failures keep the mounted editor and draft and retry restores context", async ({ page }) => {
  let failed = false;
  await page.route("**/api/admin/context", route => failed ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: {
    organization: session.organization, panels: ["settings"], capabilities: session.capabilities, activeConfiguration: null, dashboard: null,
  } }));
  await open(page, "admin");
  const brand = page.getByLabel("Brand text", { exact: true });
  await brand.fill("Unsaved brand");
  failed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByRole("alert").filter({ hasText: "last loaded results" })).toBeVisible();
  await expect(brand).toHaveValue("Unsaved brand");
  failed = false;
  await page.getByRole("button", { name: "Retry loading", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(brand).toHaveValue("Unsaved brand");
});

test("timeline titles remain plain text with independent row and keyboard actions", async ({ page }) => {
  await open(page, "timeline");
  const row = page.locator(".timeline-event-button");
  const title = row.locator(".event-title");
  await expect(title).toHaveText("Text note");
  expect(await title.evaluate(element => !element.closest("button"))).toBe(true);
  await title.click();
  await expect(page.getByRole("status").filter({ hasText: "Opened 1" })).toBeVisible();
  await expect(row.getByRole("button")).toBeFocused();
  await row.getByRole("button").press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Opened 2" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("timeline-list-actions.png") });
});

test("routing save responses preserve edits made while the request is pending", async ({ page }) => {
  let finish: (() => Promise<void>) | undefined;
  await page.route("**/api/review/routes/criterion", route => {
    const command = route.request().postDataJSON();
    finish = () => route.fulfill({ json: { criterionId: "criterion", name: "Narrative check", ...command, version: 2 } });
  });
  await open(page, "review-settings");
  const destination = page.getByRole("combobox", { name: "Route to", exact: true });
  const save = page.getByRole("button", { name: "Save route", exact: true });
  await destination.selectOption("author");
  await save.click();
  await expect.poll(() => !!finish).toBe(true);
  await expect(save).toBeDisabled();
  await destination.selectOption("unassigned");
  await finish!();
  await expect(save).toBeEnabled();
  await expect(destination).toHaveValue("unassigned");
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
});

test("finding list names remain plain and row actions do not intercept secondary controls", async ({ page }) => {
  await open(page, "findings");
  const name = page.getByText("Incident number missing", { exact: true });
  expect(await name.evaluate(element => !element.closest("button"))).toBe(true);
  await name.click();
  await expect(page.getByRole("status")).toHaveText("Opened 1; acknowledged 0");
  const action = page.getByRole("button", { name: "Open affected field: Incident number missing", exact: true });
  await expect(action).toBeFocused();
  await action.press("Enter");
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Opened 2; acknowledged 1");
  await page.screenshot({ path: test.info().outputPath("finding-list-actions.png") });
});
