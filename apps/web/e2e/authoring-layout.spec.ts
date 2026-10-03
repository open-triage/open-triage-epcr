import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

let script: string;
let css: string;
const rules = Array.from({ length: 30 }, (_, index) => ({
  id: `rule-${index}`, name: `Patient name check ${index + 1}`, message: "Enter the patient name",
  source: 'require present("ePatient.02")', primaryTargetElementId: "ePatient.02", sourceKind: "agency",
  enabled: true, severity: "error", executionTargets: ["live", "sign"],
}));

const catalogDraft = { id: "catalog-draft", revision: 1, displayName: "Agency catalog", sourceReleaseId: "catalog", definition: {
  schemaVersion: 1, sourceReleaseId: "catalog", customElements: [], customGroups: [], codeLists: [],
  elements: Array.from({ length: 30 }, (_, index) => ({ elementId: `ePatient.${String(index + 1).padStart(2, "0")}`,
    label: `Patient element ${index + 1}`, description: "Patient information", baseDatatype: "string", identityId: `patient-${index}`,
    storageSemantics: { groupPath: ["PatientCareReportGroup", "ePatientSection"], sourceDatatype: "string", analyticalLocation: "wide", sqlType: "text" },
    constraints: { minOccurs: 0, maxOccurs: 1 }, requirednessSeverity: null })),
} };

test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {addFormElement,FormElementPicker,FormSectionElements} from './components/form-authoring';
      import {ValidationAuthoring} from './components/validation-authoring';
      import {CatalogAuthoring} from './components/catalog-authoring';
      function Form(){const [query,setQuery]=useState('');const [definition,setDefinition]=useState({schemaVersion:1,sections:[
        {key:'response',name:'Response',fields:[
          {key:'service',source:{kind:'nemsis',elementId:'eResponse.05'},choicePolicy:[
            {kind:'not-value',code:'7701003'}, {kind:'code',code:'1',codeSystem:'local'},
            {kind:'not-value',code:'7701001'}, {kind:'code',code:'2',codeSystem:'local'}]},
          {key:'response-mode',source:{kind:'nemsis',elementId:'eResponse.23'}}]},
        {key:'patient',name:'Patient',fields:[{key:'name',source:{kind:'nemsis',elementId:'ePatient.02'}}]}]});
        return <div className="form-editor"><FormSectionElements definition={definition} language="en"
          renderElementPicker={sectionKey=><FormElementPicker definition={definition} query={query} onQueryChange={setQuery}
            results={[{elementId:'ePatient.15',name:'Age',baseDatatype:'integer',groupPath:['ePatient']}]}
            onAdd={element=>setDefinition(addFormElement(definition,sectionKey,element))}/>}
          onChange={setDefinition} onMoveSection={(from,to)=>{const sections=[...definition.sections];const [item]=sections.splice(from,1);sections.splice(to,0,item);setDefinition({...definition,sections});}}
          onRequestRemoveSection={()=>{}} catalogFields={{'eResponse.05':{codeChoices:[
            {code:'1',codeSystem:'local',label:'Emergency response'},
            {code:'2',codeSystem:'local',label:'Interfacility transport'}],
            exceptionalChoices:[{key:'not-value:7701003'},{key:'not-value:7701001'}]}}}/>
          <output hidden data-testid="definition">{JSON.stringify(definition)}</output></div>;}
      createRoot(document.getElementById('root')).render(location.search.includes('validation')?
        <ValidationAuthoring language="en" csrfToken="fixture" catalogReleaseId="catalog" capabilities={['validation:read','validation:write']}/>:location.search.includes('catalog')?
        <CatalogAuthoring language="en" csrfToken="fixture" capabilities={['catalog:read','catalog:write']}/>:<Form/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => { throw error; });
  await page.route("**/__layout-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__authoring-layout*", route => route.fulfill({ contentType: "text/html",
    body: `<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="--green:#315ba8;--green-dark:#24447e;--inactive-button:#edf1fa;--text-color:#202850"><main id="root"></main><script src="/__layout-script"></script></body></html>` }));
  await page.route("**/api/admin/**", route => {
    const pathname = new URL(route.request().url()).pathname.replace("/api/admin/", "");
    if (pathname === "catalog-draft") return route.fulfill({ json: catalogDraft });
    if (pathname === "catalog-versions") return route.fulfill({ json: [] });
    if (pathname === "validation-draft") return route.fulfill({ json: { id: "draft", revision: 1,
      displayName: "Agency rules", catalogReleaseId: "catalog", rules } });
    if (pathname === "validation-versions" || pathname === "form-versions") return route.fulfill({ json: [] });
    if (pathname === "catalog-versions/catalog") return route.fulfill({ json: { id: "catalog", definition: {
      elements: [{ elementId: "ePatient.02", label: "Last Name", baseDatatype: "string",
        storageSemantics: { groupPath: ["PatientCareReportGroup", "ePatient.PatientNameGroup"] }, constraints: { minOccurs: 0, maxOccurs: 1 } }], codeLists: [],
    } } });
    if (pathname === "validation-rules") return route.fulfill({ json: { total: rules.length, items: rules.map(rule => ({
      rule, source: "agency", validity: "invalid", diagnostics: [{ message: "Check the target element before publishing." }],
    })) } });
    return route.fulfill({ status: 404, body: pathname });
  });
});

