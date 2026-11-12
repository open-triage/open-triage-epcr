import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const root=resolve(import.meta.dirname,'..');
test('captured native crash maps to official Chromium reply-proxy JNI method',()=>{
  const evidence=JSON.parse(readFileSync(join(root,'tests/fixtures/android-webview-reply-crash.json'),'utf8'));
  const descriptor=`${evidence.className}/${evidence.methodName}`.replaceAll('_','_1').replaceAll('/','_').replaceAll('$','_00024');
  const hash=createHash('md5').update(descriptor).digest('base64').replaceAll('+','$').replaceAll('/','_');
  assert.equal(`Java_J_N_${('M'+hash).slice(0,8)}`,evidence.symbol);
});
test('actual Java gate prevents the Chromium worker-check/UI-pointer race before Android builds',()=>{
  const temporary=mkdtempSync(join(tmpdir(),'android-native-reply-'));
  const java=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin','java'):'java';
  const javac=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin','javac'):'javac';
  const source=`package org.opentriage.development;
import java.util.*;
public class ReplyRace {
 static final ArrayDeque<Runnable> queue=new ArrayDeque<>();
 static boolean ui=false, current=true;static long pointer=1;static int delivered=0,dropped=0;
 // Faithful Chromium109 precheck then deferred mutable pointer read.
 static void chromiumReply(){if(pointer==0)return;Runnable nativeCall=()->{if(pointer==0)throw new NullPointerException("native reply proxy");delivered++;};if(ui)nativeCall.run();else queue.add(nativeCall);}
 static void drain(){ui=true;try{while(!queue.isEmpty())queue.remove().run();}finally{ui=false;}}
 public static void main(String[]args){
  chromiumReply();pointer=0;boolean reproduced=false;try{drain();}catch(NullPointerException expected){reproduced=true;}if(!reproduced)throw new AssertionError("missing original race");
  pointer=1;NativeReplyGate gate=new NativeReplyGate(queue::add,()->ui,()->{if(!ui)throw new AssertionError("off UI realm check");return current;});
  gate.dispatch(ReplyRace::chromiumReply,()->dropped++);drain();if(delivered!=1)throw new AssertionError("live reply lost");
  for(int i=0;i<3;i++)gate.dispatch(ReplyRace::chromiumReply,()->dropped++);
  ui=true;gate.close();pointer=0;ui=false;drain();if(dropped!=3||delivered!=1)throw new AssertionError("late success/error/event escaped");
  gate.dispatch(ReplyRace::chromiumReply,()->dropped++);drain();if(dropped!=4)throw new AssertionError("shutdown rejection escaped");
  System.out.println("original race reproduced; live and destroyed replies verified");
 }
}`;
  try {
    const path=join(temporary,'ReplyRace.java');writeFileSync(path,source);
    for(const [command,args] of [[javac,['-d',temporary,join(root,'android/app/src/main/java/org/opentriage/development/NativeReplyGate.java'),path]],[java,['-cp',temporary,'org.opentriage.development.ReplyRace']]]) {
      const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
    }
  } finally {rmSync(temporary,{recursive:true,force:true});}
});
