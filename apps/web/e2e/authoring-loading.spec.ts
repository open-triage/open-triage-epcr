import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let script: string;
test.beforeAll(async () => {
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {CatalogAuthoring} from './components/catalog-authoring';
      const element={elementId:'ePatient.25',label:'Sex',description:'Patient sex',identityId:'sex',baseDatatype:'string',
        storageSemantics:{sourceDatatype:'string',groupPath:['ePatient'],analyticalLocation:'wide',sqlType:'text'},
        requirednessSeverity:null,constraints:{minOccurs:0,maxOccurs:1,nillable:true,supportsNotValues:true,supportsPertinentNegatives:false}};
      const catalog={id:'release',displayName:'Current catalog',version:'1',status:'active',definition:{schemaVersion:1,
        sourceReleaseId:'release',elements:[element],codeLists:[]}};
      window.requests=[];
      window.fetch=async (url)=>{
        const endpoint=String(url).split('/api/admin/')[1]; window.requests.push(endpoint);
        if(endpoint==='catalog-draft') return new Response(null,{status:204});
        if(endpoint==='catalog-versions') return Response.json([
          {id:'release',displayName:'Current catalog',version:'1',status:'active'},
          {id:'older',displayName:'Older catalog',version:'0',status:'published'}]);
        return Response.json(endpoint==='catalog-versions/older' ? {...catalog,id:'older',displayName:'Older catalog',
          definition:{...catalog.definition,elements:[{...element,label:'Older label'}]}} : catalog);
      };
      function Harness(){return <CatalogAuthoring csrfToken="proof" capabilities={['catalog:read','catalog:write']} language="en"/>;}
      createRoot(document.getElementById('root')).render(<Harness/>);`
    } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/__authoring-loading-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__authoring-loading", route => route.fulfill({ contentType: "text/html",
    body: '<html lang="en"><body><div id="root"></div><script src="/__authoring-loading-script"></script></body></html>' }));
  await page.goto("/__authoring-loading");
});

test("opening a catalog loads its active definition once and still allows switching versions", async ({ page }) => {
  const elementRow = page.getByRole("row", { name: /ePatient\.25/ });
  await expect(elementRow).toContainText("Sex");
  const versions = page.locator('.authoring-version-workspace select').first();
  await versions.selectOption('older');
  await expect(elementRow).toContainText("Older label");
  const requests = await page.evaluate(() => (window as unknown as { requests: string[] }).requests);
  expect(requests.filter(path => path === 'catalog-definition')).toHaveLength(1);
  expect(requests).not.toContain('catalog-versions/release');
  await versions.selectOption('release');
  await expect(elementRow).toContainText("Sex");
});
