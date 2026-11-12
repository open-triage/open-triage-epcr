import assert from 'node:assert/strict';
import test from 'node:test';
import {scopedAgencyAdbdRoot} from '../scripts/android/scoped-adbd-root.mjs';
function fake({uid=2000,mapping,properties={},rootFails=false,unrootFails=false,partialBind=false,other=false,allowShellBind=false}={}){
 const calls=[];let current=uid,currentMapping=mapping;
 const execute=(_adb,args)=>{
  calls.push(args);const x=args[0]==='-s'?args.slice(2):args;const ok=stdout=>({status:0,stdout:String(stdout??'')});
  if(x[0]==='connect'||x[0]==='wait-for-device')return ok();
  if(x[0]==='shell'&&x[1]==='getprop')return ok(properties[x[2]]??({'ro.kernel.qemu':'1','ro.debuggable':'1','ro.build.type':'userdebug'}[x[2]]));
  if(x[0]==='shell'&&x[1]==='id')return ok(current);
  if(x[0]==='root'){if(!rootFails){current=0;currentMapping=undefined;}return ok();}
  if(x[0]==='unroot'){if(unrootFails)return{status:1};current=2000;currentMapping=undefined;return ok();}
  if(x[0]==='reverse'){
   if(x[1]==='--list')return ok((currentMapping?`device tcp:443 ${currentMapping}\n`:'')+(other?'device tcp:1234 tcp:1234\n':''));
   if(x[1]==='--remove'){currentMapping=undefined;return ok();}
   if(current!==0&&!allowShellBind)return{status:1,stderr:'cannot bind: Permission denied opaque-secret'};
   currentMapping=x[2];if(partialBind)return{status:1};return ok();
  }
  throw Error('Unexpected fake command');
 };
 return{execute,calls,state:()=>({uid:current,mapping:currentMapping})};
}
test('explicit disposable-emulator scope binds443 then restores shell daemon and listener absence',()=>{const f=fake();const restore=scopedAgencyAdbdRoot({adb:'adb',serial:'127.0.0.1:15564',allowRoot:true,execute:f.execute});assert.deepEqual(f.state(),{uid:0,mapping:undefined});restore();restore();assert.deepEqual(f.state(),{uid:2000,mapping:undefined});assert.equal(f.calls.filter(x=>x.includes('root')).length,1);assert.equal(f.calls.filter(x=>x.includes('unroot')).length,1);});
test('initial root and existing reverse listener are restored exactly without unrooting',()=>{const f=fake({uid:0,mapping:'tcp:1234'});const restore=scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute});assert.deepEqual(f.state(),{uid:0,mapping:'tcp:1234'});restore();assert.deepEqual(f.state(),{uid:0,mapping:'tcp:1234'});assert(!f.calls.some(x=>x.includes('unroot')));});
for(const properties of [{'ro.kernel.qemu':'0'},{'ro.debuggable':'0'},{'ro.build.type':'user'}])test(`physical or production authority is never elevated ${JSON.stringify(properties)}`,()=>{const f=fake({properties});assert.throws(()=>scopedAgencyAdbdRoot({adb:'adb',serial:'physical',allowRoot:true,execute:f.execute}),/isolated debuggable emulator/);assert(!f.calls.some(x=>x.includes('root')||x.includes('reverse')));});
test('missing optin fails before root or listener mutation',()=>{const f=fake();assert.throws(()=>scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:false,execute:f.execute}),/OPEN_TRIAGE_ANDROID_ALLOW/);assert(!f.calls.some(x=>x.includes('root')||x.includes('tcp:9444')));});
test('unrelated listeners prevent daemon restart without touching their state',()=>{const f=fake({other:true});assert.throws(()=>scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute}),/Other reverse listeners/);assert(!f.calls.some(x=>x.includes('root')));});
test('unavailable root is bounded, sanitized and restores original authority',()=>{const f=fake({rootFails:true});assert.throws(()=>scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute}),/within its bound/);assert.deepEqual(f.state(),{uid:2000,mapping:undefined});assert.equal(f.calls.filter(x=>x.includes('wait-for-device')).length,4);});
test('failed partial bind cleans listener and original daemon state',()=>{const f=fake({partialBind:true});assert.throws(()=>scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute}),/routing command failed/);assert.deepEqual(f.state(),{uid:2000,mapping:undefined});});
test('cleanup failures cannot report acceptance success',()=>{const f=fake({unrootFails:true});const restore=scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute});assert.throws(restore,/cleanup failed/);});

test('a shell daemon with existing bind permission needs no elevation or listener reset',()=>{const f=fake({allowShellBind:true,other:true,mapping:'tcp:1234'});const restore=scopedAgencyAdbdRoot({adb:'adb',serial:'leased',allowRoot:true,execute:f.execute});restore();assert.deepEqual(f.state(),{uid:2000,mapping:'tcp:1234'});assert(!f.calls.some(x=>x.includes('root')||x.includes('unroot')));});
