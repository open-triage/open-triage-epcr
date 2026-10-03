import { openReviewCall } from "./helpers/review-window";
import { expect, test } from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';

for (const width of [390, 1440]) test(`Review tabs preserve filters and support keyboard navigation at ${width}px`, async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true', 'Requires server-backed mock API configuration.');
  await page.setViewportSize({ width, height: 900 });
  const session = { csrfToken: 'csrf', user: { id: 'reviewer', displayName: 'Reviewer' },
    organization: { id: 'organization', name: 'Example EMS' }, startedAt: '2026-10-02T08:00:00Z',
    expiresAt: '2099-10-02T20:00:00Z', capabilities: ['review:all', 'review:admin'], workspaceAvailable: true };
  const item = { id: '123e4567-e89b-42d3-a456-426614174001', reportId: '123e4567-e89b-42d3-a456-426614174002', reportNumber: 'PCR-000123', criterionId: 'criterion-1',
    criterionName: 'Low oxygen saturation', priority: 'high', status: 'new', assigneeId: null,
    version: 0, firstMatchedAt: new Date().toISOString(), reportingDate: '2026-10-02', findings: [] };
  const searches: URLSearchParams[] = [];
  await page.addInitScript((stored) => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(stored)), session);
  await page.context().route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/installation') return route.fulfill({ json: { settings } });
    if (url.pathname === '/api/sessions/current') return route.fulfill({ json: session });
    if (url.pathname === '/api/review/queue') {
      searches.push(url.searchParams);
      const items = [{ ...item, assigneeId: session.user.id }, { ...item,
        id: '123e4567-e89b-42d3-a456-426614174003', priority: 'medium',
        criterionName: 'Low oxygen saturation with a longer review reason at arrival' }];
      const filtered = items.filter(entry => url.searchParams.get('assignment') !== 'mine' || entry.assigneeId === session.user.id);
      return route.fulfill({ json: { dataset: 'real', page: 1, pageSize: 25, total: filtered.length,
        assignmentCounts: { all: 2, mine: 1, unassigned: 1 },
        asOf: new Date().toISOString(), items: filtered } });
    }
    if (url.pathname === '/api/review/items/123e4567-e89b-42d3-a456-426614174001') return route.fulfill({ json: { ...item,
      assignmentHistory: [], progressHistory: [], comments: [], commentsRestricted: true } });
    if (url.pathname === '/api/review/reports/123e4567-e89b-42d3-a456-426614174002') return route.fulfill({ json: { id: '123e4567-e89b-42d3-a456-426614174002',
      reportingDate: '2026-10-02', signedAt: new Date().toISOString(), amendmentSequence: 0,
      groups: [], values: [], notes: [] } });
    if (url.pathname === '/api/review/routes' || url.pathname === '/api/review/eligible-reviewers') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  const navigation = page.getByRole('tablist', { name: 'Review workspace', exact: true });
  await expect(navigation.getByRole('tab')).toHaveCount(3);
  const queue = navigation.getByRole('tab', { name: 'Review queue' });
  await expect(queue).toHaveAttribute('aria-selected', 'true');
  const table = page.getByRole('table', { name: 'Review queue', exact: true });
  await expect(table.getByRole('columnheader')).toHaveText(['Select', 'Report ID', 'Review reason', 'Priority', 'Status', 'Assignee', 'Age', 'Actions']);
  await expect(page.getByRole('button', { name: 'Select this page', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All reviews 2', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select this page', exact: true }).click();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select this page', exact: true })).toBeVisible();
  const columns = await table.locator('tr').evaluateAll((rows) => rows.map(row => Array.from(row.children).map(cell => cell.getBoundingClientRect().x)));
  expect(columns[1]).toEqual(columns[0]);
  expect(columns[2]).toEqual(columns[0]);
  await expect(page.getByRole('heading', { name: 'Criterion routing' })).not.toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('oxygen');
  await page.getByRole('button', { name: /^Assigned to me/ }).click();
  await expect.poll(() => searches.at(-1)?.get('search')).toBe('oxygen');
  await expect.poll(() => searches.at(-1)?.get('assignment')).toBe('mine');
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Assigned to me 1', exact: true })).toBeVisible();
  await queue.focus();
  await page.keyboard.press('ArrowRight');
  await expect(navigation.getByRole('tab', { name: 'Reports', exact: true })).toHaveCount(0);
  await expect(navigation.getByRole('tab', { name: 'Analysis', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(navigation.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Criterion routing' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Retrospective', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Review settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Review outcomes', exact: true })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('oxygen');
  const call = await openReviewCall(page, page.getByRole('button', { name: /^View PCR-000123/ }));
  await expect(call.getByRole('tab', { name: 'Findings', exact: true })).toHaveAttribute('aria-selected', 'true');
  await call.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(call.getByText('Discussion text requires Review identifying access.', { exact: false })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => call.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
