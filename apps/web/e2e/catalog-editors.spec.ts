import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
      import {CatalogAuthoring} from './components/catalog-authoring';
      import {FormSectionElements} from './components/form-authoring';
      import {AdminLanguageContext} from './app/admin-localization';
      const standard={elementId:'ePatient.15',label:'Age',description:'Age at the time of the incident.',identityId:'age',baseDatatype:'integer',
        storageSemantics:{sourceDatatype:'Age',groupPath:['PatientCareReportGroup','ePatientSection'],analyticalLocation:'wide',sqlType:'integer'},requirednessSeverity:null,
        constraints:{minOccurs:0,maxOccurs:1,nillable:true,supportsNotValues:true,supportsPertinentNegatives:false}};
      const standardCoded={...standard,elementId:'ePatient.13',label:'Gender',description:'Patient gender.',identityId:'gender',baseDatatype:'string',
        storageSemantics:{...standard.storageSemantics,sourceDatatype:'Gender',sqlType:'text'},
        localization:{schemaVersion:1,sv:{label:'Kön',description:'Patientens kön',reviewedSource:{label:'Gender',description:'Patient gender.'}}}};
      const custom={id:'custom-coded',namespace:'org.example',slug:'Response',title:'Response',definition:'Treatment response',datatype:'coded',
        usage:'Optional',identifying:false,recurrence:'single',codeSystem:'https://example.org/response',nemsisElement:'ePatient.15',
        choices:[{code:'A',label:'Improved',nemsisCode:'1'},{code:'B',label:'Unchanged'}],permittedNotValues:['7701003'],permittedPertinentNegatives:[]};
      const initial={id:'draft',revision:1,displayName:'Editor test',definitionSha256:'test',sourceReleaseId:'release',definition:{schemaVersion:1,
        sourceReleaseId:'release',elements:[standard,standardCoded],customElements:[custom],customGroups:[],codeLists:[{listId:'age',name:'Age choices',
          classification:'agency',elementIds:['ePatient.15'],values:[{code:'1',codeSystem:'local',label:'One',sourceLabel:'One',category:null,enabled:true}]},
          {listId:'inline:ePatient.13',name:'Gender choices',classification:'inline',elementIds:['ePatient.13'],localization:{schemaVersion:1,sv:{name:'Könsval',reviewedSource:{name:'Gender choices'}}},
          values:[{code:'9906001',codeSystem:'local',label:'Female (DEPRECATED)',sourceLabel:'Female (DEPRECATED)',category:null,enabled:true,
            localization:{schemaVersion:1,sv:{label:'Kvinna',reviewedSource:{label:'Female (DEPRECATED)'}}}}]}]}};
      let draft=JSON.parse(localStorage.getItem('editor-draft')||'null')||initial;
      if(location.search.includes('partialSwedish')) {
        draft=structuredClone(draft);
        draft.definition.customElements[0].localization={schemaVersion:1,sv:{label:'Svar',reviewedSource:{label:'Response'}}};
        draft.definition.elements[0].localization={schemaVersion:1,sv:{label:'Ålder',reviewedSource:{label:'Age'}}};
      }
      const publishedMode=location.search.includes('published'); let createdDraft=false;
      window.fetch=async (url,init)=>{
        if(String(url).endsWith('catalog-versions')) return new Response(JSON.stringify(publishedMode ? [{id:'release',displayName:'Published catalog',version:'1',status:'active'}] : []));
        if(publishedMode && String(url).endsWith('catalog-draft') && !createdDraft) return new Response('null');
        if(publishedMode && init?.method==='POST' && String(url).endsWith('catalog-drafts')){createdDraft=true;return new Response(JSON.stringify(draft));}
        if(publishedMode && !createdDraft && (String(url).endsWith('catalog-definition') || String(url).endsWith('catalog-versions/release')))
          return new Response(JSON.stringify({id:'release',displayName:'Published catalog',version:'1',status:'active',definition:draft.definition}));
        if(init?.method==='PUT'){const body=JSON.parse(init.body);draft={...draft,definition:body.definition,revision:draft.revision+1};localStorage.setItem('editor-draft',JSON.stringify(draft));}
        return new Response(JSON.stringify(draft));
      };
      function Harness(){const [showCatalog,setShowCatalog]=useState(true); const [form,setForm]=useState({schemaVersion:1,sections:[{key:'patient',fields:[
        {key:'age',source:{kind:'nemsis',elementId:'ePatient.15'}},
        {key:'response',source:{kind:'custom',elementDefinitionId:custom.id},allowedAbsenceStates:['7701003']}
      ]}]});
      return <><button type="button" onClick={()=>setShowCatalog(!showCatalog)}>Switch page</button>
        {showCatalog && <AdminLanguageContext.Provider value={location.search.includes('agencySv') ? 'sv' : 'en'}><CatalogAuthoring ownerId="owner" organizationId="org" csrfToken="proof" capabilities={location.search.includes('readOnly') ? ['catalog:read'] : ['catalog:read','catalog:write']} language={location.search.includes('agencySv') ? 'sv' : 'en'}/></AdminLanguageContext.Provider>}
        <section aria-label="Form editor"><FormSectionElements language="en" definition={form} onChange={setForm} customFields={{[custom.id]:custom}}
          catalogFields={{'ePatient.15':{agencyRequired:false,minOccurs:0,maxOccurs:1,nillable:true,supportsNotValues:true,supportsPertinentNegatives:false,
            codeChoices:[{code:'1',codeSystem:'local',label:'One'}],exceptionalChoices:[{key:'not-value:7701003'}]}}}/></section>
        <output data-testid="form">{JSON.stringify(form)}</output></>}
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/__catalog-editor-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__catalog-editor-harness*", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__catalog-editor-script"></script></body></html>' }));
  await page.goto("/__catalog-editor-harness");
});

