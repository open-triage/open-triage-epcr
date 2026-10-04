import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileMetricLibrary, compileValidationRule, type ValidationDraft } from '@open-triage/contracts';

let script: string, css: string;
const catalog = { elements: ['eTimes.01', 'eTimes.07'].map((elementId) => ({ elementId, label: elementId === 'eTimes.01' ? 'PSAP call' : 'Patient contact', baseDatatype: 'dateTime' })), codes: [] };
test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, '../app/styles.css'), 'utf8');
  const built = await build({ bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env': '{}' },
    stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AdminLanguageContext} from './app/admin-localization';
      import {ValidationAuthoring} from './components/validation-authoring';
      createRoot(document.getElementById('root')).render(<AdminLanguageContext.Provider value="en">
        <ValidationAuthoring language="en" csrfToken="proof" catalogReleaseId="catalog" capabilities={['validation:read','validation:write','validation:publish']}/>
      </AdminLanguageContext.Provider>);` } });
  script = built.outputFiles[0]!.text;
});

test('metric and rule drafts persist together through save, publication and reload', async ({ page }, testInfo) => {
  let draft: ValidationDraft = { id: 'version', catalogReleaseId: 'catalog', clonedFromId: null, revision: 1, displayName: 'Clinical policy', updatedAt: new Date().toISOString(), metrics: [], rules: [{
    id: 'rule', name: 'Interval check', message: 'Check interval', enabled: true, severity: 'warning', executionTargets: ['review'], primaryTargetElementId: 'eTimes.07', source: 'require present("eTimes.07")',
  }] };
  let published = false, rejectSave = false, libraryFailure = false;
  await page.route('**/__metrics-script', route => route.fulfill({ contentType: 'text/javascript', body: script }));
  await page.route('**/__metrics-style', route => route.fulfill({ contentType: 'text/css', body: css }));
  await page.route('**/__metrics-harness', route => route.fulfill({ contentType: 'text/html', body: '<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Metric library</title><link rel="stylesheet" href="/__metrics-style"></head><body style="--green:#5144a6;--green-dark:#312767"><main id="root"></main><script src="/__metrics-script"></script></body></html>' }));
  await page.route('**/api/admin/**', async route => {
    const name = new URL(route.request().url()).pathname.replace('/api/admin/', '');
    if (name === 'validation-draft') return route.fulfill({ json: draft });
    if (name === 'validation-versions' || name === 'catalog-versions' || name === 'form-versions') return route.fulfill({ json: [] });
    if (name === 'catalog-versions/catalog' || name === 'catalog-definition') return route.fulfill({ json: { id: 'catalog', definition: { elements: catalog.elements.map(element => ({ ...element, storageSemantics: { groupPath: [] }, constraints: { minOccurs: 0, maxOccurs: 1 } })), codeLists: [] } } });
    if (name === 'validation-rules') return libraryFailure ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ json: { items: draft.rules.map(rule => ({ rule, source: 'agency', validity: 'valid', diagnostics: [] })), total: draft.rules.length, nextCursor: null } });
    if (name === 'validation-drafts/version' && route.request().method() === 'PUT') {
      if (rejectSave) return route.fulfill({ status: 409, json: { code: 'admin.validationDraftStale', message: 'Validation draft revision is stale' } });
      const body = route.request().postDataJSON(); expect(body.metrics).toHaveLength(2);
      expect(body.rules[0].source).toContain(body.metrics[0].id);
      draft = { ...draft, ...body, revision: draft.revision + 1 }; return route.fulfill({ json: draft });
    }
    if (name.endsWith('/validate')) {
      const metrics = compileMetricLibrary(draft.metrics ?? [], draft.id, catalog);
      const rules = draft.rules.map(rule => compileValidationRule(rule, draft.id, catalog, metrics.metrics));
      const diagnostics = [...metrics.diagnostics, ...rules.flatMap(rule => rule.diagnostics)];
      return route.fulfill({ json: { valid: !diagnostics.some(item => item.severity === 'error'), diagnostics } });
    }
    if (name.endsWith('/publish')) { published = true; return route.fulfill({ json: { id: 'version', displayName: draft.displayName, version: 2, ruleIds: ['rule'], metricIds: draft.metrics?.map(metric => metric.id), catalogReleaseId: 'catalog' } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/__metrics-harness');
  await page.getByRole('button', { name: 'Create metric', exact: true }).click();
  await page.getByLabel('Metric name', { exact: true }).fill('PSAP interval');
  await page.getByLabel('Description', { exact: true }).fill('Retain this unsaved calculation');
  const editor = page.getByRole('group', { name: 'Metric editor', exact: true });
  await editor.getByRole('checkbox', { name: 'Enabled', exact: true }).check();
  await editor.getByRole('checkbox', { name: 'Review enabled', exact: true }).check();
  const firstId = await page.locator('.metric-library-table tbody tr').first().locator('small').innerText();
  await page.getByLabel('Rule source', { exact: true }).fill(`require metricCompare("${firstId}", "less-or-equal", 90, "s")`);
  await page.getByRole('button', { name: 'Create metric', exact: true }).click();
  await page.getByLabel('Metric name', { exact: true }).fill('Second interval');
  await page.getByRole('button', { name: 'Edit: PSAP interval', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Retain this unsaved calculation');
  await expect(editor).toContainText('Interval check');
  expect(await page.locator('#metric-library-heading').evaluate(element => !!(element.compareDocumentPosition(document.getElementById('validation-library-heading')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  rejectSave = true;
  await page.getByRole('button', { name: 'Save Validation draft', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'edits are retained' })).toBeVisible();
  await expect(page.getByLabel('Metric name', { exact: true })).toHaveValue('PSAP interval');
  rejectSave = false;
  await page.getByRole('button', { name: 'Save Validation draft', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save Validation draft', exact: true })).toBeDisabled();
  libraryFailure = true;
  await page.reload();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Retain this unsaved calculation');
  await expect(page.getByLabel('Rule source', { exact: true })).toHaveValue(`require metricCompare("${firstId}", "less-or-equal", 90, "s")`);
  // Check both enlarged mobile controls and the desktop agency palette.
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  const bounds = await page.getByLabel('Metric name', { exact: true }).boundingBox();
  expect(bounds!.width).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#metric-library-heading').scrollIntoViewIfNeeded();
  await page.locator('.metric-library').screenshot({ path: testInfo.outputPath('metric-library-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.locator('#metric-library-heading').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('metric-library-desktop.png') });
  const audit = await new AxeBuilder({ page }).include('.metric-library').withTags(['wcag2a','wcag2aa']).analyze();
  expect(audit.violations).toEqual([]);
  await page.getByRole('button', { name: 'Validate draft', exact: true }).click();
  await page.getByLabel('Publication note', { exact: true }).fill('Publish shared library');
  await page.getByRole('button', { name: 'Publish immutable Validation version', exact: true }).click();
  await expect.poll(() => published).toBe(true);
});
