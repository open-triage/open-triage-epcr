import {readFile} from 'node:fs/promises';
import {expect,test} from '@playwright/test';
import {setupAnalytics} from './helpers/analytics';
test('unified exports refresh a changed source, download each CSV kind and clear revoked data',async({page})=>{
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE!=='true','Requires server-backed mock API configuration.');
  const state=await setupAnalytics(page,{demo:true});await page.getByRole('tab',{name:'Analytics',exact:true}).click();await page.getByRole('button',{name:'Update visualization'}).click();
  const exportButton=page.getByRole('button',{name:'Export',exact:false}).first();await expect(exportButton).toBeEnabled();
  state.exportMode='refresh';await exportButton.click();await page.getByRole('button',{name:'Aggregate data · CSV'}).click();
  await expect(page.getByText('The source changed. Review the refreshed result before exporting again.')).toBeVisible();
  state.exportMode='download';for(const label of ['Aggregate data · CSV','Record-level data · CSV']){
    await exportButton.click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await pending;
    expect(await readFile((await download.path())!,'utf8')).toContain('"8.3","4"');
  }
  expect(state.exports.map(command=>command.kind)).toEqual(['aggregate','aggregate','records']);
  expect(state.exports[1]?.expectedRevision).toBe('b'.repeat(64));
  expect(state.exports[1]?.definition).toEqual(state.queries[0]);
  state.exportMode='deny';await exportButton.click();await page.getByRole('button',{name:'Record-level data · CSV'}).click();
  await expect(page.getByText('Access changed. Protected results and catalogs have been cleared.')).toBeVisible();await expect(page.locator('.analytics-result').getByRole('img')).toHaveCount(0);await expect(exportButton).toBeDisabled();
});