test("one element editor preserves standard definitions and saves custom code-list content", async ({ page }) => {
  const catalog = page.locator('.catalog-editor');
  await expect(catalog.getByRole("table").first().getByRole("textbox")).toHaveCount(0);
  await catalog.getByRole("button", { name: "View" }).first().click();
  await expect(catalog.getByRole("region", { name: "ePatient.15 element editor" }).getByRole("textbox", { name: "English title" })).toBeDisabled();
  await catalog.getByRole("button", { name: "Close" }).click();
  await catalog.getByRole("button", { name: "Edit" }).click();
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Patient response");
  await catalog.getByRole("button", { name: "Save wording revision" }).click();
  await page.getByRole("button", { name: "Switch page" }).click();
  await page.getByRole("button", { name: "Switch page" }).click();
  await catalog.getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveValue("Patient response");
  await catalog.getByRole("button", { name: "Group", exact: true }).click();
  await expect(catalog.getByLabel("Find by identifier or label")).not.toBeVisible();
  await catalog.getByRole("button", { name: "New group" }).click();
  await catalog.getByRole("textbox", { name: "Group ID", exact: true }).fill("Assessment");
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Assessment");
  await catalog.getByRole("button", { name: "Add group", exact: true }).click();
  await catalog.getByRole("textbox", { name: "Assessment English title", exact: true }).fill("Local assessment");
  await catalog.getByRole("button", { name: "Code List", exact: true }).click();
  await catalog.getByRole("row", { name: /Response —/ }).getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("checkbox")).toHaveCount(0);
  await expect(catalog.getByRole("button", { name: /Move .* (up|down)/ })).toHaveCount(0);
  await catalog.getByRole("textbox", { name: "English label for custom-coded https://example.org/response A", exact: true }).fill("Better");
  await catalog.getByRole("textbox", { name: "Code", exact: true }).fill("C");
  await catalog.getByRole("textbox", { name: "Label", exact: true }).fill("Worse");
  await catalog.getByRole("button", { name: "Add value", exact: true }).click();
  await catalog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('editor-draft')!).revision)).toBe(3);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('editor-draft')!));
  expect(saved.definition.elements[0].label).toBe("Age");
  expect(saved.definition.customElements[0].title).toBe("Patient response");
  expect(saved.definition.elements[0].description).toBe("Age at the time of the incident.");
  expect(saved.definition.customGroups[0].title).toBe("Local assessment");
  expect(saved.definition.customElements[0].choices).toEqual([
    { code: "A", label: "Better", nemsisCode: "1" }, { code: "B", label: "Unchanged" }, { code: "C", label: "Worse" },
  ]);
  await page.reload();
  await catalog.getByRole("button", { name: "Element", exact: true }).click();
  await catalog.getByRole("button", { name: "View" }).first().click();
  await expect(catalog.getByRole("region", { name: "ePatient.15 element editor" }).getByRole("textbox", { name: "English title" })).toHaveValue("Age");
});

