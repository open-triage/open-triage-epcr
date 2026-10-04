import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { AnalyticsElement } from '@open-triage/contracts';
import { analyticsFields, analyticsFixture, setupAnalytics } from './helpers/analytics';

test.beforeEach(() => test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true', 'Requires server-backed mock API configuration.'));

test('configured metrics and rules expose typed controls, denominators and version-bound exports', async ({ page }, testInfo) => {
  const binding = { id: 'interval', validationVersionId: 'shared-version', version: 7, catalogReleaseId: 'catalog', compiledSha256: 'a'.repeat(64) };
  const fields: AnalyticsElement[] = [...analyticsFields,
    { ...analyticsFields[1]!, id: 'metric:shared-version:interval', label: 'PSAP interval', unit: 's', units: ['s'], recordCount: 0,
      aggregations: ['mean','median','minimum','maximum','p90'], configured: { ...binding, kind: 'metric' } },
    { ...analyticsFields[2]!, id: 'rule:shared-version:threshold', label: 'Interval check', datatype: 'boolean', recordCount: 0,
      grouping: false, filtering: false, configured: { ...binding, id: 'threshold', kind: 'rule' } },
  ];
  const state = await setupAnalytics(page, { fields });
  let emptyDenominator = false;
  state.queryHook = async (route, definition) => {
    const result = analyticsFixture(definition, 'real', 'all', fields);
    if (result.metric.configured) result.evidence = [{ reportId: 'report-with-missing-input', reportingDate: definition.from,
      evaluation: { definition: result.metric.configured, reportRevision: '3', amendmentSequence: 1, state: 'failed', value: null,
        reason: 'Historical report catalog is incompatible with this definition' } }];
    if (result.metric.configured?.kind === 'rule') {
      const valid = emptyDenominator ? 0 : 2;
      result.completeness = { total: 5, valid, missing: emptyDenominator ? 3 : 1, absent: 0, invalid: 0, notApplicable: 1, failed: 1 };
      result.summary = emptyDenominator ? null : 50;
      result.unit = '%';
      result.cells = result.cells.map(cell => ({ ...cell, ...result.completeness, value: result.summary, count: emptyDenominator ? 0 : 1,
        numerator: emptyDenominator ? 0 : 1, denominator: valid }));
    }
    await route.fulfill({ json: result });
  };
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Metric Records' }).click();
  await expect(page.getByRole('dialog')).toContainText('Configured metric');
  await expect(page.getByRole('dialog')).toContainText('Configured rule');
  await expect(page.getByRole('row', { name: 'Select Records', exact: true })).toBeVisible();
  for (const label of ['Dispatch priority', 'Custom assessment', 'Systolic blood pressure'])
    await expect(page.getByRole('row', { name: `Select ${label}`, exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('not-a-configured-metric');
  await expect(page.getByText('No matching metrics or rules.', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search', exact: true }).fill('');
  await page.getByRole('row', { name: 'Select PSAP interval', exact: true }).click();
  await page.getByRole('combobox', { name: 'Aggregation', exact: true }).selectOption('p90');
  await expect(page.getByText(/nearest rank/i)).toBeVisible();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect(page.locator('.analytics-result-header')).toContainText('Validation v7');
  await expect(page.getByRole('table', { name: 'Exact analytical values' })).toBeVisible();
  await page.getByRole('button', { name: 'Export', exact: false }).first().click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Record-level data · CSV', exact: true }).click();
  await downloaded;
  expect(state.exports[0]).toMatchObject({ kind: 'records', expectedRevision: 'a'.repeat(64), definition: { metric: fields[5]!.id, aggregation: 'p90' } });
  await page.getByRole('button', { name: 'Metric PSAP interval' }).click();
  await page.getByRole('row', { name: 'Select Interval check', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Aggregation', exact: true }).locator('option')).toHaveText(['Count','Percentage']);
  await page.getByRole('combobox', { name: 'Rule outcome', exact: true }).selectOption('fail');
  await page.getByRole('combobox', { name: 'Aggregation', exact: true }).selectOption('percentage');
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect.poll(() => state.queries.at(-1)?.outcome).toBe('fail');
  await expect(page.locator('.analytics-result-header')).toContainText('Fail');
  await expect(page.locator('.analytics-context')).toContainText('2 records included');
  const table = page.getByRole('table', { name: 'Exact analytical values' });
  await expect(table.getByRole('rowheader', { name: 'Fail', exact: true })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Not applicable', exact: true })).toBeVisible();
  await expect(table.locator('tbody td').nth(3)).toHaveText('2');
  emptyDenominator = true;
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect(table.locator('tbody td').first()).toHaveText('Unavailable');
  await expect(page.locator('.analytics-context')).toContainText('0 records included');
  await page.getByText('Contributing reports and evidence', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Contributing reports and evidence' })).toContainText('Historical report catalog is incompatible');
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; document.documentElement.style.setProperty('--green', '#5144a6'); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('configured-analytics-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.screenshot({ path: testInfo.outputPath('configured-analytics-desktop.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('.analytics-workspace').withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]);
});
