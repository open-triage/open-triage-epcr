import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

test('all native encrypted snapshots wait for arrays, survive navigation and hash one completed value',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'android-encrypted-snapshot-'));
 try{
  const probe=join(directory,'SnapshotProbe.java');
  await writeFile(probe,`package org.opentriage.development;
public class SnapshotProbe {public static void main(String[] args)throws Exception{
 String completed="\\\"[]\\\"";String[] values={null,"null","\\\"null\\\"",completed};int[] calls={0};String[] script={null};
 String actual=AndroidEncryptedSnapshot.read(value->{script[0]=value;return values[Math.min(calls[0]++,values.length-1)];},"__records",5000);
 if(!actual.equals(completed)||calls[0]!=4)throw new AssertionError("Null and unfinished values cannot complete snapshots");
 System.out.println(AndroidEncryptedSnapshot.digest(actual));
 System.out.println(java.util.Base64.getEncoder().encodeToString(script[0].getBytes(java.nio.charset.StandardCharsets.UTF_8)));
 for(String missing:new String[]{null,"null","\\\"null\\\""}){try{AndroidEncryptedSnapshot.digest(missing);throw new IllegalStateException("Null snapshot accepted");}catch(AssertionError expected){}}
 try{AndroidEncryptedSnapshot.read(value->"null","__records",5);throw new IllegalStateException("Unfinished read accepted");}catch(AssertionError expected){}
}}`);
  const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
  const compiled=spawnSync(java('javac'),['-d',directory,resolve('android/app/src/androidTest/java/org/opentriage/development/AndroidEncryptedSnapshot.java'),probe],{encoding:'utf8',timeout:15000});assert.equal(compiled.status,0,compiled.stderr||String(compiled.error));
  const result=spawnSync(java('java'),['-cp',directory,'org.opentriage.development.SnapshotProbe'],{encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr||String(result.error));
  const [digest,encodedScript]=result.stdout.trim().split(/\r?\n/);assert.equal(digest,createHash('sha256').update('"[]"').digest('hex'));
  const script=Buffer.from(encodedScript,'base64').toString(),requests=[],queries=[];
  const context={window:{document:{id:1}},Uint8Array,indexedDB:{open(){const request={result:{objectStoreNames:{contains:()=>true},transaction:()=>({objectStore:()=>({getAll(){const query={};queries.push(query);return query;}})}),close(){}}};requests.push(request);return request;}}};
  assert.equal(runInNewContext(script,context),null);assert.equal(requests.length,1);requests[0].onsuccess();
  assert.equal(runInNewContext(script,context),null,'Pending IndexedDB reads must not masquerade as snapshots');
  context.window={document:{id:2}};
  assert.equal(runInNewContext(script,context),null);assert.equal(requests.length,2,'Navigation restarts the query');requests[1].onsuccess();
  queries[0].result=[{id:'stale',ciphertext:new Uint8Array([1]),nonce:new Uint8Array([2])}];queries[0].onsuccess();
  assert.equal(runInNewContext(script,context),null,'A callback from the old document cannot complete the new snapshot');
  queries[1].result=[{id:'current',ciphertext:new Uint8Array([3]),nonce:new Uint8Array([4])}];queries[1].onsuccess();
  assert.deepEqual(JSON.parse(runInNewContext(script,context)),[{id:'current',ciphertext:[3],nonce:[4]}]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
