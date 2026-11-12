import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

async function harness(page: Page, { deferred = false, bytes = 32, language = "en", protectedAudio = false } = {}) {
  const bundled = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {Capacitor} from '@capacitor/core';
      import {AudioNoteDialog,AuthorizedAudioButton,cancelActiveAudioCapture} from './components/audio-note';
      import {setNativeForeground} from './app/application-foreground';
      import {prepareProtectedReport,protectedAudioPreview,protectedStorageActive,startProtectedAudioPreview,stageProtectedAudioChunk,finishProtectedAudioPreview,updateProtectedAudioPreview,removeProtectedAudioPreview,applyProtectedAuthorityResponse} from './app/protected-clinical-storage';
      Capacitor.isNativePlatform=()=>true;Capacitor.getPlatform=()=>'android';
      window.starts=0;window.stops=0;window.requests=0;window.tracksStopped=0;window.plays=0;window.pauses=0;window.saved=0;
      window.denied=false;window.deferred=${deferred};
      function stream(){const context=new AudioContext();const source=context.createOscillator();const destination=context.createMediaStreamDestination();source.connect(destination);source.start();window.captureTracks=destination.stream.getTracks();for(const track of destination.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.tracksStopped++;stop();source.stop();context.close()}}return destination.stream}
      navigator.mediaDevices.getUserMedia=()=>{window.requests++;if(window.denied)return Promise.reject(new DOMException('denied','NotAllowedError'));if(window.deferred)return new Promise(resolve=>window.resolvePermission=()=>resolve(stream()));return Promise.resolve(stream())};
      class Recorder extends EventTarget{static isTypeSupported(type){return type.startsWith('audio/webm')};state='inactive';constructor(stream){super();this.stream=stream}start(){this.state='recording';window.starts++}stop(){if(this.state!=='recording')return;this.state='inactive';window.stops++;this.dispatchEvent(new BlobEvent('dataavailable',{data:new Blob([new Uint8Array(${bytes})],{type:'audio/webm'})}));this.dispatchEvent(new Event('stop'))}}
      window.MediaRecorder=Recorder;
      HTMLMediaElement.prototype.play=function(){window.plays++;return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){window.pauses++};
      function App(){const[open,setOpen]=React.useState(true);return <>
        <button onClick={()=>setNativeForeground(false)}>Pause native</button><button onClick={()=>setNativeForeground(true)}>Resume native</button>
        <button onClick={()=>setOpen(true)}>Open recorder</button><button onClick={()=>{void cancelActiveAudioCapture().then(done=>{if(done)setOpen(false)})}}>Close recorder</button>
        <AuthorizedAudioButton reportId="synthetic" noteId="note" label="Play saved note"/>
        {open&&<AudioNoteDialog language=${JSON.stringify(language)} dialogRef={{current:null}} reportId="synthetic" note={null} csrfToken="synthetic" revision={1}
          mediaPolicy={{settingsRevision:1,reportMediaAllowanceBytes:104857600,imageMediaLimitBytes:10485760}} author={{id:'synthetic',displayName:'Synthetic'}}
          onClose={()=>{void cancelActiveAudioCapture().then(done=>{if(done)setOpen(false)})}} onSaved={()=>window.saved++} onQueued={()=>window.saved++} onDeleted={()=>{}} onSessionEnded={()=>{}}/>}</>}
      window.previewExists=()=>Boolean(protectedAudioPreview('synthetic'));
      window.previewOperations={start:startProtectedAudioPreview,chunk:stageProtectedAudioChunk,finish:finishProtectedAudioPreview,update:updateProtectedAudioPreview,remove:removeProtectedAudioPreview,current:protectedAudioPreview,deny:()=>applyProtectedAuthorityResponse('synthetic',{status:401})};
      window.protectedActive=()=>protectedStorageActive('synthetic');
      async function mount(){if(${protectedAudio})await prepareProtectedReport('synthetic','synthetic');createRoot(document.getElementById('root')).render(<App/>)}void mount();` } });
  await page.route("**/__audio-lifecycle", route => route.fulfill({ contentType: "text/html", body: `<html><body><div id="root"></div><script>${bundled.outputFiles[0]!.text}</script></body></html>` }));
  await page.route('**/api/reports/synthetic/protected-key-envelope', route => route.fulfill({json:{schemaVersion:1,recoveryHandle:route.request().postDataJSON().recoveryHandle,recoveryDeadline:'2099-01-01T00:00:00Z',wrappingKeyVersion:1}}));
  await page.route('**/api/reports/synthetic/protected-ciphertext-receipt', route => route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}}));
  await page.route('**/api/reports/synthetic/protected-ciphertext-checkpoint', route => route.fulfill({json:route.request().postDataJSON()}));
  await page.goto("/__audio-lifecycle");
}

async function hold(page: Page) {
  const button = page.getByRole("button", { name: "Hold to record", exact: true });
  await button.focus(); await page.keyboard.down("Space");
}

test("native pause stops microphone tracks immediately and requires an explicit interrupted preview choice", async ({ page }) => {
  await harness(page);
  await hold(page);
  await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Pause native", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).tracksStopped)).toBeGreaterThan(0);
  await expect(page.getByText(/Recording interrupted/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).stops)).toBe(1);
  expect(await page.evaluate(() => (window as any).saved)).toBe(0);
  await page.keyboard.up("Space");
  await page.getByRole("button", { name: "Resume native", exact: true }).click();
  expect(await page.evaluate(() => (window as any).starts)).toBe(1);
  await expect(page.getByRole("button", { name: "Use interrupted recording" })).toBeVisible();
});

for (const interruption of ["cancel", "pause"] as const) test(`late microphone permission after ${interruption} cannot start or retain a hidden recorder`, async ({ page }) => {
  await harness(page, { deferred: true });
  await hold(page);
  await expect.poll(() => page.evaluate(() => (window as any).requests)).toBe(1);
  await page.getByRole("button", { name: interruption === "cancel" ? "Close recorder" : "Pause native", exact: true }).click();
  await page.evaluate(() => (window as any).resolvePermission());
  await expect.poll(() => page.evaluate(() => (window as any).tracksStopped)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).starts)).toBe(0);
  expect(await page.evaluate(() => (window as any).saved)).toBe(0);
  await page.keyboard.up("Space");
  if (interruption === "cancel") await expect(page.getByRole("dialog")).toHaveCount(0);
  else {
    await page.getByRole("button", { name: "Resume native", exact: true }).click();
    expect(await page.evaluate(() => (window as any).requests)).toBe(1);
    await expect(page.getByRole("button", { name: "Hold to record", exact: true })).toBeVisible();
  }
});

for (const language of ["en", "sv"]) test(`native microphone denial uses app settings and does not reprompt on resume in ${language}`, async ({ page }, testInfo) => {
  await harness(page, { language });
  await page.evaluate(() => { (window as any).denied = true; });
  await page.getByRole("button", { name: language === "en" ? "Hold to record" : "Håll intryckt för att spela in", exact: true }).focus();
  await page.keyboard.down("Space");
  await expect(page.getByRole("alert")).toContainText(language === "en" ? "Android app settings" : "Android-appens inställningar");
  await page.keyboard.up("Space");
  const styles = await page.addStyleTag({ path: path.resolve(__dirname, '../app/styles.css') });
  await page.screenshot({ path: testInfo.outputPath(`native-microphone-${language}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const accessibility = await new AxeBuilder({page}).include('.audio-note-dialog').analyze();
  expect(accessibility.violations.filter(({impact}) => impact === 'serious' || impact === 'critical')).toEqual([]);
  await styles.evaluate(element => element.parentNode?.removeChild(element));
  await page.getByRole("button", { name: "Pause native", exact: true }).click();
  await page.getByRole("button", { name: "Resume native", exact: true }).click();
  expect(await page.evaluate(() => (window as any).requests)).toBe(1);
});

