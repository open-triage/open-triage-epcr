import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { analyticsFields, setupAnalytics } from './helpers/analytics';

test.beforeEach(() => test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true', 'Requires server-backed mock API configuration.'));

test('picker search coalesces typing and only counts the settled choices', async ({ page }) => {
  const state = await setupAnalytics(page);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row', { name: 'Select Records', exact: true }).locator('td').last()).toHaveText('4');
  const catalogRequests = state.catalog.length, countRequests = state.counts.length;
  await dialog.getByRole('searchbox').pressSequentially('Response', { delay: 20 });
  await expect(dialog.getByRole('row', { name: 'Select Response time', exact: true }).locator('td').last()).toHaveText('3');
  expect(state.catalog.slice(catalogRequests).map(url => url.searchParams.get('search'))).toEqual(['Response']);
  expect(state.counts.slice(countRequests).map(request => request.selection)).toEqual([
    { purpose: 'metric', ids: ['metric:shared-version:response'] },
  ]);
});

test('users can be selected for grouping and multiselect filters with included counts', async ({ page }, testInfo) => {
  const state = await setupAnalytics(page);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Group by No grouping', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const user = dialog.getByRole('row', { name: 'Select User', exact: true });
  await expect(user).toHaveAttribute('aria-disabled', 'false');
  await user.press('Enter');
  await expect(page.getByRole('button', { name: 'Group by User', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Add filter', exact: false }).click();
  await user.locator('td').first().click();
  await dialog.getByRole('searchbox').fill('Alex');
  const alex = dialog.getByRole('checkbox', { name: 'Alex Andersson', exact: true });
  const alexRow = dialog.locator('tbody tr').filter({ has: page.getByRole('checkbox', { name: 'Alex Andersson', exact: true }) });
  await expect(dialog.getByRole('checkbox')).toHaveCount(1);
  await expect(alexRow.locator('td').last()).toHaveText('3');
  await alexRow.locator('td').last().click();
  await expect(alex).toBeChecked();
  await dialog.getByRole('searchbox').fill('');
  await dialog.getByRole('checkbox', { name: 'Sam Svensson', exact: true }).check();
  expect((await new AxeBuilder({ page }).include('.analytics-dialog[open]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('analytics-users-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('analytics-users-desktop.png') });
  await dialog.getByRole('button', { name: 'Use 2 values', exact: true }).click();
  await page.getByRole('button', { name: 'Update visualization', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.filters).toEqual([{ element: 'record.documenting-user',
    values: [{ type: 'code', value: 'user-a' }, { type: 'code', value: 'user-b' }] }]);
  expect(state.queries.at(-1)?.groupBy).toBe('record.documenting-user');
  await expect(page.locator('.analytics-context')).toContainText('2 records included');
  await expect(page.locator('.analytics-legend')).toContainText('Alex Andersson');
  await expect(page.locator('.analytics-legend')).toContainText('Sam Svensson');
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  await expect(user).toHaveCount(0);
});

test('analytics picker rows share hover, selection and independent native controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const state = await setupAnalytics(page);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const rows = dialog.locator('tbody tr');
  const records = dialog.getByRole('row', { name: 'Select Records', exact: true });
  const response = dialog.getByRole('row', { name: 'Select Response time', exact: true });
  await expect(dialog.getByRole('button', { name: /^Select / })).toHaveCount(0);
  await expect(dialog.getByRole('columnheader', { name: 'Actions', exact: true })).toHaveCount(0);
  await expect(records.locator('td').last()).toHaveText('4');
  await expect(response.locator('td').last()).toHaveText('3');
  await expect(records).toHaveAttribute('aria-selected', 'true');
  await expect(records.locator('td').first()).toContainText('✓');
  await expect(response).toHaveAttribute('aria-selected', 'false');
  await expect(response).toHaveCSS('cursor', 'pointer');
  const normal = await response.evaluate(row => getComputedStyle(row).backgroundColor);
  await response.locator('td').first().hover();
  const defaultHover = await response.evaluate(row => getComputedStyle(row).backgroundColor);
  expect(defaultHover).not.toBe(normal);
  await page.evaluate(() => document.documentElement.style.setProperty('--green', '#5b2788'));
  const agencyHover = await response.evaluate(row => getComputedStyle(row).backgroundColor);
  expect(agencyHover).not.toBe(defaultHover);
  expect(await records.evaluate(row => getComputedStyle(row).backgroundColor)).not.toBe(agencyHover);
  await page.screenshot({ path: testInfo.outputPath('analytics-picker-desktop.png') });
  expect((await new AxeBuilder({ page }).include('.analytics-dialog[open]').analyze()).violations).toEqual([]);
  await response.locator('td').first().click();
  await expect(dialog).toBeHidden();
  const metric = page.getByRole('button', { name: 'Metric Response time', exact: true });
  await expect(metric).toBeFocused();
  await page.getByRole('button', { name: 'Update visualization', exact: true }).click();
  await expect(page.locator('.analytics-context')).toContainText('3 records included');
  await metric.click();
  await expect(response).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('searchbox').press('Tab');
  await expect(records).toBeFocused();
  await expect(records).toHaveCSS('outline-style', 'solid');
  await records.press('Space');
  await expect(page.getByRole('button', { name: 'Metric Records', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Group by No grouping', exact: true }).click();
  const none = dialog.getByRole('row', { name: 'Select No grouping', exact: true });
  const priority = dialog.getByRole('row', { name: 'Select Dispatch priority', exact: true });
  await expect(none).toHaveAttribute('aria-selected', 'true');
  await priority.locator('td').nth(1).click();
  await page.getByRole('button', { name: 'Group by Dispatch priority', exact: true }).click();
  await expect(priority).toHaveAttribute('aria-selected', 'true');
  await none.locator('td').first().click();
  await expect(page.getByRole('button', { name: 'Group by No grouping', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Add filter', exact: false }).click();
  await priority.locator('td').nth(1).click({ position: { x: 2, y: 2 } });
  const high = rows.filter({ has: page.getByRole('checkbox', { name: 'High', exact: true }) });
  const checkbox = high.getByRole('checkbox');
  await high.locator('td').nth(1).click();
  await expect(checkbox).toBeChecked();
  await expect(high).toHaveAttribute('aria-selected', 'true');
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await high.locator('label').click();
  await expect(checkbox).toBeChecked();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(high).toHaveCSS('outline-style', 'solid');
  await expect(checkbox).not.toBeChecked();
  await high.locator('small').click();
  await expect(checkbox).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Use 1 values', exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
  expect(await dialog.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('analytics-picker-mobile.png') });
  expect((await new AxeBuilder({ page }).include('.analytics-dialog[open]').analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Use 1 values', exact: true }).click();
  await page.getByRole('button', { name: 'Add filter', exact: false }).click();
  await expect(priority).toHaveAttribute('aria-selected', 'true');
  await priority.press('Enter');
  await expect(checkbox).toBeChecked();
  await dialog.getByRole('button', { name: 'Use 1 values', exact: true }).click();
  await page.getByRole('button', { name: 'Update visualization', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.filters).toEqual([{ element: 'priority', values: [{ type: 'code', value: 'High' }] }]);
  await expect(page.locator('.analytics-context')).toContainText('2 records included');
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  await expect(records.locator('td').last()).toHaveText('2');
  await expect(response.locator('td').last()).toHaveText('1');
  expect(state.counts.at(-1)?.definition.filters).toEqual(state.queries.at(-1)?.filters);
});

test('picker counts show unavailable on failure and can retry or show an empty filtered population', async ({ page }) => {
  const state = await setupAnalytics(page);
  state.countMode = 'fail';
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const records = dialog.getByRole('row', { name: 'Select Records', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Record counts are unavailable.');
  await expect(records.locator('td').last()).toHaveText('Unavailable');
  await expect(records).toHaveAttribute('aria-disabled', 'false');
  state.countMode = 'empty';
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(records.locator('td').last()).toHaveText('0');
  await records.press('Enter');
  await page.locator('.analytics-rail').getByLabel('From', { exact: true }).fill('2026-10-01');
  await page.getByLabel('Through', { exact: true }).fill('2026-10-03');
  state.countMode = 'ready';
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  await expect(records.locator('td').last()).toHaveText('4');
  expect(state.counts.at(-1)?.definition).toMatchObject({ from: '2026-10-01', through: '2026-10-03' });
});

test('unavailable and retained picker rows cannot be selected during loading or failure', async ({ page }) => {
  await setupAnalytics(page, { fields: [...analyticsFields, {
    ...analyticsFields[1]!, id: 'unsupported', label: 'Unsupported metric', aggregations: [], unsupportedReason: 'Unavailable',
  }] });
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Metric Records', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const response = dialog.locator('tbody tr').filter({ hasText: 'Response time' });
  const unsupported = dialog.locator('tbody tr').filter({ hasText: 'Unsupported metric' });
  await expect(unsupported).toHaveAttribute('aria-disabled', 'true');
  await unsupported.locator('td').first().dispatchEvent('click');
  await expect(dialog).toBeVisible();
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/review/analytics/elements?*', async route => {
    await pending;
    await route.fulfill({ status: 503, json: { message: 'Analytics is unavailable. Please retry.' } });
  });
  await dialog.getByRole('searchbox').fill('Response');
  await expect(response).toHaveAttribute('aria-disabled', 'true');
  await response.locator('td').nth(1).dispatchEvent('click');
  await expect(dialog).toBeVisible();
  release!();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await response.locator('td').first().dispatchEvent('click');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Metric Records', exact: true })).toBeFocused();
});
