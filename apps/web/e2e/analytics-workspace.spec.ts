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
    const labels = visualization === 'Table' ? page.locator('.analytics-table tbody th') : page.locator('.analytics-legend li');
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
