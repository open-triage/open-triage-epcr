import { expect,test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { analyticsFixture,setupAnalytics } from './helpers/analytics';

test.beforeEach(()=>{test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE!=='true','Requires server-backed mock API configuration.');});

test('grouped charts and tables display names instead of code identities', async ({ page }) => {
  const state = await setupAnalytics(page);
  state.queryHook = async (route, definition) => {
    const result = analyticsFixture(definition);
    result.series = result.series.map((series, index) => ({ ...series,
      group: { type: 'code', value: index === 0 ? '2305001' : '2305005' },
      groupLabel: index === 0 ? 'Critical' : 'Lower Acuity' }));
    await route.fulfill({ json: result });
  };
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Group by No grouping' }).click();
  await page.getByRole('row', { name: 'Select Dispatch priority' }).click();
  for (const visualization of ['Line', 'Bar', 'Table']) {
    await page.getByRole('button', { name: visualization, exact: true }).click();
    await page.getByRole('button', { name: 'Update visualization' }).click();
    if (visualization === 'Bar') {
      await expect(page.locator('.analytics-bar-label')).toHaveText(['Critical', 'Lower Acuity']);
      await expect(page.locator('.analytics-legend')).toHaveCount(0);
      await expect(page.locator('.analytics-result')).not.toContainText('1. Critical');
    }
    const labels = visualization === 'Table' ? page.locator('.analytics-table tbody th')
      : visualization === 'Bar' ? page.locator('.analytics-bar-label') : page.locator('.analytics-legend li');
    await expect(labels).toHaveText(['Critical', 'Lower Acuity']);
    await expect(page.locator('.analytics-result')).not.toContainText(/2305001|2305005/);
  }
});

