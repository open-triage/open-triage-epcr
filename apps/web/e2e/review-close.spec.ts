import {expect,test} from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';

for (const button of ['Close report','Close full report']) test(`standalone ${button} returns to queue when browser refuses window close`,async({page})=>{
  test.skip(process.env.OPEN_TRIAGE_E2E_SERVER_MODE !== 'true','Requires server-backed app');
  const reportId='11111111-1111-4111-8111-111111111111';
  const session={csrfToken:'fixture',user:{id:'viewer',displayName:'Reviewer'},organization:{id:'organization',name:'Example'},
    capabilities:['review:self'],workspaceAvailable:true,expiresAt:'2099-01-01T00:00:00Z'};
  await page.addInitScript(stored=>{
    localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored));
    window.close=()=>{};
  },session);
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/installation')return route.fulfill({json:{settings}});
    if(path==='/api/sessions/current')return route.fulfill({json:session});
    if(path===`/api/review/reports/${reportId}`)return route.fulfill({json:{id:reportId,identifying:true,groups:[],values:[],notes:[],reviewItems:[],amendmentSequence:0}});
    if(path==='/api/review/queue')return route.fulfill({json:{dataset:'synthetic',page:1,pageSize:25,total:0,items:[],asOf:new Date().toISOString()}});
    if(path==='/api/review/outcomes'||path==='/api/review/eligible-reviewers')return route.fulfill({json:[]});
    return route.fulfill({status:404});
  });
  await page.goto(`/review-call?report=${reportId}&dataset=synthetic`);
  await expect(page.locator('#review-full-report .review-report')).toBeVisible();
  const close=button==='Close report'?page.locator('.review-heading').getByRole('button',{name:button,exact:true}):page.locator('#review-full-report').getByRole('button',{name:button,exact:true});
  await close.click();
  await expect(page.locator('#review-full-report')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Review queue',exact:true})).toBeVisible();
  await expect(page.locator('#review-inspector')).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.session-bar')).toBeVisible();
  await expect(page.locator('.session-bar')).toContainText('Reviewer');
  await expect(page.locator('.session-bar').getByRole('button',{name:'Review',exact:true})).toHaveAttribute('aria-pressed','true');
});