test("the shared element creation form supports coded elements", async ({ page }) => {
  const catalog = page.locator('.catalog-editor');
  await catalog.getByRole("button", { name: "New element" }).click();
  await catalog.getByRole("combobox", { name: "Data type", exact: true }).selectOption("coded");
  await catalog.getByRole("textbox", { name: "Element ID", exact: true }).fill("eDisposition.02_se");
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Outcome");
  await catalog.getByRole("textbox", { name: "English definition", exact: true }).fill("Local outcome");
  await catalog.getByRole("combobox", { name: "Identifying information", exact: true }).selectOption("no");
  await catalog.getByRole("textbox", { name: "Code system URI", exact: true }).fill("https://example.org/outcome");
  await catalog.getByLabel(/Initial choices/).fill("OK | Recovered");
  await catalog.getByRole("button", { name: "Add element", exact: true }).click();
  await catalog.getByLabel("Find by identifier or label").fill("eDisposition.02_se");
  await expect(catalog.getByRole("row", { name: /eDisposition\.02_se/ })).toBeVisible();
  await catalog.getByRole("button", { name: "Code List", exact: true }).click();
  await catalog.getByRole("row", { name: /eDisposition\.02_se — Outcome/ }).getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: /English label for .* OK/ })).toHaveValue("Recovered");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.customElements.at(-1).slug).toBe("Orgorg_eDisposition.02_se");
});

test("catalog validation messages come from the selected application language", async ({ page }) => {
  await page.goto("/__catalog-editor-harness?agencySv");
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("button", { name: "Nytt element" }).click();
  await catalog.getByRole("textbox", { name: "Engelsk titel" }).fill("Outcome");
  await catalog.getByRole("textbox", { name: "Engelsk definition" }).fill("Local outcome");
  await catalog.getByRole("textbox", { name: "Element-ID" }).fill("eDisposition..02_se");
  await catalog.getByRole("button", { name: "Lägg till element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Element-ID måste börja med en bokstav");
  await catalog.getByRole("textbox", { name: "Element-ID" }).fill("eDisposition.02_se");
  await catalog.getByRole("textbox", { name: "Engelsk titel" }).fill("");
  await catalog.getByRole("button", { name: "Lägg till element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Den engelska titeln måste innehålla minst 2 tecken");
});

test("element creation explains each missing required field", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("button", { name: "New element" }).click();
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Enter an element ID");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("AgencyNote");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("English title must contain at least 2 characters");
  await catalog.getByRole("textbox", { name: "English title" }).fill("Agency note");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("English definition must contain at least 2 characters");
  await catalog.getByRole("textbox", { name: "English definition" }).fill("A local note about care.");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Choose Yes or No for Identifying information");
  await catalog.getByRole("combobox", { name: "Identifying information" }).selectOption("no");
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("sv");
  await catalog.getByRole("textbox", { name: "Swedish definition" }).fill("En lokal anteckning om vården.");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Enter a Swedish title or clear the Swedish definition");
  await catalog.getByRole("textbox", { name: "Swedish title" }).fill("Lokal anteckning");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("Response");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Element ID “Response” is already used in this catalog");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("AgencyNote");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("row", { name: /AgencyNote/ })).toBeVisible();
});

test("coded element errors identify the code system and choice line", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("button", { name: "New element" }).click();
  await catalog.getByRole("combobox", { name: "Data type" }).selectOption("coded");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("AgencyStatus");
  await catalog.getByRole("textbox", { name: "English title" }).fill("Agency status");
  await catalog.getByRole("textbox", { name: "English definition" }).fill("Local status code.");
  await catalog.getByRole("combobox", { name: "Identifying information" }).selectOption("no");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Enter a code system URI");
  await catalog.getByRole("textbox", { name: "Code system URI" }).fill("not-a-uri");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Code system must be a URI");
  await catalog.getByRole("textbox", { name: "Code system URI" }).fill("https://example.org/status");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Add at least one choice");
  await catalog.getByLabel(/Initial choices/).fill("A | Good\nB |\nC | Good");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Choice line 2 must use code | label");
  await catalog.getByLabel(/Initial choices/).fill("A | Good\nA | Better");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Choice code “A” appears more than once");
});

