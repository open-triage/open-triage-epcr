import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import path from 'node:path';
import {readFileSync} from 'node:fs';

for(const language of ['en','sv'])test(`validation summary hides empty groups in ${language}`,async({page})=>{
 const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':'{}'},plugins:[{name:'review-test-exports',setup(builder){builder.onLoad({filter:/\/app\/page\.tsx$/},args=>({contents:readFileSync(args.path,'utf8')+'\nexport {ReviewPanel,DispatchConflictList};',loader:'tsx'}));}}],stdin:{resolveDir:path.resolve(__dirname,'..'),loader:'tsx',contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';
 import{ReviewPanel,DispatchConflictList}from'./app/page';
 function App(){const[issues,setIssues]=useState(false);const findings=issues?[{id:'warning',severity:'warning',title:'Test warning',message:'Correct the value',category:'Clinical',reference:'test',acknowledged:false,target:{}}]:[];
 return <><button onClick={()=>setIssues(!issues)}>Toggle issues</button><ReviewPanel language="${language}" findings={findings} errors={[]} warnings={findings} noteBlockers={[]} groups={[{severity:'error'},{severity:'warning'}]} canFinish={!issues} validationClear={!issues} allValidationsPassed={!issues} signing={false} signError={null} onFinding={()=>{}} inlineEditor={()=>null} onWarning={()=>{}} onNoteBlocker={()=>{}} onSign={()=>{}} integrations={null} dispatchDifferences={<DispatchConflictList language="${language}" conflicts={issues?[{id:'conflict',disposition:null,dispatchRevision:1,elementId:'ePatient.02',clinicianValue:{kind:'absent'},dispatchValue:{kind:'absent'}}]:[]} onDispose={()=>{}}/>}/></>;}
 createRoot(document.getElementById('root')).render(<App/>);`}});
 await page.route('**/__validation-summary',route=>route.fulfill({contentType:'text/html',body:`<html><style>${readFileSync(path.resolve(__dirname,'../app/styles.css'),'utf8')}</style><body><div id="root"></div><script>${bundle.outputFiles[0]!.text}</script></body></html>`}));
 await page.goto('/__validation-summary');
 const passed=page.getByText(language==='en'?'✓ All validations passed':'✓ Alla valideringar godkända',{exact:true});
 await expect(passed).toBeVisible();
 await expect(page.locator('.review-empty')).toHaveCount(1);
 await expect(page.getByRole('heading',{level:2})).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('validations-passed.png')});
 await page.getByRole('button',{name:'Toggle issues'}).click();
 await expect(passed).toHaveCount(0);
 await expect(page.getByRole('heading',{level:2})).toHaveCount(2);
 await expect(page.getByText('Test warning',{exact:true})).toBeVisible();
 await expect(page.locator('.dispatch-conflicts')).toBeVisible();
 await expect(page.locator('.review-empty')).toHaveCount(0);
 await page.getByRole('button',{name:'Toggle issues'}).click();
 await expect(passed).toBeVisible();
 await expect(page.getByRole('heading',{level:2})).toHaveCount(0);
});