test("an oversized recording remains an unsaved preview and is never staged or uploaded", async ({ page }) => {
  await harness(page, { bytes: 13 * 1024 * 1024 });
  let uploads = 0;
  await page.route("**/api/reports/synthetic/audio", route => { uploads++; return route.fulfill({ status: 500 }); });
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.waitForTimeout(300); await page.keyboard.up("Space");
  await page.getByRole("button", { name: "Use recording", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("too large to transfer");
  await expect(page.getByRole("button", { name: "Use recording", exact: true })).toBeVisible();
  expect(uploads).toBe(0); expect(await page.evaluate(() => (window as any).saved)).toBe(0);
});

test("a playback response arriving after native pause cannot start audio", async ({ page }) => {
  await harness(page);
  let release!: () => void, requested = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/reports/synthetic/audio/note/content", async route => {
    requested = true; await gate;
    return route.fulfill({ contentType: "audio/mp4", body: Buffer.from([0, 255, 128, 0]) });
  });
  await page.getByRole("button", { name: "Play saved note", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  const response = page.waitForResponse(value => value.url().endsWith('/api/reports/synthetic/audio/note/content'));
  await page.getByRole("button", { name: "Pause native", exact: true }).click(); release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect(page.getByRole("button", { name: "Play saved note", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).plays)).toBe(0);
});


test("explicit Cancel removes the encrypted unsaved preview and reopening cannot resurrect it", async ({ page }) => {
  await harness(page, { protectedAudio: true });
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  expect(await page.evaluate(() => (window as any).protectedActive())).toBe(true);
  await page.waitForTimeout(300); await page.keyboard.up("Space");
  await expect(page.getByRole("button", { name: "Use recording", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).previewExists())).toBe(true);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).previewExists())).toBe(false);
  await page.getByRole("button", { name: "Open recorder", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hold to record", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use recording", exact: true })).toHaveCount(0);
});


