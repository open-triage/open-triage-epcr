import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

test('native clicks await enabled controls and reject a control disabled or removed before delivery',()=>{
 const directory=mkdtempSync(join(tmpdir(),'android-ui-input-'));
 try {
  const junit=join(directory,'org/junit/Assert.java'),json=join(directory,'org/json/JSONObject.java'),probe=join(directory,'org/opentriage/development/ClickProbe.java');
  for(const path of [join(directory,'org/junit'),join(directory,'org/json'),join(directory,'org/opentriage/development')])mkdirSync(path,{recursive:true});
  writeFileSync(junit,'package org.junit;public class Assert{public static void assertEquals(String message,String expected,String actual){if(!expected.equals(actual))throw new AssertionError(message);}}');
  writeFileSync(json,'package org.json;public class JSONObject{public static String quote(String value){throw new UnsupportedOperationException("Pairing is outside this click probe");}}');
  writeFileSync(probe,`package org.opentriage.development;
public class ClickProbe {public static void main(String[] args)throws Exception{
 String[] scripts=new String[2];
 AndroidUiInput.clickEnabled(script->{scripts[1]=script;return "true";},expression->{scripts[0]=expression;},"document.querySelector('#new-work')");
 for(String script:scripts)System.out.println(java.util.Base64.getEncoder().encodeToString(script.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
 try{AndroidUiInput.clickEnabled(script->"false",expression->{},"document.querySelector('#new-work')");throw new IllegalStateException("Late disabled control was accepted");}catch(AssertionError expected){System.out.println("rejected");}
}}`);
  const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  const compiled=spawnSync(java('javac'),['-d',directory,junit,json,resolve('android/app/src/androidTest/java/org/opentriage/development/AndroidUiInput.java'),probe],{encoding:'utf8',timeout:15000});
  assert.equal(compiled.status,0,compiled.stderr||String(compiled.error));
  const executed=spawnSync(java('java'),['-cp',directory,'org.opentriage.development.ClickProbe'],{encoding:'utf8',timeout:10000});
  assert.equal(executed.status,0,executed.stderr||String(executed.error));
  const [waiting,delivery,rejected]=executed.stdout.trim().split(/\r?\n/);assert.equal(rejected,'rejected');
  const readyScript=Buffer.from(waiting,'base64').toString(),clickScript=Buffer.from(delivery,'base64').toString();
  let clicks=0,button;
  const control=({disabled=false,visible=true,connected=true,ariaDisabled=false}={})=>({isConnected:connected,offsetParent:visible?{}:null,matches:selector=>{assert.equal(selector,':disabled');return disabled;},getAttribute:name=>name==='aria-disabled'&&ariaDisabled?'true':null,click:()=>{clicks++;}});
  const context={document:{querySelector:selector=>{assert.equal(selector,'#new-work');return button;}}};
  for(const state of [null,{disabled:true},{visible:false},{connected:false},{ariaDisabled:true}]){
   button=state===null?null:control(state);assert.equal(vm.runInNewContext(readyScript,context),false);assert.equal(vm.runInNewContext(clickScript,context),false);assert.equal(clicks,0);
  }
  button=control();assert.equal(vm.runInNewContext(readyScript,context),true);
  button=control({disabled:true});assert.equal(vm.runInNewContext(clickScript,context),false);assert.equal(clicks,0);
  button=control();assert.equal(vm.runInNewContext(readyScript,context),true);
  button=null;assert.equal(vm.runInNewContext(clickScript,context),false);assert.equal(clicks,0);
  button=control();assert.equal(vm.runInNewContext(clickScript,context),true);assert.equal(clicks,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
