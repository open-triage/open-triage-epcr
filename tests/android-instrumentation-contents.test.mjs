import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {dexClassDefinitions,expectedInstrumentationClasses,verifyInstrumentationClasses} from '../scripts/android/instrumentation-contents.mjs';
import {syntheticDex,writeInstrumentationSourceFixture} from './helpers/android-instrumentation-dex.mjs';

test('DEX completeness checks actual definitions across multidex, not referenced descriptor strings',()=>{
  const root=mkdtempSync(join(tmpdir(),'android-test-dex-'));
  try {
    const baseline=writeInstrumentationSourceFixture(root);
    const added='Lfixture/NewlyAddedTest;';
    writeFileSync(join(root,'android/app/src/androidTest/java/fixture/NewlyAddedTest.java'),'package fixture; public class NewlyAddedTest {}');
    assert.deepEqual([...expectedInstrumentationClasses(root,'release')].sort(),['Lfixture/BaselineTest;',added].sort());
    const stale=syntheticDex(['Lfixture/BaselineTest;'],[added]);
    assert(!dexClassDefinitions(stale).has(added));
    assert.throws(()=>verifyInstrumentationClasses(root,'release',{readDex:()=>[stale]}),/omitted source class Lfixture\/NewlyAddedTest/);
    assert.deepEqual(verifyInstrumentationClasses(root,'release',{readDex:()=>[baseline,syntheticDex([added])]}),{expectedClasses:2,definedClasses:2});
    const artifact=join(root,'private-signed-instrumentation.apk');
    verifyInstrumentationClasses(root,'release',{apk:artifact,readDex:path=>{assert.equal(path,artifact);return[baseline,syntheticDex([added])];}});
    assert.throws(()=>verifyInstrumentationClasses(root,'release',{readDex:()=>[]}),/DEX inputs are missing/);
    assert.throws(()=>verifyInstrumentationClasses(root,'release'),/Actual instrumentation APK is missing/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('variant and explicitly configured source directories cannot disappear from instrumentation acceptance',()=>{
  const root=mkdtempSync(join(tmpdir(),'android-test-variant-'));
  try {
    const baseline=writeInstrumentationSourceFixture(root);
    const directory=join(root,'android/app/src/androidTestRelease/java/fixture');mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'ReleaseOnly.java'),'package fixture; public interface ReleaseOnly {}');
    assert.equal(expectedInstrumentationClasses(root,'debug').size,1);
    assert.equal(expectedInstrumentationClasses(root,'release').size,2);
    assert.throws(()=>verifyInstrumentationClasses(root,'release',{readDex:()=>[baseline]}),/ReleaseOnly/);
    writeFileSync(join(root,'android/app/build.gradle'),'android { sourceSets { androidTest.java.srcDir "src/sharedTest/java" } }');
    assert.throws(()=>expectedInstrumentationClasses(root,'debug'),/source directory is missing/);
    mkdirSync(join(root,'android/app/src/sharedTest/java'),{recursive:true});
    assert.throws(()=>expectedInstrumentationClasses(root,'debug'),/no Java inputs/);
    rmSync(join(root,'android/app/src/androidTest'),{recursive:true});
    assert.throws(()=>expectedInstrumentationClasses(root,'release'),/source directory is missing/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('truncated DEX tables, invalid class indices and descriptor references reject before acceptance',()=>{
  const valid=syntheticDex(['Lfixture/Test;']);
  assert.throws(()=>dexClassDefinitions(Buffer.alloc(0)),/header is missing/);
  const truncated=Buffer.from(valid);truncated.writeUInt32LE(0xffffffff,100);assert.throws(()=>dexClassDefinitions(truncated),/table is truncated/);
  const wrongLength=Buffer.from(valid);wrongLength.writeUInt32LE(valid.length+1,32);assert.throws(()=>dexClassDefinitions(wrongLength),/length differs/);
  const wrongType=Buffer.from(valid);wrongType.writeUInt32LE(99,wrongType.readUInt32LE(100));assert.throws(()=>dexClassDefinitions(wrongType),/class type/);
  const wrongString=Buffer.from(valid);wrongString.writeUInt32LE(99,wrongString.readUInt32LE(68));assert.throws(()=>dexClassDefinitions(wrongString),/descriptor index/);
});
