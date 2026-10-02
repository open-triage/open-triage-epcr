import { expect, test } from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';

test('Review administrators have no retrospective workflow', async ({ page }) => {
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true', 'Requires server-backed mock API configuration.');
  const session = { csrfToken: 'csrf', user: { id: 'reviewer', displayName: 'Reviewer' },
    organization: { id: 'organization', name: 'Example EMS' }, startedAt: '2026-10-02T08:00:00Z',
    expiresAt: '2099-10-02T20:00:00Z', capabilities: ['review:all', 'review:admin'], workspaceAvailable: true };
  let retrospectiveRequests = 0;
  await page.addInitScript(stored => localStorage.setItem('open-triage.clinician-session.v1', JSON.stringify(stored)), session);
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/installation') return route.fulfill({ json: { settings } });
    if (pathname === '/api/sessions/current') return route.fulfill({ json: session });
    if (pathname.startsWith('/api/review/retrospective')) retrospectiveRequests++;
    if (pathname === '/api/review/reports') return route.fulfill({ json: { dataset: 'real', scope: 'all',
      identifying: false, administrator: true, page: 1, pageSize: 25, total: 0,
      asOf: new Date().toISOString(), reports: [] } });
    if (pathname === '/api/review/queue') return route.fulfill({ json: { dataset: 'real', page: 1,
      pageSize: 25, total: 0, asOf: new Date().toISOString(), items: [] } });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Retrospective', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Retrospective Review' })).toHaveCount(0);
  expect(retrospectiveRequests).toBe(0);
});
