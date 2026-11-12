import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {assertNativePdfInstrumentation,assertNativePdfSafInstrumentation} from '../scripts/android/pdf-journey.mjs';

test('native PDF acceptance requires all rendering/lifetime cases, not a partial or failed instrumentation run',()=>{
  assertNativePdfInstrumentation('Time: 1\n\nOK (3 tests)\nINSTRUMENTATION_CODE: -1\n');
  for(const value of ['OK (1 test)\n','OK (2 tests)\n','OK (0 tests)\n','FAILURES!!!\nTests run: 3, Failures: 1\n','OK (3 tests)\nINSTRUMENTATION_CODE: 0\n','OK (3 tests)\nINSTRUMENTATION_CODE: -1\nshortMsg=Process crashed.\n'])assert.throws(()=>assertNativePdfInstrumentation(value));
});
test('native PDF save acceptance requires both real picker cases and successful completion',()=>{
 assertNativePdfSafInstrumentation('OK (2 tests)\nINSTRUMENTATION_CODE: -1\n');
 for(const value of ['OK (1 test)\nINSTRUMENTATION_CODE: -1\n','OK (2 tests)\nINSTRUMENTATION_CODE: 0\n','OK (2 tests)\nINSTRUMENTATION_CODE: -1\nshortMsg=Process crashed.\n'])assert.throws(()=>assertNativePdfSafInstrumentation(value));
});
test('actual Java PDF authority cannot survive clock rollback, frozen wall time or a longer refresh before an Android build',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'android-pdf-lifetime-'));
 const binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 const root=resolve(import.meta.dirname,'..');
 try {
  const source=join(temporary,'PdfClock.java');writeFileSync(source,`package org.opentriage.development;
import java.util.concurrent.atomic.AtomicLong;
public class PdfClock {
 static void check(boolean value){if(!value)throw new AssertionError("PDF lifetime escaped original authority");}
 public static void main(String[]args){
  var wall=new AtomicLong(1000);var elapsed=new AtomicLong(10);
  var lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);
  check(lease.current());lease.shorten(20,1000);elapsed.set(110);check(!lease.current());
  elapsed.set(10);check(!lease.current());
  lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);check(lease.current());wall.set(999);check(!lease.current());wall.set(1000);check(!lease.current());
  lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);wall.set(1100);check(!lease.current());
  wall.set(1000);lease=new NativePdfLifetime(1000,10,100,wall::get,elapsed::get);lease.shorten(10,40);elapsed.set(50);check(!lease.current());
 }
}`);
  for(const [command,args] of [[binary('javac'),['-d',temporary,join(root,'android/app/src/main/java/org/opentriage/development/NativePdfLifetime.java'),source]],[binary('java'),['-cp',temporary,'org.opentriage.development.PdfClock']]]) {
   const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);
  }
 } finally {rmSync(temporary,{recursive:true,force:true});}
});
test('cold startup deletes only owned PDF files before constructing the new credentialed WebView',()=>{
 const root=resolve(import.meta.dirname,'..');const source=readFileSync(resolve(root,'android/app/src/main/java/org/opentriage/development/MainActivity.java'),'utf8');
 assert(source.indexOf('NativePdfSessions.cleanOrphans(this)')<source.indexOf('super.onCreate(state)'));
 const runner=readFileSync(resolve(root,'scripts/android-emulator-test.mjs'),'utf8');assert.match(runner,/await runNativePdfJourney\(/);
 const manifest=readFileSync(resolve(root,'android/app/src/main/AndroidManifest.xml'),'utf8');assert.match(manifest,/<activity android:name="\.NativePdfActivity"[^>]*android:exported="false"/);assert.match(manifest,/android:allowBackup="false"/);
});