test("group creation identifies the missing group ID and title", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("button", { name: "Group", exact: true }).click();
  await catalog.getByRole("button", { name: "New group" }).click();
  await catalog.getByRole("button", { name: "Add group" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Enter a group ID");
  await catalog.getByRole("textbox", { name: "Group ID" }).fill("Assessment");
  await catalog.getByRole("button", { name: "Add group" }).click();
  await expect(catalog.getByRole("alert")).toContainText("English group title must contain at least 2 characters");
  await catalog.getByRole("textbox", { name: "English title" }).fill("Assessment");
  await catalog.getByRole("button", { name: "Add group" }).click();
  await expect(catalog.getByRole("row", { name: /Assessment/ })).toBeVisible();
});

test("element filters and read-only catalog access keep the list non-editable", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("combobox", { name: "Filter elements" }).selectOption("fixed");
  await expect(catalog.getByRole("row", { name: /ePatient.15/ })).toBeVisible();
  await expect(catalog.getByRole("row", { name: /Response/ })).toHaveCount(0);
  await catalog.getByRole("combobox", { name: "Filter elements" }).selectOption("custom");
  await expect(catalog.getByRole("row", { name: /Response/ })).toBeVisible();
  await expect(catalog.getByRole("row", { name: /ePatient.15/ })).toHaveCount(0);
  await page.goto("/__catalog-editor-harness?readOnly");
  await expect(catalog.getByRole("button", { name: "New element" })).toBeDisabled();
  await catalog.getByRole("button", { name: "View" }).first().click();
  await expect(catalog.getByRole("region", { name: "ePatient.15 element editor" }).getByRole("textbox", { name: "English title" })).toBeDisabled();
  await expect(catalog.getByRole("button", { name: "Copy element" })).toHaveCount(0);
  await catalog.getByRole("button", { name: "Group", exact: true }).click();
  await expect(catalog.getByRole("button", { name: "New group" })).toBeDisabled();
});

test("existing custom elements show their settings and copies require a unique ID", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("combobox", { name: "Data type" })).toHaveValue("coded");
  await expect(catalog.getByRole("textbox", { name: "Element ID" })).toHaveValue("Response");
  await expect(catalog.getByRole("textbox", { name: "English definition" })).toHaveValue("Treatment response");
  await expect(catalog.getByRole("textbox", { name: "Swedish title" })).toHaveCount(0);
  await expect(catalog.getByRole("textbox", { name: "Code system URI" })).toHaveValue("https://example.org/response");
  await expect(catalog.getByLabel(/^Choices/)).toContainText("Improved");
  await expect(catalog.getByRole("combobox", { name: "Optional NEMSIS element mapping" })).toHaveValue("ePatient.15");
  await catalog.locator(".custom-element-form").getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByRole("textbox", { name: "Element ID" })).toHaveValue("Response");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Change the element ID");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("ResponseCopy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("row", { name: /ResponseCopy/ })).toBeVisible();
  await catalog.getByRole("button", { name: "Save draft" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.customElements[1]).toMatchObject({ title: "Response", datatype: "coded", codeSystem: "https://example.org/response",
    choices: [{ code: "A", label: "Improved", nemsisCode: "1" }, { code: "B", label: "Unchanged" }] });
});

