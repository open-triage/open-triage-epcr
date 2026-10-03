import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

let script: string;
let css: string;
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser",
    define: { "process.env": "{}" }, stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminLanguageContext} from './app/admin-localization';
      import {CatalogAuthoring} from './components/catalog-authoring';
      import {StationaryFormAuthoring} from './components/stationary-form-authoring';
      import {ValidationAuthoring} from './components/validation-authoring';
      const params=new URLSearchParams(location.search);const kind=params.get('kind');
      const prefix=kind==='form'?'forms':kind;
      const props={csrfToken:'fixture',language:'en',catalogReleaseId:'catalog',
        capabilities:[prefix+':read',...(params.has('readonly')?[]:[prefix+':write',prefix+':publish'])]};
      createRoot(document.getElementById('root')).render(<AdminLanguageContext.Provider value="en">
        {kind==='catalog'?<CatalogAuthoring {...props}/>:kind==='form'?<StationaryFormAuthoring {...props}/>:<ValidationAuthoring {...props}/>}
      </AdminLanguageContext.Provider>);`
    } });
  script = result.outputFiles[0]!.text;
});

for (const kind of ["catalog", "form", "validation"]) {
  test(`${kind} requires explicit file selection and import; errors retain selection`, async ({ page }, testInfo) => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    let imported = false;
    let failImport = true;
    const folder = kind === "form" ? "forms" : kind;
    const selectedFile = `${folder}/selected.json`;
    page.on("pageerror", (error) => { throw error; });
    await page.route("**/__import-script", (route) => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__import-harness?**", (route) => route.fulfill({ contentType: "text/html", body:
      `<html lang="en"><head><style>${css}</style></head><body style="--green:#653ab5;--green-dark:#472780;--inactive-button:#f3eefc;--text-color:#24183a"><main style="padding:12px"><div id="root"></div></main><script src="/__import-script"></script></body></html>` }));
    await page.route("**/api/admin/**", (route) => {
      const request = route.request();
      const requestPath = new URL(request.url()).pathname.replace("/api/admin/", "");
      requests.push({ path: requestPath, method: request.method(), body: request.postData() ? request.postDataJSON() : undefined });
      if (requestPath === `canonical/${kind}`) return route.fulfill({ json: [
        { file: `${folder}/broken.json`, compatible: false, error: "Invalid JSON" },
        { file: selectedFile, compatible: true }, { file: `${folder}/other.json`, compatible: true }
      ] });
      if (requestPath === `canonical/${kind}/import-file`) {
        if (failImport) return route.fulfill({ status: 409, json: { message: "Publish or discard the existing draft before importing" } });
        imported = true;
        return route.fulfill({ json: { id: "imported" } });
      }
      if (requestPath.endsWith("-draft") || requestPath === "catalog-definition") return route.fulfill({ json: null });
      if (requestPath.endsWith("-versions")) return route.fulfill({ json: imported && requestPath === `${kind}-versions`
        ? [{ id: "imported", displayName: "Imported agency definition", version: 2, status: "published", catalogReleaseId: "catalog" }] : [] });
      if (requestPath === "catalog-versions/imported") return route.fulfill({ json: {
        id: "imported", displayName: "Imported agency definition", version: "2", status: "published",
        definition: { schemaVersion: 1, elements: [], codeLists: [], customElements: [], customGroups: [] }
      } });
      return route.fulfill({ status: 404, body: requestPath });
    });
    await page.goto(`/__import-harness?kind=${kind}`);
    await expect(page.getByRole("button", { name: "Import from defines" })).toHaveCount(0);
    await expect(page.getByText("File version numbers are ignored.", { exact: false })).toHaveCount(0);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    const file = page.getByLabel("JSON file", { exact: true });
    await expect(file).toHaveValue(selectedFile);
    const submit = page.getByRole("button", { name: "Import selected file" });
    await file.selectOption(`${folder}/broken.json`);
    await expect(submit).toBeDisabled();
    await file.selectOption(selectedFile);
    expect(requests.every(({ method }) => method === "GET")).toBe(true);
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("request failed");
    await expect(file).toHaveValue(selectedFile);
    failImport = false;
    await submit.click();
    await expect(page.getByLabel("Version", { exact: true })).toHaveValue("imported");
    await expect(page.getByRole("status").filter({ hasText: "Definition imported" })).toBeVisible();
    expect(requests.filter(({ method }) => method !== "GET")).toEqual([
      { path: `canonical/${kind}/import-file`, method: "POST", body: { file: selectedFile, ...(kind === "catalog" ? {} : { catalogReleaseId: "catalog" }) } },
      { path: `canonical/${kind}/import-file`, method: "POST", body: { file: selectedFile, ...(kind === "catalog" ? {} : { catalogReleaseId: "catalog" }) } }
    ]);
    await page.mouse.move(0, 0);
    await submit.evaluate(button => button.blur());
    expect(await submit.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe("rgb(101, 58, 181)");
    expect(await submit.evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${kind}-import.png`), fullPage: true });
    await page.goto(`/__import-harness?kind=${kind}&readonly`);
    await expect(page.getByLabel("Version", { exact: true })).toBeVisible();
    await expect(page.getByLabel("JSON file", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import selected file" })).toHaveCount(0);
  });
}
