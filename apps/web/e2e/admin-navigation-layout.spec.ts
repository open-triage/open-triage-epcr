import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveMessage } from "../app/localization";

let script: string;
let css: string;
const panelKeys = ["dashboard", "users", "roles", "catalog", "forms", "validation", "settings", "review-settings"];
const labelKeys = ["dashboard", "users", "roles", "catalog", "form", "validation", "settings", "reviewSettings"];
const session = { user: { id: "owner", displayName: "Owner" },
  organization: { id: "organization", name: "Example EMS" }, startedAt: "2026-10-03T10:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z", capabilities: ["admin-dashboard:read"] };

test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, jsx: "automatic", format: "iife", platform: "browser",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:3108" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminShell} from './components/admin-shell';
      const language = new URLSearchParams(location.search).get('language');
      createRoot(document.getElementById('root')).render(<div className="admin-shell">
        <AdminShell session={${JSON.stringify(session)}} language={language}/>
      </div>);
    ` } });
  script = result.outputFiles[0]!.text;
});

for (const language of ["en", "sv"] as const) {
  test(`${language} admin navigation labels fit on desktop, mobile, and with enlarged text`, async ({ page }, testInfo) => {
    page.on("pageerror", error => { throw error; });
    await page.route("**/__admin-navigation-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
    await page.route("**/__admin-navigation?*", route => route.fulfill({ contentType: "text/html",
      body: `<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/__admin-navigation-script"></script></body></html>` }));
    await page.route("**/api/admin/context", route => route.fulfill({ json: {
      organization: session.organization, panels: panelKeys, capabilities: session.capabilities,
      activeConfiguration: null, dashboard: null,
    } }));
    await page.goto(`/__admin-navigation?language=${language}`);
    const navigation = page.locator(".admin-tabs");
    const buttons = navigation.getByRole("button");
    await expect(buttons).toHaveText(labelKeys.map(key => resolveMessage(language, `navigation.${key}`)));
    let normalSidebarWidth = 0;
    for (const fontSize of [16, 32]) {
      await buttons.evaluateAll((elements, size) => elements.forEach(element => { element.style.fontSize = `${size}px`; }), fontSize);
      for (const width of [320, 390, 640, 1024, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const clippedLabels = await navigation.evaluate(element => {
          const navigationBox = element.getBoundingClientRect();
          return [...element.querySelectorAll("button")].filter(button => {
            const box = button.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(button);
            return box.height < 44 || box.left < navigationBox.left || box.right > navigationBox.right
              || [...range.getClientRects()].some(rect => rect.left < box.left || rect.right > box.right
                || rect.top < box.top || rect.bottom > box.bottom);
          }).map(button => button.textContent);
        });
        expect(clippedLabels, `${language}, ${width}px viewport, ${fontSize}px text`).toEqual([]);
        if (fontSize === 16 || width > 640) {
          const wrappedLabels = await buttons.evaluateAll(elements => elements.filter(button => {
            const range = document.createRange();
            range.selectNodeContents(button);
            return range.getClientRects().length > 1;
          }).map(button => button.textContent));
          expect(wrappedLabels, `Single-line labels at ${width}px with ${fontSize}px text`).toEqual([]);
        }
        if (width === 1280) {
          const sidebarWidth = (await navigation.boundingBox())!.width;
          if (fontSize === 16) normalSidebarWidth = sidebarWidth;
          else expect(sidebarWidth).toBeGreaterThan(normalSidebarWidth);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (language === "sv" && [320, 1280].includes(width)) {
          await navigation.screenshot({ path: testInfo.outputPath(`admin-navigation-${width}-${fontSize}.png`) });
        }
      }
    }
    await buttons.first().focus();
    for (let index = 1; index < labelKeys.length; index++) {
      await page.keyboard.press("Tab");
      await expect(buttons.nth(index)).toBeFocused();
    }
  });
}
