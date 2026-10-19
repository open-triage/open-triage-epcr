import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
/** Real database/service/browser journey shared by the two independently scoped integrations. */
export async function credentialLifecycle({kind,service,token,page,query,otherToken,medicToken,assets}){
 const get=()=>service.get(token);
 const test=()=>get().then(view=>service.test(token,{expectedRevision:view.draft.revision}));
 const activate=view=>service.activate(token,{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,testId:view.tests.find(t=>t.revision===view.draft.revision).id});
 const healthy=kind==='eps'?service.connectivity:undefined;
 if(kind==='eps')service.connectivity=async()=>true;
 let view=await activate(await test());const original=view.active;
 await assert.rejects(service.rotateCredential(otherToken,{expectedRevision:original.revision,replacementSecret:'fictional-foreign-secret'}));
 await assert.rejects(service.rotateCredential(medicToken,{expectedRevision:original.revision,replacementSecret:'fictional-denied-secret'}));
 view=await service.rotateCredential(token,{expectedRevision:view.draft.revision,replacementSecret:'fictional-replacement-secret'});
 assert.deepEqual(view.draft.mapping,original.mapping,'rotation preserves canonical bytes');assert.equal(view.active.revision,original.revision);assert.equal(view.credentialReplacement,true);
 const oldKeys=process.env.OIDC_CREDENTIAL_KEYS_JSON;
 if(kind==='eps')service.connectivity=async()=>false;else process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
 try{for(let n=0;n<22;n++)view=await test();}finally{process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;if(kind==='eps')service.connectivity=async()=>true;}
 assert.equal(view.draftHealth,'failed');assert.equal(view.activeHealth,'healthy','working active health survives more than twenty failed draft tests');
 await assert.rejects(activate(view));assert.equal((await get()).active.revision,original.revision);
 const tested=await test();
 view=await service.rotateCredential(token,{expectedRevision:tested.draft.revision,replacementSecret:'fictional-current-secret'});
 await assert.rejects(activate(tested),'stale test and state cannot activate another replacement');
 view=await activate(await test());
 assert.deepEqual(view.active.mapping,original.mapping);assert.equal(view.credentialReplacement,false);
 if(kind==='cos'){
  const [compatible]=await query('select app_identity.cos_configuration_compatible($1,$2,$3) compatible',[view.groupId,original.revision,view.active.revision]);assert.equal(compatible.compatible,true);
 }
 const prior=view.active;
 view=await service.activate(token,{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision},true);
 view=await service.rotateCredential(token,{expectedRevision:view.draft.revision,replacementSecret:'fictional-paused-replacement'});
 assert.equal(view.active,null);assert.equal(view.pausedRevision,prior.revision);assert.equal(view.pausedHealth,'healthy');assert.equal(view.credentialReplacement,true);
 // Import the original package while paused. It is still an untested draft; resume
 // selects the previous tested activation rather than this latest imported revision.
 const file=(await service.files(token)).find(file=>file.mapping?.sha256===original.mapping.sha256);
 view=await service.importFile(token,{expectedRevision:view.draft.revision,file:file.file});const imported=view.draft;
 view=await service.resume(token,{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,expectedPausedRevision:prior.revision});
 assert.deepEqual(view.active,prior);assert.deepEqual(view.draft,imported);assert.equal(view.draftHealth,'untested');
 await assert.rejects(service.resume(token,{expectedRevision:view.draft.revision,expectedStateRevision:view.stateRevision,expectedPausedRevision:prior.revision}));
 // Browser saves an exact credential-only replacement, tests it and activates it.
 await page.setViewportSize({width:390,height:844});await page.reload();const label=kind==='eps'?'Replacement team credential':'Replacement COS credential';
 await page.getByLabel(label,{exact:true}).fill('fictional-browser-replacement');
 await page.getByRole('button',{name:'Save credential replacement only',exact:true}).click();
 await page.waitForFunction(revision=>document.body.textContent.includes(`Draft revision: ${revision}`),imported.revision+1);
 assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'');
 const testButton=page.getByRole('button',{name:kind==='eps'?'Test read-only connection':'Test simulator configuration',exact:true});
 if(kind==='eps')service.connectivity=async()=>false;else process.env.OIDC_CREDENTIAL_KEYS_JSON=JSON.stringify({'1':randomBytes(32).toString('base64')});
 try{const failed=page.waitForResponse(response=>response.url().endsWith('/test'));await testButton.click();await failed;
  assert.equal((await get()).draftHealth,'failed');assert.equal((await get()).active.revision,prior.revision);
 }finally{process.env.OIDC_CREDENTIAL_KEYS_JSON=oldKeys;if(kind==='eps')service.connectivity=async()=>true;}
 const passed=page.waitForResponse(response=>response.url().endsWith('/test'));await testButton.click();await passed;

 await page.getByRole('button',{name:kind==='eps'?'Activate EPS':'Activate COS simulator',exact:true}).waitFor({state:'visible'});
 await page.getByRole('button',{name:kind==='eps'?'Activate EPS':'Activate COS simulator',exact:true}).click();
 await page.waitForFunction(revision=>document.body.textContent.includes(`Active revision: ${revision}`),imported.revision+1);
 await page.getByRole('button',{name:kind==='eps'?'Deactivate EPS':'Deactivate COS',exact:true}).click();
 await page.getByRole('button',{name:'Resume previous activation',exact:true}).click();
 await page.waitForFunction(revision=>document.body.textContent.includes(`Active revision: ${revision}`),imported.revision+1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mkdir('/tmp/hospital-023-preview',{recursive:true});await page.screenshot({path:`/tmp/hospital-023-preview/${kind}-mobile.png`,fullPage:true});
 view=await get();assert.doesNotMatch(JSON.stringify(view),/fictional-(?:replacement|current|paused|browser)|encrypted_credential|ciphertext/);
 assert.doesNotMatch(assets,/fictional-(?:replacement|current|paused|browser)/,'no saved secret can be embedded in browser bundle');
 const mapping=await service.export(token,String(view.draft.revision));assert.doesNotMatch(JSON.stringify(mapping),/credential|secret|ciphertext|keyScope/i);
 const events=await query("select action,details from app_identity.configuration_event where organization_id=$1 and details->>'integration'=$2",[view.groupId,kind]);
 assert.ok(events.some(e=>e.action==='hospital.credential_replace'));assert.ok(events.some(e=>e.action==='hospital.resume'));assert.doesNotMatch(JSON.stringify(events),/fictional-(?:replacement|current|paused|browser)|ciphertext/);
 if(kind==='eps')service.connectivity=healthy;
}