test('unified controls preserve Review selection, query drafts and results across navigation',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});const state=await setupAnalytics(page);
  await expect(page.getByRole('tab',{name:'Review',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('PCR');
  await page.getByRole('table',{name:'Review queue'}).locator('tbody tr').first().click();
  await expect(page.locator('#review-inspector')).toBeVisible();
  await page.getByRole('tab',{name:'Analytics',exact:true}).click();
  await page.getByRole('button',{name:'Metric Records'}).click();
  await page.getByRole('row',{name:'Select Response time',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Aggregation',exact:true})).toHaveValue('median');
  await expect(page.getByRole('status').filter({hasText:'Aggregation changed'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Aggregation',exact:true}).locator('option')).toHaveText(['Mean','Median','Minimum','Maximum']);
  await page.locator('.analytics-rail').getByLabel('From',{exact:true}).fill('2026-10-01');await page.getByLabel('Through',{exact:true}).fill('2026-10-03');
  await page.getByRole('button',{name:'Group by No grouping'}).click();await page.getByRole('row',{name:'Select Dispatch priority'}).click();
  await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  await expect(page.getByRole('button',{name:'Export',exact:false}).first()).toBeEnabled();
  await page.getByRole('tab',{name:'Review',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('PCR');await expect(page.locator('#review-inspector')).toBeVisible();
  await page.getByRole('tab',{name:'Analytics',exact:true}).click();await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  await page.getByLabel('Time grouping').selectOption('day');await expect(page.getByText('Unapplied choices',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Export',exact:false}).first()).toBeDisabled();
  await page.getByRole('button',{name:'Update visualization'}).click();await expect.poll(()=>state.queries.at(-1)?.timeGrouping).toBe('day');
  await page.getByRole('button',{name:'Bar',exact:true}).click();await expect(page.getByLabel('Time grouping')).toBeHidden();await page.getByRole('button',{name:'Update visualization'}).click();
  await page.getByRole('button',{name:'Table',exact:true}).click();await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.getByRole('table',{name:'Exact analytical values'})).toBeVisible();
  await expect(page.locator('.analytics-result').getByRole('img')).toHaveCount(0);
  expect(state.queries.at(-1)).toMatchObject({metric:'metric:shared-version:response',aggregation:'median',visualization:'table',groupBy:'priority',timeGrouping:'day'});
  await page.getByRole('button',{name:'Line',exact:true}).click();await page.getByLabel('Time grouping').selectOption('month');await page.getByRole('button',{name:'Update visualization'}).click();
  await expect.poll(()=>state.queries.at(-1)?.timeGrouping).toBe('month');
  await page.screenshot({path:'/tmp/unified-analytics-desktop.png',fullPage:true});
  const violations=(await new AxeBuilder({page}).include('.analytics-workspace').analyze()).violations;expect(violations).toEqual([]);
});

test('catalog filters are historical, typed, editable and independent of current query dates',async({page})=>{
  const state=await setupAnalytics(page,{demo:true,own:true});await page.getByRole('tab',{name:'Analytics',exact:true}).click();
  await page.getByRole('button',{name:'Add filter',exact:false}).click();await page.getByRole('row',{name:'Select Dispatch priority'}).click();
  await expect(page.getByText('Your readable report history',{exact:false}).last()).toBeVisible();
  await page.getByRole('checkbox',{name:'Historical'}).check();await page.getByRole('checkbox',{name:'High',exact:true}).check();await page.getByRole('button',{name:'Use 2 values'}).click();
  await page.getByRole('button',{name:'Add filter',exact:false}).click();await page.getByRole('row',{name:'Select Custom assessment'}).click();await page.getByRole('checkbox',{name:'Low',exact:true}).check();await page.getByRole('button',{name:'Use 1 values'}).click();
  await page.getByRole('button',{name:'Update visualization'}).click();await expect.poll(()=>state.queries.length).toBe(1);
  expect(state.queries[0]?.filters).toHaveLength(2);expect(state.queries[0]?.filters[0]?.values).toHaveLength(2);
  expect(state.catalog.every(url=>!url.searchParams.has('from')&&!url.searchParams.has('through')&&!url.searchParams.has('dataset'))).toBe(true);
  await page.getByRole('button',{name:'Remove filter: Custom assessment'}).click();await expect(page.getByText('Unapplied choices',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Metric Records'}).click();
  await expect(page.getByRole('row',{name:'Select Systolic blood pressure'})).toHaveCount(0);
  await page.getByRole('row',{name:'Select Response time'}).click();
  await page.getByRole('button',{name:'Metric Response time'}).click();await page.getByRole('row',{name:'Select Records',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Aggregation',exact:true}).locator('option')).toHaveText(['Count','Percentage']);await expect(page.getByRole('combobox',{name:'Aggregation',exact:true})).toHaveValue('count');
  await page.getByRole('combobox',{name:'Aggregation',exact:true}).selectOption('percentage');await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.getByText('Your reports',{exact:false})).toBeVisible();
});

test('failed and delayed refreshes retain applied results and newer controls',async({page})=>{
  const state=await setupAnalytics(page);await page.getByRole('tab',{name:'Analytics',exact:true}).click();await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  state.queryError=true;await page.getByLabel('Time grouping').selectOption('day');await page.getByRole('button',{name:'Update visualization'}).click();
  await expect(page.locator('.analytics-result').getByRole('alert')).toContainText('Analytics is unavailable');await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  await expect(page.getByRole('button',{name:'Export',exact:false}).first()).toBeDisabled();
  state.queryError=false;let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});
  state.queryHook=async(route,definition)=>{await wait;await route.fulfill({json:analyticsFixture(definition)});};
  await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.getByText('Updating… Previous result retained.')).toBeVisible();
  await page.getByLabel('Time grouping').selectOption('month');release();await expect(page.getByText('Unapplied choices',{exact:true})).toBeVisible();await expect(page.getByLabel('Time grouping')).toHaveValue('month');
  await page.getByRole('tab',{name:'Review',exact:true}).click();await page.getByRole('tab',{name:'Analytics',exact:true}).click();await expect(page.getByLabel('Time grouping')).toHaveValue('month');
});

test('the visualization button cancels a pending query and ignores its late response', async ({ page }) => {
  const state = await setupAnalytics(page);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  const previous = await page.locator('.analytics-context > strong').textContent();
  let release = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  state.queryHook = async (route, definition) => {
    await wait;
    await route.fulfill({ json: { ...analyticsFixture(definition), summary: 99 } }).catch(() => {});
  };
  await page.getByLabel('Time grouping').selectOption('day');
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect.poll(() => state.queries.length).toBe(2);
  await page.getByLabel('Time grouping').selectOption('month');
  await page.locator('.analytics-rail').getByLabel('From', { exact: true }).fill('');
  const cancel = page.getByRole('button', { name: 'Cancel visualization' });
  await expect(cancel).toBeEnabled();
  const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/analytics/query'));
  await cancel.click();
  await expect(page.getByText('Visualization update cancelled.', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-result')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.analytics-context > strong')).toHaveText(previous!);
  await expect(page.getByLabel('Time grouping')).toHaveValue('month');
  await expect(page.getByRole('button', { name: 'Update visualization' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export', exact: false }).first()).toBeDisabled();
  await page.locator('.analytics-rail').getByLabel('From', { exact: true }).fill(state.queries[0]!.from);
  state.queryHook = undefined;
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect.poll(() => state.queries.length).toBe(3);
  await expect(page.getByText('All choices applied', { exact: true })).toBeVisible();
  release();
  expect((await aborted).failure()?.errorText).toContain('ABORTED');
  await expect(page.locator('.analytics-context > strong')).toHaveText(previous!);
});

test('bar labels wrap directly below their bars at desktop and mobile widths', async ({ page }) => {
  const state = await setupAnalytics(page);
  const names = ['Emergency department arrival with advanced treatment and continued observation after a prolonged transport',
    'Regional specialty destination with prolonged transport and continued monitoring during transfer of patient care'];
  state.queryHook = async (route, definition) => {
    const result = analyticsFixture(definition);
    result.series = result.series.map((series, index) => ({ ...series, groupLabel: names[index]! }));
    await route.fulfill({ json: result });
  };
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Group by No grouping' }).click();
  await page.getByRole('row', { name: 'Select Dispatch priority' }).click();
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect(page.locator('.analytics-bar-label')).toHaveCount(2);
  expect(await page.locator('.analytics-bar-label').first().locator('tspan').count()).toBeGreaterThan(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const positions = await page.locator('.analytics-chart').evaluate(svg => {
      const chart = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('.analytics-bar-label')].map(label => {
        const box = label.getBoundingClientRect(), bar = label.parentElement!.querySelector('rect')!.getBoundingClientRect();
        return { center: (box.left + box.right) / 2, barCenter: (bar.left + bar.right) / 2,
          top: box.top, barBottom: bar.bottom, bottom: box.bottom, chartBottom: chart.bottom };
      });
    });
    for (const position of positions) {
      expect(Math.abs(position.center - position.barCenter)).toBeLessThan(1);
      expect(position.top).toBeGreaterThan(position.barBottom);
      expect(position.bottom).toBeLessThan(positions[0]!.chartBottom);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/analytics-bar-labels-${width}.png`, fullPage: true });
  }
});

test('mobile, enlarged text, agency colors and keyboard dialogs remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await setupAnalytics(page);await page.getByRole('tab',{name:'Analytics',exact:true}).click();
  await page.evaluate(()=>{document.documentElement.style.setProperty('--green','#5b2788');document.documentElement.style.fontSize='20px';});
  const metric=page.getByRole('button',{name:'Metric Records'});await metric.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();await expect(metric).toBeFocused();
  await page.getByRole('button',{name:'Update visualization'}).click();await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/unified-analytics-mobile.png',fullPage:true});
});

test('saved visualization dialogs hydrate, close when unavailable and stay closed on reconnect', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await setupAnalytics(page);
  let savedLookups = 0;
  page.on('request', request => { if (request.url().endsWith('/api/review/analytics/saved') && request.method() === 'GET') savedLookups++; });
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  const saveButton = page.getByRole('button', { name: 'Save visualization', exact: true });
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  expect(savedLookups).toBe(1);
  state.savedListFailure = true;
  await saveButton.click();
  await expect(page.getByRole('dialog', { name: 'Save visualization', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Saved visualizations are unavailable');
  await page.context().setOffline(true);
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(saveButton).toBeDisabled();
  state.savedListFailure = false;
  await page.context().setOffline(false);
  await expect(saveButton).toBeEnabled();
  await expect(page.locator('.analytics-saved-controls').getByRole('alert')).toBeHidden();
  await expect(page.getByRole('dialog')).toBeHidden();
  await saveButton.click();
  await expect(page.getByRole('dialog', { name: 'Save visualization', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(saveButton).toBeFocused();
  expect(state.queries).toHaveLength(0);
  expect(state.saveCommands).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('personal visualization parameters save, survive reload, restore controls and update without generating a query', async ({ page }) => {
  const state = await setupAnalytics(page);
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.getByRole('combobox', { name: 'Aggregation', exact: true }).selectOption('percentage');
  await page.locator('.analytics-rail').getByLabel('From', { exact: true }).fill('2026-08-01');
  await page.locator('.analytics-rail').getByLabel('Through', { exact: true }).fill('2026-10-05');
  await page.getByRole('button', { name: 'Group by No grouping' }).click();
  await page.getByRole('row', { name: 'Select Dispatch priority' }).click();
  await page.getByRole('button', { name: 'Add filter', exact: false }).click();
  await page.getByRole('row', { name: 'Select Custom assessment' }).click();
  await page.getByRole('checkbox', { name: 'High', exact: true }).check();
  await page.getByRole('button', { name: 'Use 1 values' }).click();
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add new visualization', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('My medication view');
  state.saveFailure = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Saved visualizations are unavailable');
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toHaveValue('My medication view');
  state.saveFailure = false;
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.saveCommands[0]!.commandId).toBe(state.saveCommands[1]!.commandId);
  expect(state.queries).toHaveLength(0);
  await page.reload();
  await page.getByRole('tab', { name: 'Analytics', exact: true }).click();
  await page.locator('.analytics-rail').getByLabel('From', { exact: true }).fill('');
  await page.getByRole('combobox', { name: 'Saved visualizations', exact: true }).selectOption({ label: 'My medication view' });
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Bar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Aggregation', exact: true })).toHaveValue('percentage');
  await expect(page.locator('.analytics-rail').getByLabel('From', { exact: true })).toHaveValue('2026-08-01');
  await expect(page.locator('.analytics-rail').getByLabel('Through', { exact: true })).toHaveValue('2026-10-05');
  await expect(page.getByRole('button', { name: 'Group by Dispatch priority' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove filter: Custom assessment' })).toBeVisible();
  expect(state.queries).toHaveLength(0);
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved visualizations', exact: true }).selectOption({ label: 'My medication view' });
  await expect(page.getByRole('button', { name: 'Bar', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.getByLabel('Time grouping').selectOption('month');
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  const commandsBeforeReplace = state.saveCommands.length;
  await page.getByRole('dialog').getByRole('cell', { name: 'My medication view', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Replace visualization?' })).toBeVisible();
  expect(state.saveCommands).toHaveLength(commandsBeforeReplace);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).include('.analytics-saved-dialog').analyze()).violations).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  const replace = page.getByRole('button', { name: 'Replace visualization: My medication view', exact: true });
  await expect(replace).toBeFocused();
  expect(state.saved[0]!.version).toBe(1);
  await replace.press('Enter');
  state.saveFailure = true;
  await page.getByRole('dialog').getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Saved visualizations are unavailable');
  await expect(page.getByRole('dialog', { name: 'Replace visualization?' })).toBeVisible();
  state.saveFailure = false;
  await page.getByRole('dialog').getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.saveCommands[commandsBeforeReplace]!.commandId).toBe(state.saveCommands[commandsBeforeReplace + 1]!.commandId);
  expect(state.saved).toHaveLength(1);
  expect(state.saved[0]!.version).toBe(2);
  expect(state.saved[0]!.definition).toMatchObject({ visualization: 'line', timeGrouping: 'month' });
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add new visualization', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Add new visualization', exact: true })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Add new visualization', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Second view');
  await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.saved).toHaveLength(2);
  await page.getByRole('button', { name: 'Update visualization' }).click();
  await expect(page.locator('.analytics-result').getByRole('img')).toBeVisible();
  expect(state.queries).toHaveLength(1);
  state.savedListFailure = true;
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Saved visualizations are unavailable');
  await expect(page.getByRole('dialog').getByRole('cell', { name: 'My medication view', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('cell', { name: 'Second view', exact: true })).toBeVisible();
  state.savedListFailure = false;
  await page.getByRole('dialog').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toBeHidden();
  expect((await new AxeBuilder({ page }).include('.analytics-saved-dialog').analyze()).violations).toEqual([]);
  await page.screenshot({ path: '/tmp/analytics-saved-visualizations.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save visualization', exact: true })).toBeFocused();
  const dropdown = await page.getByRole('combobox', { name: 'Saved visualizations', exact: true }).boundingBox();
  const saveButton = await page.getByRole('button', { name: 'Save visualization', exact: true }).boundingBox();
  expect(dropdown!.y + dropdown!.height).toBeLessThanOrEqual(saveButton!.y);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  await page.screenshot({ path: '/tmp/analytics-saved-visualizations-desktop.png', fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  state.savedAccessDenied = true;
  await page.getByRole('button', { name: 'Save visualization', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Saved visualizations', exact: true }).getByRole('option')).toHaveCount(1);
  await expect(page.locator('.analytics-saved-controls')).not.toContainText('Second view');
});
