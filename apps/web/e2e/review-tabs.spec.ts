import { openReviewCall } from "./helpers/review-window";
import { expect, test } from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';

for (const demo of [false, true]) for (const width of [390, 1440]) test(`Review opens the queue and Admin consolidates Review settings at ${width}px (${demo ? 'demo' : 'ordinary'})`, async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true', 'Requires server-backed mock API configuration.');
  await page.setViewportSize({ width, height: 900 });
  const session = { csrfToken: 'csrf', user: { id: 'reviewer', displayName: 'Reviewer' },
    organization: { id: 'organization', name: 'Example EMS' }, startedAt: '2026-10-02T08:00:00Z',
    expiresAt: '2099-10-02T20:00:00Z', capabilities: ['review:all', 'review:admin', ...(demo ? ['clinical:demo'] : [])], workspaceAvailable: true };
  const dataset = demo ? 'synthetic' : 'real';
  const backlogDatasets: Array<string | null> = [];
  const item = { id: '123e4567-e89b-42d3-a456-426614174001', reportId: '123e4567-e89b-42d3-a456-426614174002', reportNumber: 'PCR-000123', criterionId: 'criterion-1',
    criterionName: 'Low oxygen saturation', priority: 'high', status: 'new', assigneeId: null,
    version: 0, firstMatchedAt: new Date().toISOString(), reportingDate: '2026-10-02', findings: [] };
  const searches: URLSearchParams[] = [];
  await page.addInitScript((stored) => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(stored)), session);
  await page.context().route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/installation') return route.fulfill({ json: { settings } });
    if (url.pathname === '/api/sessions/current') return route.fulfill({ json: session });
    if (url.pathname === '/api/admin/context') return route.fulfill({ json: { organization: session.organization, capabilities: session.capabilities, panels: ['review-settings'], activeConfiguration: null, dashboard: null } });
    if (url.pathname === '/api/review/attention') return route.fulfill({ json: { dataset, asOf: new Date().toISOString(), total: 0, assignments: 0, responses: 0, reopened: 0, unavailableAssignees: 0, unavailableRoutes: 1, processingFailures: 1 } });
    if (url.pathname === '/api/review/backlog') {
      backlogDatasets.push(url.searchParams.get('dataset'));
      return route.fulfill({ json: { work: [] } });
    }
    if (url.pathname === '/api/review/overdue-policy') return route.fulfill({ json: { deadlineHours: 24, version: 1 } });
    if (url.pathname === '/api/review/amendment-policy') return route.fulfill({ json: { clearance: 'confirm', version: 1 } });
    if (url.pathname === '/api/review/outcomes') return route.fulfill({ json: [] });
    if (url.pathname === '/api/review/queue') {
      searches.push(url.searchParams);
      const items = [{ ...item, assigneeId: session.user.id }, { ...item,
        id: '123e4567-e89b-42d3-a456-426614174003', priority: 'medium',
        criterionName: 'Low oxygen saturation with a longer review reason at arrival' }];
      const filtered = items.filter(entry => url.searchParams.get('assignment') !== 'mine' || entry.assigneeId === session.user.id);
      return route.fulfill({ json: { dataset, page: 1, pageSize: 25, total: filtered.length,
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
  await expect(page.getByRole('tablist', { name: 'Review workspace', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Dataset', exact: true })).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Review queue', exact: true });
  await expect(table.getByRole('columnheader')).toHaveText(['Select', 'Report ID', 'Review reason', 'Priority', 'Status', 'Assignee', 'Age', 'Actions']);
  await expect(page.getByRole('button', { name: 'Select this page', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All reviews 2', exact: true })).toBeVisible();
  await expect(table.locator('tbody tr')).toHaveCount(2);
  expect(searches.length).toBeGreaterThan(0);
  expect(searches.every(search => search.get('dataset') === dataset)).toBe(true);
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
  const call = await openReviewCall(page, page.getByRole('button', { name: /^View PCR-000123/ }));
  await expect(call.getByRole('tab', { name: 'Actions', exact: true })).toHaveAttribute('aria-selected', 'true');
  await call.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(call.getByRole('tabpanel', { name: 'History', exact: true }).getByText('Discussion text requires Review identifying access.', { exact: false })).toBeVisible();
  await call.locator('#review-inspector').getByRole('button', { name: 'Close report', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue('oxygen');
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  const admin = page.getByRole('navigation', { name: 'Administration panels', exact: true });
  await expect(admin.getByRole('button')).toHaveText(['Review settings']);
  await expect(page.getByRole('tablist', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Dataset', exact: true })).toHaveCount(0);
  await expect.poll(() => backlogDatasets.length).toBeGreaterThan(0);
  expect(backlogDatasets.every(value => value === dataset)).toBe(true);
  for (const heading of ['Criterion routing', 'Review outcomes', 'Unsigned report deadline', 'Amendment clearance policy', 'Processing backlog']) {
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel('Hours after call completion')).toHaveValue('24');
  await page.getByLabel('Hours after call completion').fill('48');
  await page.getByLabel('When a criterion clears').selectOption('automatic');
  await expect(page.getByLabel('Hours after call completion')).toHaveValue('48');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `/tmp/review-settings-${width}-${dataset}.png`, fullPage: true });
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByLabel('Hours after call completion')).toHaveValue('48');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Routing needs attention: 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Criterion routing', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Processing failures: 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Processing backlog', exact: true })).toBeFocused();
});
