import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
test('actual bundled document resolver rejects global-index fallback and unsafe navigation before an APK build',()=>{
 const directory=mkdtempSync(join(tmpdir(),'android-static-routes-')),binary=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  const source=join(directory,'StaticRoutes.java');writeFileSync(source,`package org.opentriage.development;
import java.util.Set;import java.util.concurrent.atomic.AtomicInteger;
public class StaticRoutes {
 static void check(boolean value){if(!value)throw new AssertionError("Static document crossed its packaged route boundary");}
 public static void main(String[]args){
  var assets=Set.of("public/review-call/index.html","public/enroll/index.html","public/404/index.html");
  for(String path:new String[]{"/review-call/","/enroll"}){var route=NativeStaticRoutes.resolve("https://localhost"+path+"?report=a%2Fb&language=sv","GET",true,assets::contains);check(route.path().equals(path+(path.endsWith("/")?"":"/")+"index.html"));check(!route.notFound());check(!route.path().equals("/index.html"));}
  var reads=new AtomicInteger();for(String url:new String[]{"https://foreign.test/review-call/","http://localhost/enroll/","https://user@localhost/enroll/","https://localhost:443/enroll/","https://localhost/a/../enroll/","https://localhost/%2e%2e/enroll/","https://localhost/enroll%2findex.html","https://localhost//enroll/","https://localhost/enroll/."}){var route=NativeStaticRoutes.resolve(url,"GET",true,path->{reads.incrementAndGet();return true;});check(route!=null&&route.path()==null&&route.notFound());}check(reads.get()==0);
  check(NativeStaticRoutes.resolve("https://localhost/enroll/","POST",true,assets::contains).path()==null);check(NativeStaticRoutes.resolve("https://localhost/enroll/","GET",false,assets::contains)==null);
  check(NativeStaticRoutes.resolve("https://localhost/","GET",true,assets::contains)==null);check(NativeStaticRoutes.resolve("https://localhost/_next/chunk.js","GET",true,assets::contains)==null);
  var missing=NativeStaticRoutes.resolve("https://localhost/unknown/","GET",true,assets::contains);check(missing.notFound()&&missing.path().equals("/404/index.html"));check(NativeStaticRoutes.resolve("https://localhost/unknown/","GET",true,path->false).path()==null);
 }
}`);
  for(const[command,args]of[[binary('javac'),['-d',directory,resolve('android/app/src/main/java/org/opentriage/development/NativeStaticRoutes.java'),source]],[binary('java'),['-cp',directory,'org.opentriage.development.StaticRoutes']]]){const result=spawnSync(command,args,{encoding:'utf8',timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+result.stderr);}
 }finally{rmSync(directory,{recursive:true,force:true});}
});
