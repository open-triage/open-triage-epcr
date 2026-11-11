import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

test("Back respects modal capture, async boundaries and unmounted identity scopes", async ({ page }) => {
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {handleAndroidBack} from './app/android-navigation';import {useAndroidBack} from './components/use-android-back';
      window.closedCount=0;window.backgrounds=0;window.scopes=[];window.back=()=>handleAndroidBack(async()=>{window.backgrounds++});
      function Scope({id}){useAndroidBack(async()=>{window.scopes.push(id);await new Promise(resolve=>window.finish=resolve);window.closedCount++;return true},10);return <p>{id}</p>}
      function App(){const[scope,setScope]=useState('first'),[modal,setModal]=useState(false),[interrupted,setInterrupted]=useState(false);
        return <><Scope key={scope} id={scope}/><button onClick={()=>setScope('second')}>Change user scope</button><button onClick={()=>setModal(true)}>Open recorder</button>
        {modal&&<section role="dialog" aria-modal="true" aria-label="Recorder" onKeyDownCapture={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setInterrupted(true)}}}>
        <button>Capture</button><p>{interrupted?'Choose Use or Cancel':'Recording'}</p><button onClick={()=>setModal(false)}>Cancel</button></section>}</>}
      createRoot(document.getElementById('root')).render(<App/>);` } });
  await page.route("**/__navigation", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  await page.goto("/__navigation");
  await page.getByRole("button", { name: "Open recorder" }).click();
  await page.evaluate(() => (window as any).back());
  await expect(page.getByText("Choose Use or Cancel")).toBeVisible();
  expect(await page.evaluate(() => (window as any).scopes)).toEqual([]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Change user scope" }).click();
  await page.evaluate(() => { void (window as any).back(); void (window as any).back(); });
  await expect.poll(() => page.evaluate(() => (window as any).scopes)).toEqual(["second"]);
  expect(await page.evaluate(() => (window as any).closedCount)).toBe(0);
  expect(await page.evaluate(() => (window as any).backgrounds)).toBe(0);
  await page.evaluate(() => (window as any).finish());
  await expect.poll(() => page.evaluate(() => (window as any).closedCount)).toBe(1);
});
