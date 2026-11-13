import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

for (const native of [false, true]) test(`${native ? "Android" : "browser"} shares server UI updates, defers reload during work and retains the offline shell`, async ({ page }) => {
  const bundled = await build({ bundle: true, write: false, jsx: "automatic", format: "iife", platform: "browser",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production" }), "process.env.NODE_ENV": JSON.stringify("production"), "process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION": JSON.stringify("false") },
    plugins: [{ name: "native-platform", setup(builder) {
      builder.onResolve({ filter: /android-runtime$/ }, () => ({ path: "native-platform", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export const isAndroidRuntime=()=>${native}; export const nativeUiOrigin=()=>"https://paired.example"; export const NATIVE_UI_SOURCE_EVENT="source";` }));
    } }], stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {ServiceWorkerRegistration} from './components/service-worker-registration';
      import {blockUiUpdates} from './app/ui-update-boundary';
      let release; function App(){return <><button onClick={()=>{release=blockUiUpdates()}}>Start work</button><button onClick={()=>release?.()}>Finish work</button>
        <button onClick={()=>navigator.serviceWorker.getRegistration().then(value=>value?.update())}>Check update</button><ServiceWorkerRegistration/></>}
      createRoot(document.getElementById('root')).render(<App/>);
    ` } });
  const workers = new Map<number, string>();
  for (const version of [1, 2, 3, 4]) {
    const result = await build({ entryPoints: [path.resolve(__dirname, "../service-worker/service-worker.ts")], bundle: true, write: false, format: "iife",
      define: { __OPEN_TRIAGE_BUILD_SHA__: JSON.stringify(`ui-test-${version}`) } }); workers.set(version, result.outputFiles[0]!.text);
  }
  await page.addInitScript(() => {
    (window as unknown as { controllerChanges: number }).controllerChanges = 0;
    navigator.serviceWorker.addEventListener("controllerchange", () => { (window as unknown as { controllerChanges: number }).controllerChanges++; });
  });
  let version = 1, available = true, failShell = false, failedShellRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!available) { response.writeHead(503).end("Offline fixture"); return; }
    const pathname = new URL(request.url!, "http://localhost").pathname;
    if (failShell && pathname === "/") { failedShellRequests++; response.writeHead(503).end("Shell unavailable"); return; }
    if (pathname === "/sw.js") { response.setHeader("Content-Type", "text/javascript"); response.end(workers.get(version)); }
    else if (pathname === "/_next/static/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundled.outputFiles[0]!.text); }
    else if (pathname === "/manifest.webmanifest") { response.setHeader("Content-Type", "application/manifest+json"); response.end('{"name":"UI fixture"}'); }
    else if (pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(`<html><head><script defer src="/_next/static/app.js"></script></head><body><h1>Server UI ${version}</h1><div id="root"></div></body></html>`); }
    else response.writeHead(404).end();
  }).listen(0, "127.0.0.1");
  await once(server, "listening"); const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing fixture server");
  try {
    const origin = `http://127.0.0.1:${address.port}`; await page.goto(origin);
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.getByRole("heading", { name: "Server UI 1" })).toBeVisible();
    const changes = await page.evaluate(() => (window as unknown as { controllerChanges: number }).controllerChanges);
    await page.getByRole("button", { name: "Start work" }).click(); version = 2;
    await page.getByRole("button", { name: "Check update" }).click();
    await expect.poll(() => page.evaluate(() => caches.keys())).toContain("open-triage-shell-v5-ui-test-2");
    await expect.poll(() => page.evaluate(() => (window as unknown as { controllerChanges: number }).controllerChanges)).toBeGreaterThan(changes);
    await expect(page.getByRole("heading", { name: "Server UI 1" })).toBeVisible();
    version = 3; await page.getByRole("button", { name: "Check update" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { controllerChanges: number }).controllerChanges)).toBeGreaterThan(changes + 1);
    await expect(page.getByRole("heading", { name: "Server UI 1" })).toBeVisible();
    expect(await page.evaluate(() => caches.keys())).toContain("open-triage-shell-v5-ui-test-1");
    await page.getByRole("button", { name: "Finish work" }).click();
    await expect(page.getByRole("heading", { name: "Server UI 3" })).toBeVisible(); expect(new URL(page.url()).origin).toBe(origin);
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || registration.installing || registration.waiting || registration.active?.state !== "activated" || registration.active !== navigator.serviceWorker.controller) return false;
      const cache = await caches.open("open-triage-shell-v5-ui-test-3"), root = await cache.match(location.origin + "/");
      return Boolean(root && (await root.text()).includes("Server UI 3"));
    })).toBe(true);
    available = false; await page.reload();
    await expect(page.getByRole("heading", { name: "Server UI 3" })).toBeVisible();
    // A failed worker update must leave the installed shell usable.
    available = true; version = 4; failShell = true;
    await page.getByRole("button", { name: "Check update" }).click();
    await expect.poll(() => failedShellRequests).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("open-triage-shell-v5-ui-test-4");
    available = false; await page.reload(); await expect(page.getByRole("heading", { name: "Server UI 3" })).toBeVisible();
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

for (const language of ["en", "sv"]) test(`native bootstrap shows a compact offline connection screen and retries (${language})`, async ({ page }, testInfo) => {
  const css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {NativeUiLoading} from './components/native-ui-loading';
      import {UI_UPDATE_CHECK_EVENT} from './app/ui-update-boundary';
      window.checks=0; window.addEventListener(UI_UPDATE_CHECK_EVENT,()=>window.checks++);
      createRoot(document.getElementById('root')).render(<NativeUiLoading/>);
    ` } });
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { value: false }));
  await page.route("**/__bootstrap.js", route => route.fulfill({ contentType: "text/javascript", body: result.outputFiles[0]!.text }));
  await page.route("**/__bootstrap", route => route.fulfill({ contentType: "text/html", body: `<html lang="${language}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}:root{--green:#562d96;--green-dark:#3d196e}</style></head><body><div id="root"></div><script src="/__bootstrap.js"></script></body></html>` }));
  await page.goto("/__bootstrap");
  await expect(page.getByRole("heading")).toHaveText(language === "sv" ? "Laddar applikationen" : "Loading application");
  await expect(page.getByRole("status")).toHaveText(language === "sv" ? "Anslut till servern för att ladda applikationen." : "Connect to the server to load the application.");
  const retry = page.getByRole("button", { name: language === "sv" ? "Försök igen" : "Retry" });
  for (const width of [360, 1200]) {
    await page.setViewportSize({ width, height: 640 });
    await retry.scrollIntoViewIfNeeded(); await expect(retry).toBeInViewport();
    expect(await retry.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`bootstrap-${language}-${width}.png`) });
  }
  expect((await new AxeBuilder({ page }).include(".native-ui-loading").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations
    .filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual([]);
  await retry.click();
  expect(await page.evaluate(() => (window as unknown as { checks: number }).checks)).toBe(1);
  await expect(page.getByRole("status")).toHaveAttribute("aria-busy", "true");
});