test("old recording callbacks cannot mutate or delete a new encrypted preview, including under a frozen timestamp", async ({ page }) => {
  await harness(page, { protectedAudio: true });
  await expect(page.getByRole("button", { name: "Hold to record", exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const api = (window as any).previewOperations;
    const capturedAt = "2026-11-11T10:00:00.000Z";
    const old = {captureId:crypto.randomUUID(),capturedAt}, current = {captureId:crypto.randomUUID(),capturedAt};
    const preview = {recorderContentType:"audio/webm;codecs=opus",sourceContentType:"audio/webm",capturedUtcOffsetMinutes:0,durationMilliseconds:0,caption:"new",interrupted:false,complete:false};
    await api.start("synthetic", {...preview,...old}); await api.start("synthetic", {...preview,...current});
    await api.chunk("synthetic", {sequence:0,sourceBase64:"AQID"}, 1000, old);
    await api.finish("synthetic", {durationMilliseconds:1000,interrupted:true,complete:true}, old);
    api.update("synthetic", {caption:"stale"}, old); await api.remove("synthetic", old);
    const retained = api.current("synthetic");
    await api.remove("synthetic", {capturedAt});
    const rejectsLegacyAgainstNew = Boolean(api.current("synthetic"));
    await api.chunk("synthetic", {sequence:0,sourceBase64:"AQID"}, 1000, current);
    const validChunkCount = api.current("synthetic").chunks.length;
    await api.start("synthetic", {...preview,capturedAt});
    await api.remove("synthetic", {capturedAt});
    return {retained,rejectsLegacyAgainstNew,validChunkCount,legacyRemoved:!api.current("synthetic")};
  });
  expect(result.retained.caption).toBe("new"); expect(result.retained.chunks).toEqual([]);
  expect(result.retained.complete).toBe(false); expect(result.rejectsLegacyAgainstNew).toBe(true);
  expect(result.validChunkCount).toBe(1); expect(result.legacyRemoved).toBe(true);
});


test("Cancel waits for durable discard while a chunk receipt is held, then a new recorder starts with a fresh identity", async ({ page }) => {
  await harness(page, { protectedAudio: true });
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  const oldId = await page.evaluate(() => (window as any).previewOperations.current('synthetic').captureId);
  let release!: () => void, held = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/reports/synthetic/protected-ciphertext-receipt', async route => {
    if (!held) { held = true; await gate; }
    return route.fulfill({json:{schemaVersion:1,recoveryDeadline:'2099-01-01T00:00:00Z'}});
  });
  await page.waitForTimeout(300); await page.keyboard.up("Space");
  await expect.poll(() => held).toBe(true);
  await page.getByRole("button", { name: "Close recorder", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  release(); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Open recorder", exact: true }).click();
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(2);
  const current = await page.evaluate(() => (window as any).previewOperations.current('synthetic'));
  expect(current.captureId).not.toBe(oldId); expect(current.chunks).toEqual([]);
  await page.waitForTimeout(300); await page.keyboard.up("Space");
  await expect(page.getByRole("button", { name: "Use recording", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("withdrawn protected authority stops an active microphone immediately", async ({ page }) => {
  await harness(page, { protectedAudio: true });
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.evaluate(() => (window as any).previewOperations.deny());
  await expect.poll(() => page.evaluate(() => (window as any).stops)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).tracksStopped)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).protectedActive())).toBe(false);
  await page.keyboard.up("Space");
});


test("a revoked microphone track stops recording and leaves an explicit interrupted preview", async ({ page }) => {
  await harness(page);
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).captureTracks[0].dispatchEvent(new Event('ended')));
  await expect.poll(() => page.evaluate(() => (window as any).stops)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).tracksStopped)).toBeGreaterThan(0);
  await expect(page.getByText(/Recording interrupted/)).toBeVisible();
  expect(await page.evaluate(() => (window as any).saved)).toBe(0);
  await page.keyboard.up("Space");
});


test("an audio upload already started before pause settles once instead of leaving an ambiguous retry preview", async ({ page }) => {
  await harness(page);
  let release!: () => void, requests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/reports/synthetic/audio', async route => {
    requests++; await gate;
    return route.fulfill({json:{reportId:'synthetic',revision:2,note:{id:'note',type:'audio',persistenceState:'ready'}}});
  });
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.waitForTimeout(300); await page.keyboard.up("Space");
  await page.getByRole("button", { name: "Use recording", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await page.getByRole("button", { name: "Pause native", exact: true }).click(); release();
  await expect.poll(() => page.evaluate(() => (window as any).saved)).toBe(1);
  await page.getByRole("button", { name: "Resume native", exact: true }).click();
  expect(requests).toBe(1);
});


test("wall-clock rollback cannot extend the five-minute recorder or reverse its elapsed display", async ({ page }) => {
  const now = new Date('2026-11-11T10:00:00Z');
  await page.clock.install({ time: now });
  await harness(page);
  await hold(page); await expect.poll(() => page.evaluate(() => (window as any).starts)).toBe(1);
  await page.clock.runFor(1000);
  await page.clock.setSystemTime(new Date(now.getTime() - 3_600_000));
  await page.clock.runFor(1000);
  await expect(page.locator('.audio-timer')).not.toHaveText(/0:00/);
  await page.clock.fastForward(300_000);
  await expect.poll(() => page.evaluate(() => (window as any).stops)).toBe(1);
  await expect(page.getByRole('button', { name: 'Use recording', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).tracksStopped)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).saved)).toBe(0);
  await page.keyboard.up('Space');
});