test("form columns align and adapt to a narrow viewport", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout");
  await expect(page.locator(".form-fields")).not.toContainText("Data binding:");
  const rows = page.getByRole("list", { name: "response form elements" }).locator(":scope > li");
  if (testInfo.project.name === "desktop") {
    await expect(page.locator(".form-element-columns")).toBeVisible();
    const columns = await rows.evaluateAll(elements => elements.map(element => [...element.children]
      .filter(child => !child.classList.contains("form-choice-lists")).map(child => child.getBoundingClientRect().x)));
    expect(columns[0]).toEqual(columns[1]);
  } else {
    await expect(page.locator(".form-element-columns")).toBeHidden();
    await expect(page.getByLabel("Move to section eResponse.05")).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("form-layout.png"), fullPage: true });
});

test("group rows rename in place and add elements to the selected group", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout");
  const patient = page.locator(".form-section").filter({ has: page.getByRole("group", { name: "Actions for patient", exact: true }) });
  const actions = patient.getByRole("group", { name: "Actions for patient", exact: true });
  const definition = async () => JSON.parse((await page.getByTestId("definition").textContent())!);
  await expect(page.getByLabel("Section name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await actions.getByRole("button", { name: "Rename", exact: true }).click();
  const name = patient.getByLabel("Section name", { exact: true });
  await expect(name).toBeFocused();
  await name.fill("Patient details");
  expect((await definition()).sections[1].key).toBe("patient");
  expect((await definition()).sections[1].fields[0].source.elementId).toBe("ePatient.02");
  await name.press("Enter");
  await expect(actions.getByRole("button", { name: "Rename", exact: true })).toBeFocused();
  await expect(patient.locator(".form-section-heading")).toContainText("Patient details");

  await actions.getByRole("button", { name: "Add elements", exact: true }).click();
  const search = patient.getByRole("searchbox");
  await expect(search).toBeFocused();
  await expect(page.locator("#form-target-section")).toHaveCount(0);
  await search.fill("age");
  await patient.getByRole("button", { name: "Add ePatient.15", exact: true }).click();
  const after = await definition();
  expect(after.sections[1].name).toBe("Patient details");
  expect(after.sections[1].fields.map((field: { key: string }) => field.key)).toEqual(["name", "ePatient.15"]);
  expect(after.sections[0].fields).toHaveLength(2);
  await expect(patient.getByRole("button", { name: "ePatient.15 is already in the form", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("group-row-actions.png"), fullPage: true });
  await search.press("Escape");
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await expect(actions.getByRole("button", { name: "Add elements", exact: true })).toBeFocused();
  await page.getByRole("group", { name: "Actions for response", exact: true }).getByRole("button", { name: "Add elements", exact: true }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("age");
  await expect(page.getByRole("button", { name: "ePatient.15 is already in the form", exact: true })).toBeDisabled();
});

test("mouse and keyboard reorder fields, nested choices, and sections", async ({ page }) => {
  await page.goto("/__authoring-layout");
  const fields = page.getByRole("list", { name: "response form elements" });
  const definition = async () => JSON.parse((await page.getByTestId("definition").textContent())!);
  await page.getByRole("button", { name: "Reorder eResponse.05", exact: true }).dragTo(fields.locator(":scope > li").last());
  expect((await definition()).sections[0].fields.map((field: { key: string }) => field.key)).toEqual(["response-mode", "service"]);
  const handle = page.getByRole("button", { name: "Reorder eResponse.05", exact: true });
  await handle.press("Space"); await handle.press("ArrowUp"); await handle.press("Space");
  expect((await definition()).sections[0].fields[0].key).toBe("service");
  await page.getByRole("button", { name: "Edit choices and order", exact: true }).click();
  const choices = page.getByRole("list", { name: "Choices for eResponse.05" });
  await choices.getByRole("button", { name: "Reorder Emergency response choice" }).dragTo(choices.getByRole("listitem").last());
  const after = await definition();
  expect(after.sections[0].fields[0].choicePolicy.filter((choice: { kind: string }) => choice.kind === "code")
    .map((choice: { code: string }) => choice.code)).toEqual(["2", "1"]);
  expect(after.sections[0].fields[0].source).toEqual({ kind: "nemsis", elementId: "eResponse.05" });
  await page.getByRole("button", { name: "Reorder response", exact: true }).dragTo(page.getByRole("button", { name: "Reorder patient", exact: true }));
  expect((await definition()).sections.map((section: { key: string }) => section.key)).toEqual(["patient", "response"]);
});

test("form rows expand and collapse while embedded controls act independently", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout");
  const fields = page.getByRole("list", { name: "response form elements" });
  const row = fields.locator(":scope > li").first();
  const identity = row.locator(".form-element-identity");
  await identity.click();
  const close = row.getByRole("button", { name: "Close choices and order", exact: true });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  const checkbox = row.getByRole("checkbox", { name: "Emergency response", exact: true });
  await checkbox.uncheck();
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await row.getByText("Ordinary values", { exact: true }).click();
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await row.getByLabel("Move to section eResponse.05").click();
  await page.keyboard.press("Escape");
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await identity.click();
  await expect(row.getByRole("button", { name: "Edit choices and order", exact: true })).toHaveAttribute("aria-expanded", "false");
  const section = page.locator(".form-section").first();
  const heading = section.locator(".form-section-heading");
  await heading.click();
  await expect(fields).toBeHidden();
  await heading.click();
  await expect(fields).toBeVisible();
  await identity.hover();
  const background = await row.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.locator("body").evaluate(element => element.style.setProperty("--green", "#a8315b"));
  expect(await row.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(background);
  await page.screenshot({ path: testInfo.outputPath("form-row-hover.png"), fullPage: true });
});

test("ordinary and NOT values have separate sortable lists and responsive columns", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout");
  const edit = page.getByRole("button", { name: "Edit choices and order", exact: true });
  await expect(edit).toHaveAttribute("aria-expanded", "false");
  const before = await edit.boundingBox();
  await edit.click();
  const close = page.getByRole("button", { name: "Close choices and order", exact: true });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await expect(close).toBeFocused();
  const after = await close.boundingBox();
  expect(after!.x).toBe(before!.x);
  expect(after!.y).toBe(before!.y);
  const panelId = await close.getAttribute("aria-controls");
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  await close.press("Space");
  await expect(edit).toBeFocused();
  await expect(page.locator(`[id="${panelId}"]`)).toBeHidden();
  const closed = await edit.boundingBox();
  expect(closed!.x).toBe(before!.x);
  expect(closed!.y).toBe(before!.y);
  await edit.press("Enter");
  const choices = page.getByRole("list", { name: "Choices for eResponse.05", exact: true });
  const notValues = page.getByRole("list", { name: "NOT values for eResponse.05", exact: true });
  const policy = async () => JSON.parse((await page.getByTestId("definition").textContent())!).sections[0].fields[0].choicePolicy;
  const codes = async () => (await policy()).filter((choice: { kind: string }) => choice.kind === "code");
  const exceptional = async () => (await policy()).filter((choice: { kind: string }) => choice.kind === "not-value");
  const initialCodes = await codes();
  const initialNotValues = await exceptional();
  await expect(choices.getByRole("checkbox")).toHaveCount(2);
  await expect(notValues.getByRole("checkbox")).toHaveCount(2);
  await expect(choices.getByRole("checkbox", { name: "Not Recorded" })).toHaveCount(0);
  const ordinaryBox = await choices.boundingBox();
  const notBox = await notValues.boundingBox();
  if (testInfo.project.name === "desktop") {
    expect(notBox!.x).toBeGreaterThan(ordinaryBox!.x + ordinaryBox!.width);
    expect(notBox!.y).toBe(ordinaryBox!.y);
  } else {
    expect(notBox!.y).toBeGreaterThanOrEqual(ordinaryBox!.y + ordinaryBox!.height);
  }
  const notHandle = notValues.getByRole("button", { name: "Reorder Not Recorded choice", exact: true });
  await notHandle.dragTo(choices.getByRole("listitem").last());
  expect(await exceptional()).toEqual(initialNotValues);
  expect(await codes()).toEqual(initialCodes);
  await notHandle.dragTo(notValues.getByRole("listitem").last());
  expect(await exceptional()).toEqual([...initialNotValues].reverse());
  expect(await codes()).toEqual(initialCodes);
  await notHandle.press("Space"); await notHandle.press("ArrowUp"); await notHandle.press("Space");
  expect(await exceptional()).toEqual(initialNotValues);
  const codeHandle = choices.getByRole("button", { name: "Reorder Emergency response choice", exact: true });
  await codeHandle.press("Space"); await codeHandle.press("ArrowDown"); await codeHandle.press("Space");
  expect(await codes()).toEqual([...initialCodes].reverse());
  expect(await exceptional()).toEqual(initialNotValues);
  await choices.getByRole("checkbox", { name: "Emergency response" }).uncheck();
  expect(await exceptional()).toEqual(initialNotValues);
  await notValues.getByRole("checkbox", { name: "Not Recorded", exact: true }).uncheck();
  await choices.getByRole("checkbox", { name: "Emergency response" }).check();
  await notValues.getByRole("checkbox", { name: "Not Recorded", exact: true }).check();
  await notHandle.press("Space"); await notHandle.press("Home"); await notHandle.press("Space");
  expect(await codes()).toEqual([...initialCodes].reverse());
  expect(await exceptional()).toEqual(initialNotValues);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const editedPolicy = await policy();
  await close.click();
  await edit.click();
  expect(await policy()).toEqual(editedPolicy);
  await page.screenshot({ path: testInfo.outputPath("separate-choice-lists.png"), fullPage: true });
});

test("validation library keeps compact rows and a roomy scroller at desktop and mobile widths", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout?validation");
  const scroller = page.getByRole("region", { name: "Validation rules", exact: true });
  const rows = scroller.locator("tbody tr");
  await expect(rows).toHaveCount(30);
  for (const width of [1280, 1920, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await scroller.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
    await scroller.scrollIntoViewIfNeeded();
    const metrics = await scroller.evaluate(element => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
    expect(metrics.height).toBeGreaterThanOrEqual(550);
    expect(metrics.contentHeight).toBeGreaterThan(metrics.height);
    expect((await rows.first().boundingBox())!.height).toBeLessThanOrEqual(64);
    expect((await rows.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(rows.getByRole("button")).toHaveCount(0);
    await expect(scroller.getByRole("columnheader")).toHaveCount(8);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await rows.nth(1).getByRole("rowheader").click();
    await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 2");
    await scroller.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`validation-list-${width}.png`) });
    await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const header = scroller.locator("thead th").first();
    const panelBox = (await scroller.boundingBox())!;
    expect(Math.abs((await header.boundingBox())!.y - panelBox.y - 1)).toBeLessThanOrEqual(1);
    await rows.last().getByRole("rowheader").click();
    await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 30");
    await rows.nth(1).locator(".validation-library-status").click();
    await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 30");
    await rows.nth(1).press("Enter");
    await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 2");
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");
    await rows.last().press("Space");
    await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 30");
  }
});

test("validation rows select a rule and help opens an overlay without resizing the table", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout?validation");
  const scroller = page.getByRole("region", { name: "Validation rules", exact: true });
  const row = scroller.getByRole("row").nth(2);
  await row.getByRole("cell").first().click();
  await expect(page.getByLabel("Name (en)")).toHaveValue("Patient name check 2");
  const help = row.locator(".validation-library-status");
  await expect(help).toHaveText("Invalid");
  await expect(row.locator(".field-help-trigger")).toHaveCount(0);
  await help.scrollIntoViewIfNeeded();
  const before = await row.boundingBox();
  await help.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveText(/Check the target element/);
  const after = await row.boundingBox();
  expect(after!.height).toEqual(before!.height);
  expect(after!.width).toEqual(before!.width);
  const box = await tooltip.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath("validation-tooltip.png") });
  await help.focus(); await help.press("Escape");
  await expect(tooltip).toHaveCount(0);
  await expect(help).toBeFocused();
  await help.blur(); await help.focus();
  await expect(tooltip).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await help.blur();
  await page.locator('label[for="validation-source"] [data-tooltip-trigger]').hover();
  await expect(page.getByRole("tooltip")).toContainText("Use optional");
});