test("a copied custom element with a title-only Swedish translation can be saved", async ({ page }) => {
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/__catalog-editor-harness?partialSwedish");
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("row", { name: /Response/ }).getByRole("button", { name: "Edit" }).click();
  await catalog.locator(".custom-element-form").getByRole("button", { name: "Copy element" }).click();
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("sv");
  await expect(catalog.getByRole("textbox", { name: "Swedish title" })).toHaveValue("Svar");
  await expect(catalog.getByRole("textbox", { name: "Swedish definition" })).toHaveValue("");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("Response..Copy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Element ID must start with a letter");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("ResponseCopy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toHaveCount(0);
  await expect(catalog.getByRole("row", { name: /ResponseCopy/ })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.customElements).toHaveLength(2);
  expect(saved.definition.customElements[1].localization?.sv?.label).toBe("Svar");
  await catalog.getByRole("row", { name: /ResponseCopy/ }).getByRole("button", { name: "Edit" }).click();
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("en");
  await catalog.getByRole("textbox", { name: "English title" }).fill("Response copy revised");
  await catalog.getByRole("button", { name: "Save wording revision" }).click();
  await expect(catalog.getByRole("row", { name: /Response copy revised/ })).toBeVisible();
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("sv");
  await catalog.getByRole("row", { name: /ePatient\.15/ }).getByRole("button", { name: "View" }).click();
  await catalog.getByRole("region", { name: "ePatient.15 element editor" }).getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByRole("textbox", { name: "Swedish title" })).toHaveValue("Ålder");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("AgeCopy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("row", { name: /AgeCopy/ })).toBeVisible();
  const savedWithFixedCopy = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(savedWithFixedCopy.definition.customElements[2].localization?.sv?.label).toBe("Ålder");
});

test("NEMSIS metadata is read only and can seed a scalar custom element", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("row", { name: /ePatient.15/ }).getByRole("button", { name: "View" }).click();
  const fixed = catalog.getByRole("region", { name: "ePatient.15 element editor" });
  await expect(fixed.getByRole("textbox", { name: "Element ID" })).toHaveValue("ePatient.15");
  await expect(fixed.getByRole("textbox", { name: "Data type" })).toHaveValue("integer");
  await expect(fixed.getByRole("textbox", { name: "minInclusive" })).toHaveValue("1");
  await expect(fixed.getByRole("textbox", { name: "maxInclusive" })).toHaveValue("120");
  await expect(fixed.getByRole("textbox", { name: "English title" })).toBeDisabled();
  await fixed.getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByRole("textbox", { name: "Element ID" })).toHaveValue("ePatient.15");
  await expect(catalog.getByRole("combobox", { name: "Data type" })).toHaveValue("number");
  await expect(catalog.getByRole("spinbutton", { name: "Minimum" })).toHaveValue("1");
  await expect(catalog.getByRole("spinbutton", { name: "Maximum" })).toHaveValue("120");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await expect(catalog.getByRole("alert")).toContainText("Change the element ID");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("PatientAgeCopy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await catalog.getByRole("button", { name: "Save draft" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.customElements[1]).toMatchObject({ title: "Age", datatype: "number", usage: "Required",
    constraints: { minimum: 1, maximum: 120 } });
});

test("NEMSIS inline choices seed a coded custom element with mappings", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("row", { name: /ePatient.13/ }).getByRole("button", { name: "View" }).click();
  const fixed = catalog.getByRole("region", { name: "ePatient.13 element editor" });
  await expect(fixed.getByRole("textbox", { name: "English title" })).toHaveValue("Gender");
  await fixed.getByText("Code sources and choices").click();
  await expect(fixed.getByText("9906001 — Female (DEPRECATED)").first()).toBeVisible();
  await fixed.getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByRole("combobox", { name: "Data type" })).toHaveValue("coded");
  await expect(catalog.getByRole("combobox", { name: "Optional NEMSIS element mapping" })).toHaveValue("ePatient.13");
  await expect(catalog.getByLabel(/Initial choices/)).toContainText("9906001 | Female (DEPRECATED) | 9906001");
  await catalog.getByRole("textbox", { name: "Element ID" }).fill("PatientGenderCopy");
  await catalog.getByRole("button", { name: "Add element" }).click();
  await catalog.getByRole("button", { name: "Save draft" }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.customElements[1]).toMatchObject({ datatype: "coded", nemsisElement: "ePatient.13" });
  expect(saved.definition.customElements[1].choices[0]).toMatchObject({ code: "9906001", label: "Female (DEPRECATED)", nemsisCode: "9906001" });
  expect(saved.definition.customElements[1].choices).toHaveLength(6);
});

