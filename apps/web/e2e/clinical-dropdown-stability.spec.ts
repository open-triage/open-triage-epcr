import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ page }) => {
  const css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ClinicalSearchableSelect} from './components/clinical-searchable-select';
      const options=Array.from({length:40},(_,i)=>({key:String(i),label:'Clinical option '+(i+1)}));
      function App(){const[revision,refresh]=useState(0),[values,setValues]=useState([]);
        window.refreshPicker=()=>refresh(value=>value+1);
        return <><div style={{height:120}}/><main data-testid="scroller" style={{height:400,overflow:'auto'}}>
          <div style={{height:160}}/><ClinicalSearchableSelect label="Clinical field" values={values}
            options={options} onOpenChange={()=>{}} onChange={key=>setValues(current=>current.includes(key)?current.filter(value=>value!==key):[...current,key])}/>
          <div style={{height:900}}/><output>{revision}</output></main><div style={{height:800}}/></>}
      createRoot(document.getElementById('root')).render(<App/>);` } });
  await page.addInitScript(() => {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function(options) {
      if (this.matches(".clinical-searchable-popup input")) {
        this.dataset.focusCalls = String(Number(this.dataset.focusCalls ?? 0) + 1);
      }
      focus.call(this, options);
    };
  });
  await page.route("**/__dropdown.js", route => route.fulfill({ contentType: "text/javascript", body: result.outputFiles[0]!.text }));
  await page.route("**/__dropdown", route => route.fulfill({ contentType: "text/html", body: `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__dropdown.js"></script></body></html>` }));
  await page.goto("/__dropdown");
});

test("touch opening and multi-selection do not summon the keyboard or move the page", async ({ page }, testInfo) => {
  const trigger = page.getByRole("button", { name: "Clinical field", exact: true });
  await trigger.tap();
  const popup = page.locator(".clinical-searchable-popup"), search = page.getByRole("combobox");
  await expect(popup).toBeVisible();
  await expect(search).not.toBeFocused();
  const before = await page.evaluate(() => ({ page: scrollY, panel: document.querySelector('[data-testid="scroller"]')!.scrollTop }));
  await page.getByRole("option", { name: "Clinical option 2", exact: true }).tap();
  await expect(trigger).toHaveText("Clinical option 2");
  await expect(search).not.toBeFocused();
  expect(await page.evaluate(() => ({ page: scrollY, panel: document.querySelector('[data-testid="scroller"]')!.scrollTop }))).toEqual(before);
  const position = await popup.boundingBox();
  await page.getByRole("listbox").evaluate(element => { element.scrollTop = 300; });
  await expect.poll(() => page.getByRole("listbox").evaluate(element => element.scrollTop)).toBe(300);
  expect((await popup.boundingBox())!.y).toBe(position!.y);
  await expect(search).not.toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("touch-dropdown.png") });
  await search.tap();
  await expect(search).toBeFocused();
  await search.fill("option 40");
  await expect(page.getByRole("option")).toHaveText(["Clinical option 40"]);
});

test("scroll, resize and parent refresh preserve focus and follow the trigger", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Clinical field", exact: true });
  await trigger.click();
  const search = page.getByRole("combobox"), popup = page.locator(".clinical-searchable-popup");
  await expect(search).toBeFocused();
  const focusCalls = await search.getAttribute("data-focus-calls");
  const option = page.getByRole("option", { name: "Clinical option 2", exact: true });
  await option.focus();
  const before = (await popup.boundingBox())!;
  await page.getByTestId("scroller").evaluate(element => { element.scrollTop += 30; });
  await expect.poll(async () => (await popup.boundingBox())!.y).toBeCloseTo(before.y - 30, 0);
  await page.setViewportSize({ width: 360, height: 600 });
  await page.evaluate(() => (window as unknown as { refreshPicker(): void }).refreshPicker());
  await expect(page.locator("output")).toHaveText("1");
  await expect(option).toBeFocused();
  expect(await search.getAttribute("data-focus-calls")).toBe(focusCalls);
});

test("keyboard navigation scrolls only the result list and returns focus without scrolling", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Clinical field", exact: true });
  await trigger.focus(); await trigger.press("Enter");
  const search = page.getByRole("combobox");
  await expect(search).toBeFocused();
  const before = await page.evaluate(() => ({ page: scrollY, panel: document.querySelector('[data-testid="scroller"]')!.scrollTop }));
  await page.setViewportSize({ width: 360, height: 360 });
  await expect(search).toBeInViewport();
  await expect(search).toBeFocused();
  await search.press("End");
  await expect(page.getByRole("option").last()).toBeInViewport();
  expect(await page.getByRole("listbox").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await search.press("Escape");
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => ({ page: scrollY, panel: document.querySelector('[data-testid="scroller"]')!.scrollTop }))).toEqual(before);
});

test("mouse opening keeps the first choice under the original pointer", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Clinical field", exact: true });
  const bounds = (await trigger.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.click(x, y);
  await expect(page.getByRole("combobox")).toBeFocused();
  await expect(trigger).toHaveText("Choose a value");
  await page.mouse.click(x, y);
  await expect(trigger).toHaveText("Clinical option 1");
});