test("section insertion line stays visible above the section content and matches the dropped order", async ({ page }, testInfo) => {
  await page.goto("/__authoring-layout");
  await page.getByLabel("Go to section").selectOption("");
  const handle = page.getByRole("button", { name: "Reorder response", exact: true });
  const target = page.locator('[data-sortable-item="patient"]').first();
  const definition = async () => JSON.parse((await page.getByTestId("definition").textContent())!);
  for (const position of ["after", "before"] as const) {
    const start = await handle.boundingBox();
    const end = await target.locator(".form-section-header").boundingBox();
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
    await page.mouse.down();
    await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 10 });
    await expect(target).toHaveAttribute("data-drop-position", position);
    const indicator = await target.evaluate(element => {
      const style = getComputedStyle(element, "::after");
      return { color: style.backgroundColor, height: style.height, edge: style.top, zIndex: style.zIndex,
        expectedEdge: element.getBoundingClientRect().height - 3 };
    });
    expect(indicator.color).toBe("rgb(49, 91, 168)");
    expect(indicator.height).toBe("3px");
    expect(Number(indicator.zIndex)).toBeGreaterThan(0);
    expect(parseFloat(indicator.edge)).toBe(position === "before" ? 0 : indicator.expectedEdge);
    await page.screenshot({ path: testInfo.outputPath(`section-insertion-${position}.png`) });
    await page.mouse.up();
    expect((await definition()).sections.map((section: { key: string }) => section.key))
      .toEqual(position === "after" ? ["patient", "response"] : ["response", "patient"]);
    await expect(page.locator(".is-drop-target")).toHaveCount(0);
  }
  await handle.press("Space"); await handle.press("ArrowDown");
  await expect(target).toHaveAttribute("data-drop-position", "after");
  await handle.press("Escape");
  await expect(page.locator(".is-drop-target")).toHaveCount(0);
  expect((await definition()).sections.map((section: { key: string }) => section.key)).toEqual(["response", "patient"]);
});