test("a writer can start a NEMSIS copy from a published catalog", async ({ page }) => {
  await page.goto("/__catalog-editor-harness?published");
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("row", { name: /ePatient.15/ }).getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByText("Create a catalog draft to finish copying this NEMSIS element.")).toBeVisible();
  await catalog.getByRole("textbox", { name: "New draft" }).fill("Age copy draft");
  await catalog.getByRole("button", { name: "Create draft from selected" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title" })).toHaveValue("Age");
  await expect(catalog.getByRole("textbox", { name: "Element ID" })).toHaveValue("ePatient.15");
  await expect(catalog.getByRole("textbox", { name: "Element ID" })).toBeEditable();
});

test("editing language switches element, group, and code-list wording", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  const editingLanguage = catalog.getByRole("combobox", { name: "Editing language" });
  await catalog.getByRole("row", { name: /Response/ }).getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toBeVisible();
  await expect(catalog.getByRole("textbox", { name: "Swedish title", exact: true })).toHaveCount(0);
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Response English");
  await editingLanguage.selectOption("sv");
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveCount(0);
  await catalog.getByRole("textbox", { name: "Swedish title", exact: true }).fill("Svar");
  await catalog.getByRole("textbox", { name: "Swedish definition", exact: true }).fill("Behandlingssvar");
  await catalog.getByRole("button", { name: "Save wording revision" }).click();
  await expect(catalog.getByRole("row", { name: /Response Svar/ })).toBeVisible();
  await editingLanguage.selectOption("en");
  await expect(catalog.getByRole("row", { name: /Response Response English/ })).toBeVisible();

  await catalog.getByRole("button", { name: "Group", exact: true }).click();
  await catalog.getByRole("button", { name: "New group" }).click();
  await catalog.getByRole("textbox", { name: "Group ID" }).fill("Assessment");
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Assessment");
  await editingLanguage.selectOption("sv");
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveCount(0);
  await catalog.getByRole("textbox", { name: "Swedish title", exact: true }).fill("Bedömning");
  await catalog.getByRole("button", { name: "Add group" }).click();
  await expect(catalog.getByRole("textbox", { name: "Assessment Swedish title" })).toHaveValue("Bedömning");
  await expect(catalog.getByRole("row", { name: /Assessment — Bedömning/ })).toBeVisible();
  await editingLanguage.selectOption("en");
  await expect(catalog.getByRole("textbox", { name: "Assessment English title" })).toHaveValue("Assessment");

  await catalog.getByRole("button", { name: "Code List", exact: true }).click();
  await catalog.getByRole("row", { name: /Response — Response English/ }).getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English label for custom-coded https://example.org/response A" })).toHaveValue("Improved");
  await editingLanguage.selectOption("sv");
  await expect(catalog.getByRole("row", { name: /Response — Svar/ })).toBeVisible();
  await expect(catalog.getByRole("textbox", { name: "English label for custom-coded https://example.org/response A" })).toHaveCount(0);
  await catalog.getByRole("textbox", { name: "Swedish label for custom-coded https://example.org/response A" }).fill("Förbättrad");
  await expect(catalog.getByRole("button", { name: "Add value" })).toHaveCount(0);
  await editingLanguage.selectOption("en");
  await expect(catalog.getByRole("textbox", { name: "English label for custom-coded https://example.org/response A" })).toHaveValue("Improved");
  await editingLanguage.selectOption("sv");
  await expect(catalog.getByRole("textbox", { name: "Swedish label for custom-coded https://example.org/response A" })).toHaveValue("Förbättrad");

  await catalog.getByRole("button", { name: "Element", exact: true }).click();
  await catalog.getByRole("row", { name: /ePatient.15/ }).getByRole("button", { name: "View" }).click();
  const fixed = catalog.getByRole("region", { name: "ePatient.15 element editor" });
  await expect(fixed.getByRole("textbox", { name: "English title" })).toHaveCount(0);
  await expect(fixed.getByRole("textbox", { name: "Swedish title" })).toBeDisabled();
  await fixed.getByRole("button", { name: "Close" }).click();
  await catalog.getByRole("row", { name: /ePatient.13/ }).getByRole("button", { name: "View" }).click();
  const codedFixed = catalog.getByRole("region", { name: "ePatient.13 element editor" });
  await expect(codedFixed.getByRole("textbox", { name: "Swedish title" })).toHaveValue("Kön");
  await codedFixed.getByText("Code sources and choices").click();
  await expect(codedFixed.getByText("9906001 — Kvinna").first()).toBeVisible();
  await codedFixed.getByRole("button", { name: "Copy element" }).click();
  await expect(catalog.getByRole("textbox", { name: "Swedish choices" })).toContainText("9906001 | Kvinna");
  await expect(catalog.getByLabel(/Initial choices/)).toHaveCount(0);
});

