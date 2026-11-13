import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { verifyPackagedPairing } from '../scripts/android/packaged-pairing.mjs';

test('packaged pairing check exercises real file and scanner validators, rejecting stale five-minute shells', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'packaged-pairing-'));
  try {
    const result = await build({bundle:true,write:false,format:'cjs',platform:'browser',
      stdin:{resolveDir:resolve('apps/web'),loader:'ts',contents:"export {parseAndroidPairing} from './app/android-pairing';export {parseAndroidPairingQr} from './app/android-scanner';"},
      plugins:[{name:'platform-registration',setup(builder){
        builder.onResolve({filter:/^@capacitor\/core$/},()=>({path:'capacitor',namespace:'fixture'}));
        builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const registerPlugin=()=>({});'}));
      }}]});
    const wrapper = stale => `var OpenTriageBootstrap=(()=>{const module={exports:{}};${result.outputFiles[0].text}
      const pairing=module.exports;return {mount(){},parseAndroidPairing:pairing.parseAndroidPairing,
      parseAndroidPairingQr:${stale ? '(value,now)=>{if(Date.parse(JSON.parse(value).expiresAt)>now+330000)throw Error("Invalid pairing artifact");return pairing.parseAndroidPairingQr(value,now);}' : 'pairing.parseAndroidPairingQr'}};})();`;
    await writeFile(join(directory,'native-bootstrap.js'),wrapper(false));
    assert.doesNotThrow(()=>verifyPackagedPairing(directory));
    await writeFile(join(directory,'native-bootstrap.js'),wrapper(true));
    assert.throws(()=>verifyPackagedPairing(directory), /30-minute server code/);
    await writeFile(join(directory,'native-bootstrap.js'),'var OpenTriageBootstrap={};');
    assert.throws(()=>verifyPackagedPairing(directory), /bootstrap is incomplete/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