for (const editor of ["validation", "catalog"] as const) {
  test(`${editor} draft toolbar stays accessible while scrolling and saving`, async ({ page }, testInfo) => {
    let finishSave: (() => void) | undefined;
    const pendingSave = new Promise<void>(resolve => { finishSave = resolve; });
    const saved = editor === "catalog" ? catalogDraft : { id: "draft", revision: 1, displayName: "Agency rules", catalogReleaseId: "catalog", rules };
    await page.route(`**/api/admin/${editor}-drafts/${saved.id}`, async route => {
      const body = route.request().postDataJSON();
      await pendingSave;
      await route.fulfill({ json: { ...saved, ...body, revision: 2 } });
    });
    await page.goto(`/__authoring-layout?${editor}`);
    const toolbar = page.getByRole("group", { name: editor === "catalog" ? "Catalog draft actions" : "Validation draft actions", exact: true });
    const save = toolbar.getByRole("button", { name: editor === "catalog" ? /^Save draft$/i : /^Save validation draft$/i });
    await expect(toolbar.getByRole("status")).toHaveText("All changes saved");
    await page.locator(`#${editor}-display-name`).fill("Updated draft name");
    await expect(toolbar.getByRole("status")).toHaveText("Unsaved changes");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(toolbar).toHaveCSS("position", "sticky");
    const box = await toolbar.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThanOrEqual(108);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(save).toBeInViewport();
    await save.click();
    await expect(toolbar.getByRole("status")).toHaveText("Working…");
    await expect(save).toBeDisabled();
    await expect(toolbar.getByRole("button", { name: /Delete/ })).toBeDisabled();
    finishSave!();
    await expect(toolbar.getByRole("status")).toHaveText("All changes saved");
    await expect(page.locator(`#${editor}-display-name`)).toHaveValue("Updated draft name");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${editor}-draft-toolbar.png`) });
  });
}
