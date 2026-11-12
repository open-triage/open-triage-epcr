import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
// These checks run before workspace compilation in Android CI. Resolve the real
// contracts source rather than depending on a developer's generated dist tree.
const compiled=await build({bundle:true,write:false,metafile:true,format:'iife',platform:'browser',plugins:[{name:'unbuilt-contracts',setup(builder){builder.onResolve({filter:/^@open-triage\/contracts$/},()=>({path:fileURLToPath(new URL('../packages/contracts/src/index.ts',import.meta.url))}));}}],stdin:{resolveDir:process.cwd(),contents:"import{participateInInstallationTransition,transitionInstallation}from './apps/web/app/installation-transition';globalThis.transitionFixture={participateInInstallationTransition,transitionInstallation};"}});
const source=compiled.outputFiles[0].text;
test('early transition regressions bundle actual workspace sources without generated build outputs',()=>{
 assert(Object.keys(compiled.metafile.inputs).some(path=>path.endsWith('packages/contracts/src/index.ts')));
 assert.deepEqual(Object.keys(compiled.metafile.inputs).filter(path=>/(?:packages|apps)\/[^/]+\/(?:dist|\.next|out)\//.test(path)),[]);
});
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function environment(marker){
 const values=new Map(marker?[['open-triage.installation-transition.v1',marker]]:[]),window=new EventTarget();window.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const queue=[];let held=false;
 const drain=()=>{if(held||!queue.length)return;const item=queue.shift();if(item.signal?.aborted){item.reject(new Error('aborted'));queueMicrotask(drain);return;}held=true;Promise.resolve().then(()=>item.work({})).then(item.resolve,item.reject).finally(()=>{held=false;drain();});};
 const context={window,navigator:{locks:{request:(_name,options,work)=>new Promise((resolve,reject)=>{queue.push({work,resolve,reject,signal:options.signal});queueMicrotask(drain);})}},Event,AbortController,crypto,console,setTimeout,clearTimeout};
 vm.runInNewContext(source,context);return{...context.transitionFixture,values,window};
}
for(const marker of [undefined,'enrollment:already-present'])test(`queued shared owner waits for held context ending (${marker??'event first'})`,async()=>{
 const f=environment(marker);let finish,ended=false,replaced=false,observedEnded;
 f.participateInInstallationTransition(async()=>{await new Promise(resolve=>finish=resolve);ended=true;});
 const transition=f.transitionInstallation(async()=>{observedEnded=ended;replaced=true;},'handoff');
 await flush();assert.equal(replaced,false);assert.equal(ended,false);finish();await transition;assert.equal(replaced,true);assert.equal(observedEnded,true);
});
test('a held participant rejection settles before replacement and does not deadlock or leak a rejection',async()=>{
 const f=environment();let finish,rejected=false,replaced=false,observedRejected;
 f.participateInInstallationTransition(async()=>{await new Promise(resolve=>finish=resolve);rejected=true;throw Error('old context cleanup failed');});
 const transition=f.transitionInstallation(async()=>{observedRejected=rejected;replaced=true;},'logout');await flush();assert.equal(replaced,false);finish();await transition;assert.equal(replaced,true);assert.equal(observedRejected,true);
});
test('unmount after ending never starts another authentication cleanup or prematurely releases its barrier',async()=>{
 const f=environment();let finish,calls=0,replaced=false;
 const unmount=f.participateInInstallationTransition(async()=>{calls++;await new Promise(resolve=>finish=resolve);});
 const transition=f.transitionInstallation(async()=>{replaced=true;},'logout');unmount();await flush();assert.equal(replaced,false);assert.equal(calls,1);finish();await transition;assert.equal(calls,1);
});
test('ordinary unmount settles keys without ending the valid personal session',async()=>{
 const f=environment();let calls=0;f.values.set('open-triage.clinician-session.v1','valid-login');const unmount=f.participateInInstallationTransition(async()=>{calls++;});unmount();await flush();assert.equal(calls,0);assert.equal(f.values.get('open-triage.clinician-session.v1'),'valid-login');
});