test("form code policies show NOT labels and save enablement and ordering", async ({ page }) => {
  const form = page.getByRole("region", { name: "Form editor", exact: true });
  await form.getByText("Enabled choices and order", { exact: true }).first().click();
  const choices = form.getByRole("list", { name: "Choices for ePatient.15", exact: true });
  await expect(choices.getByRole("checkbox", { name: "Not Recorded", exact: true })).toBeChecked();
  await choices.getByRole("button", { name: "Move Not Recorded choice up", exact: true }).click();
  await choices.getByRole("checkbox", { name: "One", exact: true }).uncheck();
  const definition = JSON.parse((await page.getByTestId("form").textContent())!);
  expect(definition.sections[0].fields[0].choicePolicy).toEqual([{ kind: "not-value", code: "7701003" }]);
  await form.getByText("Enabled choices and order", { exact: true }).last().click();
  const custom = form.getByRole("list", { name: "Choices for response", exact: true });
  await expect(custom.getByRole("checkbox", { name: "Not Recorded", exact: true })).toBeVisible();
  await expect(form).not.toContainText("NOT 7701003");
});


test("saving a custom element persists its revision across reloads", async ({ page }) => {
  const catalog = page.locator('.catalog-editor');
  await catalog.getByRole("button", { name: "Edit" }).click();
  await catalog.getByRole("textbox", { name: "English title", exact: true }).fill("Draft response");
  await catalog.getByRole("button", { name: "Save wording revision" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('editor-draft')!).revision)).toBe(2);
  await page.getByRole("button", { name: "Switch page" }).click();
  await page.getByRole("button", { name: "Switch page" }).click();
  await catalog.getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveValue("Draft response");
  await page.reload();
  await catalog.getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveValue("Draft response");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await catalog.getByRole("button", { name: "Edit" }).click();
  await expect(catalog.getByRole("textbox", { name: "English title", exact: true })).toHaveValue("Draft response");
});

test("Swedish fixed group names and editable fixed value sets are available", async ({ page }) => {
  const catalog = page.locator(".catalog-editor");
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("sv");
  await catalog.getByRole("button", { name: "Group", exact: true }).click();
  await expect(catalog.getByRole("row", { name: /PatientCareReportGroup — Patientjournal/ })).toBeVisible();
  await catalog.getByRole("button", { name: "Element", exact: true }).click();
  await catalog.getByRole("combobox", { name: "Editing language" }).selectOption("en");
  await catalog.getByRole("row", { name: /ePatient.15/ }).getByRole("button", { name: "View" }).click();
  await catalog.getByRole("region", { name: "ePatient.15 element editor" }).getByText("Code sources and choices").click();
  await catalog.getByRole("button", { name: "Edit values" }).click();
  await catalog.getByRole("textbox", { name: "Code", exact: true }).fill("2");
  await catalog.getByRole("textbox", { name: "Code system", exact: true }).fill("urn:example:local");
  await catalog.getByRole("textbox", { name: "Label", exact: true }).fill("Two");
  await catalog.getByRole("combobox", { name: "Map to NEMSIS code" }).selectOption("1");
  await catalog.getByRole("button", { name: "Add value", exact: true }).click();
  await catalog.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(saved.definition.codeLists[0].values).toContainEqual({ code: "2", codeSystem: "urn:example:local", label: "Two", sourceLabel: "Two", category: null, enabled: true, nemsisCode: "1" });
  await catalog.getByRole("row", { name: /ePatient.13 —/ }).getByRole("button", { name: "Edit" }).click();
  await catalog.getByRole("textbox", { name: "Code", exact: true }).fill("LOCAL-GENDER");
  await catalog.getByRole("textbox", { name: "Code system", exact: true }).fill("urn:example:local");
  await catalog.getByRole("textbox", { name: "Label", exact: true }).fill("Local gender");
  await catalog.getByRole("combobox", { name: "Map to NEMSIS code" }).selectOption("9906001");
  await catalog.getByRole("button", { name: "Add value", exact: true }).click();
  await catalog.getByRole("button", { name: "Save draft", exact: true }).click();
  const withInline = await page.evaluate(() => JSON.parse(localStorage.getItem("editor-draft")!));
  expect(withInline.definition.codeLists[1].values).toContainEqual({ code: "LOCAL-GENDER", codeSystem: "urn:example:local", label: "Local gender",
    sourceLabel: "Local gender", category: null, enabled: true, nemsisCode: "9906001" });
});
