import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
test('native JSON helpers and their actual regression sources compile against Android checked signatures before the web/APK build',{
 skip:!sdk?'Android platform signature coverage requires ANDROID_HOME or ANDROID_SDK_ROOT with platform36; desktop JSON tests are not platform compile evidence':false,
},()=>{
 const jar=join(sdk,'platforms/android-36/android.jar');assert(existsSync(jar),'Install Android SDK platform36 before native validation; desktop org.json has incompatible unchecked exceptions');
 const directory=mkdtempSync(join(tmpdir(),'android-json-signatures-'));
 const javac=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin/javac'):'javac';
 // Resolve production helper dependencies as javac does in the actual Android build.
 const compile=files=>spawnSync(javac,['-classpath',jar,'-sourcepath',resolve('android/app/src/main/java'),'-d',directory,...files],{encoding:'utf8',timeout:30000});
 try{
  // Compile-only JUnit symbols: actual assertions execute later with real JUnit
  // in Gradle. Every JSON symbol here comes from the actual Android platform jar.
  const junit=join(directory,'Assert.java'),annotation=join(directory,'Test.java');
  writeFileSync(annotation,'package org.junit; public @interface Test {}');
  writeFileSync(junit,`package org.junit; public class Assert {
   public static void assertEquals(Object a,Object b){} public static void assertEquals(String m,Object a,Object b){}
   public static void assertFalse(boolean b){} public static void assertFalse(String m,boolean b){}
   public static void assertTrue(boolean b){} public static void assertTrue(String m,boolean b){}
   public static void assertNull(Object a){} public static void assertSame(Object a,Object b){}
   public interface ThrowingRunnable{void run()throws Throwable;}
   public static<T extends Throwable>T assertThrows(Class<T> c,ThrowingRunnable r){return null;}
  }`);
  const negative=join(directory,'UnhandledAndroidJson.java');writeFileSync(negative,'class UnhandledAndroidJson { Object value(){ return new org.json.JSONObject().put("key","value"); } }');
  const rejected=compile([negative]);assert.equal(rejected.error,undefined);assert.notEqual(rejected.status,0,'Negative control must reject desktop-only exception assumptions');assert.match(rejected.stderr,/unreported exception JSONException/);
  const production=resolve('android/app/src/main/java/org/opentriage/development'),tests=resolve('android/app/src/test/java/org/opentriage/development');
  const actual=compile([junit,annotation,...['TrustedConnection','NativeAuthentication','NativeAgencyHandoff','NativeApiCompatibility','NativePersonalContinuation'].map(name=>join(production,name+'.java')),...['NativeApiCompatibilityTest','NativePersonalContinuationTest'].map(name=>join(tests,name+'.java'))]);
  assert.equal(actual.error,undefined);assert.equal(actual.status,0,actual.stdout+actual.stderr);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
