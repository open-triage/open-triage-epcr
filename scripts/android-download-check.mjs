import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { approvedAndroidReleaseUrl, parseAndroidReleaseDescriptor } from '@open-triage/contracts/android-release';
import { verifyAndroidArtifact } from '@open-triage/contracts/android-artifact';
import catalog from '@open-triage/contracts/config/android-releases.json' with {type:'json'};
import { verifyApkSignature } from './android/apk-signature.mjs';
import { verifyApkMetadata } from './android/release-contract.mjs';

const root=resolve(import.meta.dirname,'..');
const args=process.argv.slice(2), options={};
for(let index=0;index<args.length;index++){
 const key=args[index];assert(!Object.hasOwn(options,key),'Duplicate download check option');
 if(key==='--install')options[key]=true;
 else if(['--release','--serial'].includes(key)&&args[index+1]&&!args[index+1].startsWith('--'))options[key]=args[++index];
 else throw new Error('Use --release <approved-tag> [--install --serial <leased-emulator>]');
}
const selected=catalog.releases.find(value=>value.tag===options['--release']);
assert(selected,'Select an explicitly approved release tag');
const descriptor=parseAndroidReleaseDescriptor(selected.descriptor);
assert.equal(selected.downloadUrl,approvedAndroidReleaseUrl(selected.tag,descriptor));
assert.equal(descriptor.applicationId,catalog.signingIdentity.applicationId);assert.equal(descriptor.certificateSha256,catalog.signingIdentity.certificateSha256);
const sdk=process.env.ANDROID_HOME??process.env.ANDROID_SDK_ROOT;assert(sdk,'ANDROID_HOME is required for real APK metadata/signature verification');
const destination=join(root,'.local/android-download-validation',String(descriptor.versionCode));await mkdir(destination,{recursive:true,mode:0o700});
const staging=await mkdtemp(join(destination,'.verify-')), temporary=join(staging,'download.apk');
const file=await open(temporary,'wx',0o600);
let installed=false;
try{
 await verifyAndroidArtifact(selected.downloadUrl,descriptor.apkBytes,descriptor.apkSha256,fetch,async bytes=>file.writeFile(bytes));
 await file.sync();await file.close();
 assert.equal(createHash('sha256').update(await readFile(temporary)).digest('hex'),descriptor.apkSha256,'Downloaded bytes must match the approved digest');
 const metadata=execFileSync(join(sdk,'build-tools/36.0.0/aapt'),['dump','badging',temporary],{encoding:'utf8',timeout:30000});
 verifyApkMetadata(metadata,verifyApkSignature(sdk,temporary),descriptor);
 const apk=join(destination,descriptor.artifact);await rename(temporary,apk);
 if(options['--install']){
  const serial=options['--serial'];assert(serial,'An explicit leased emulator serial is required');const adb=join(sdk,'platform-tools/adb');
  const command=values=>execFileSync(adb,['-s',serial,...values],{encoding:'utf8',timeout:60000});
  assert.equal(command(['shell','getprop','ro.kernel.qemu']).trim(),'1','Install acceptance is restricted to an explicitly leased disposable emulator');
  assert.equal(command(['shell','getprop','sys.boot_completed']).trim(),'1');
  const result=spawnSync(adb,['-s',serial,'install','-r',apk],{encoding:'utf8',timeout:90000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Success/);
  const details=command(['shell','dumpsys','package',descriptor.applicationId]);
  assert.match(details,new RegExp(`versionCode=${descriptor.versionCode}\\b`));assert(command(['shell','pm','path',descriptor.applicationId]).trim().startsWith('package:'));
  command(['shell','am','force-stop',descriptor.applicationId]);installed=true;
 }
 const evidence={status:'passed',releaseTag:selected.tag,downloadUrl:selected.downloadUrl,descriptor,apkSha256:descriptor.apkSha256,signatureVerified:true,metadataVerified:true,installed};
 await writeFile(join(destination,installed?'download-install-evidence.json':'download-evidence.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:'passed',releaseTag:selected.tag,versionCode:descriptor.versionCode,apkSha256:descriptor.apkSha256,signatureVerified:true,installed}));
}finally{await file.close().catch(()=>{});await rm(staging,{recursive:true,force:true});}
