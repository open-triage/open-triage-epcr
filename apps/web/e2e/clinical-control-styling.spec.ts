import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

let script: string;
let css: string;

test.beforeAll(async () => {
  css = (await Promise.all(["styles.css", "session-layout.css", "review-workspace.css"].map(file =>
    readFile(path.resolve(__dirname, "../app", file), "utf8")))).join("\n");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {StationaryCodedValueField} from './components/stationary-coded-field';
      import {StationaryScalarControl} from './components/stationary-scalar-control';
      import {StationaryValidationMessages} from './components/stationary-validation-messages';
      import {CustomCodedFields} from './components/custom-coded-fields';
      import {TimePicker} from './components/time-picker';
      const field={elementId:'ePatient.13',label:'Gender',help:'Patient gender',options:[
        {code:'F',label:'Female',suggested:false},{code:'M',label:'Male',suggested:false}],
        controlKind:'select',exhaustive:true,maxOccurs:1,systems:[],
        exceptionalChoices:[{key:'not-value:7701003',kind:'null',code:'7701003',label:'Not recorded'}]};
      const presentation={elementId:'ePatient.15',groupId:'ePatient',label:'Age',help:'Patient age',
        family:'integer',inputType:'number',repeatable:false,maximumOccurrences:1};
      const custom={id:'response',namespace:'org.example',slug:'Response',title:'Response',definition:'Treatment response',
        datatype:'coded',recurrence:'single',choices:[{code:'A',label:'Improved'}],codeSystem:'local',
        permittedNotValues:[],permittedPertinentNegatives:[]};
      function Harness(){
        const [errors,setErrors]=useState(false);
        const [selected,setSelected]=useState({kind:'coded',occurrenceId:'gender',code:'F',display:'Female'});
        const [exceptional,setExceptional]=useState({kind:'null',occurrenceId:'age',notValue:{code:'7701003'}});
        const [document,setDocument]=useState({groups:[{id:'PatientCareReportGroup',instances:[{elements:[
          {id:'org.example.Response',values:[{kind:'coded',occurrenceId:'custom',system:'local',code:'A'}]}]}]}]});
        const severity=errors?' stationary-validation-state error':'';
        const findings=errors?[{severity:'error',message:'Choose a value'}]:[];
        return <main className={location.search.includes('mobile')?'mobile-presentation':'stationary-presentation'}>
          <nav><button type="button">Save</button><button type="button" className="active" aria-current="location">Patient</button>
            <button type="button" className="button-danger">Delete record</button>
            <button type="button" onClick={()=>setErrors(!errors)}>Toggle validation</button></nav>
          <section className="stationary-inline-fields">
            <div data-testid="coded-field" className={'stationary-field-shell'+severity}>
              <StationaryCodedValueField field={field} value={selected} onChange={setSelected}/>
              <StationaryValidationMessages findings={findings}/>
            </div>
            <div data-testid="neighbor" className="stationary-field-shell">
              <StationaryCodedValueField field={{...field,label:'Status'}} onChange={()=>{}}/>
            </div>
            <StationaryScalarControl presentation={presentation} value={{kind:'scalar',occurrenceId:'age',value:42}}
              findings={errors?[{elementId:'ePatient.15',code:'maximum',message:'Check age'}]:[]}
              exceptionalValue={exceptional} exceptionalChoices={[{code:'7701003',label:'Not recorded'}]}
              onExceptionalChange={code=>setExceptional(code?{kind:'null',occurrenceId:'age',notValue:{code}}:undefined)} onInput={()=>{}}/>
          </section>
          <section className="stationary-group-dialog-fields">
            <div data-testid="dialog-field" className={'stationary-dialog-field'+severity}>
              <StationaryCodedValueField field={{...field,label:'Outcome'}} onChange={()=>{}}/>
              <StationaryValidationMessages findings={findings}/>
            </div>
          </section>
          <section className="note-dialog vital-dialog">
            <div className="vital-grid">
              <div data-testid="mobile-field" className={'vital-field'+(errors?' finding-frame error':'')}>
                <label>Heart rate<input aria-label="Heart rate" type="number" defaultValue="80"/></label>
                {errors&&<p className="dialog-validation-message validation-message error">Check heart rate</p>}
              </div>
              <div className="vital-field"><label>Respiratory rate<input type="number" defaultValue="12"/></label></div>
            </div>
            <TimePicker label="Measured at" value="12:30" className={errors?'finding-frame error':undefined} onChange={()=>{}}/>
          </section>
          <CustomCodedFields document={document} fields={[{key:'response',source:{kind:'custom',elementDefinitionId:'response'}}]}
            definitions={{response:custom}} onDocumentChange={setDocument}/>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    ` } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/__clinical-controls-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__clinical-controls-harness*", route => route.fulfill({ contentType: "text/html",
    body: `<html lang="en"><head><style>${css}</style></head><body><div id="root"></div><script src="/__clinical-controls-script"></script></body></html>` }));
  await page.goto("/__clinical-controls-harness");
});

for (const mode of ["mobile", "stationary"]) {
  test(`${mode} actions use outlines, with filled active and agency-colored destructive actions`, async ({ page }) => {
    await page.goto(`/__clinical-controls-harness?${mode}`);
    const save = page.getByRole("button", { name: "Save", exact: true });
    const active = page.getByRole("button", { name: "Patient", exact: true });
    await expect(save).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(save).toHaveCSS("border-color", "rgb(0, 120, 58)");
    await expect(save).toHaveCSS("color", "rgb(26, 28, 26)");
    await expect(active).toHaveCSS("background-color", "rgb(0, 120, 58)");
    await expect(active).toHaveCSS("color", "rgb(255, 255, 255)");
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--green", "#255b42");
      document.documentElement.style.setProperty("--destructive", "#8a2670");
      document.documentElement.style.setProperty("--inactive-button", "#f2f5f3");
      document.documentElement.style.setProperty("--text-color", "#202520");
    });
    await expect(save).toHaveCSS("border-color", "rgb(37, 91, 66)");
    await expect(save).toHaveCSS("background-color", "rgb(242, 245, 243)");
    await expect(save).toHaveCSS("color", "rgb(32, 37, 32)");
    await expect(page.getByLabel("Age", { exact: true })).toHaveCSS("color", "rgb(32, 37, 32)");
    await expect(active).toHaveCSS("background-color", "rgb(37, 91, 66)");
    await expect(page.getByRole("button", { name: "Delete record" })).toHaveCSS("background-color", "rgb(138, 38, 112)");
  });
}

test("dropdowns are plain rows and delete/clear choices are first", async ({ page }) => {
  await page.getByRole("button", { name: "Gender", exact: true }).click();
  const options = page.getByRole("option");
  await expect(options).toHaveText(["Delete", "Female", "Male"]);
  await expect(options.first()).toHaveCSS("border-width", "0px");
  await expect(options.first()).toHaveCSS("border-radius", "0px");
  await expect(options.first()).toHaveCSS("box-shadow", "none");
  await expect(options.nth(1)).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("combobox", { name: "Search Gender" }).press("ArrowDown");
  await expect(options.nth(1)).toHaveClass(/is-active/);
  expect(await options.nth(1).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe("rgb(0, 120, 58)");
  await options.first().click();
  await expect(page.getByRole("button", { name: "Gender", exact: true })).toHaveText("Choose a value");
  await page.getByRole("button", { name: "Set unavailable value for Age" }).click();
  await expect(page.getByRole("menuitem").first()).toHaveText("Clear unavailable value");
  await expect(page.getByRole("menuitem").first()).toHaveCSS("border-width", "0px");
  await page.getByRole("menuitem").first().click();
  await page.getByRole("button", { name: "Response", exact: true }).click();
  await expect(options.first()).toHaveText("Delete");
  await options.first().click();
  await expect(page.getByRole("button", { name: "Response", exact: true })).toHaveText("Choose a value");
});

for (const width of [390, 1280]) {
  test(`validation does not shift picker controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1200 });
    const pickers = page.locator('[data-testid="coded-field"] .clinical-searchable-trigger, [data-testid="neighbor"] .clinical-searchable-trigger, [data-testid="dialog-field"] .clinical-searchable-trigger, [aria-label="Age"], [aria-label="Heart rate"], .time-picker-trigger');
    const before = await pickers.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const parent = element.closest('[data-testid]') ?? element.closest('fieldset, .time-picker-field')!;
      return { x, y: y - parent.getBoundingClientRect().y, width, height };
    }));
    await page.getByRole("button", { name: "Toggle validation" }).click();
    await expect(page.getByRole("alert")).toHaveCount(3);
    await expect(page.getByTestId("coded-field").locator("fieldset")).toHaveCSS("border-color", "rgb(184, 50, 42)");
    const after = await pickers.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const parent = element.closest('[data-testid]') ?? element.closest('fieldset, .time-picker-field')!;
      return { x, y: y - parent.getBoundingClientRect().y, width, height };
    }));
    expect(after).toEqual(before);
    if (width === 1280) {
      const coded = await page.getByTestId("coded-field").locator(".clinical-searchable-trigger").boundingBox();
      const neighbor = await page.getByTestId("neighbor").locator(".clinical-searchable-trigger").boundingBox();
      const scalar = await page.getByLabel("Age", { exact: true }).boundingBox();
      expect(coded!.y).toBe(neighbor!.y);
      expect(coded!.y).toBe(scalar!.y);
    }
  });
}
