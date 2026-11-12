import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {assertNativePdfInstrumentation} from '../scripts/android/pdf-journey.mjs';

test('native PDF acceptance requires all rendering/lifetime cases, not a partial or failed instrumentation run',()=>{
  assertNativePdfInstrumentation('Time: 1\n\nOK (3 tests)\nINSTRUMENTATION_CODE: -1\n');
  for(const value of ['OK (1 test)\n','OK (2 tests)\n','OK (0 tests)\n','FAILURES!!!\nTests run: 3, Failures: 1\n','OK (3 tests)\nINSTRUMENTATION_CODE: 0\n','OK (3 tests)\nINSTRUMENTATION_CODE: -1\nshortMsg=Process crashed.\n'])assert.throws(()=>assertNativePdfInstrumentation(value));
});
test('cold startup deletes only owned PDF files before constructing the new credentialed WebView',()=>{
 const root=resolve(import.meta.dirname,'..');const source=readFileSync(resolve(root,'android/app/src/main/java/org/opentriage/development/MainActivity.java'),'utf8');
 assert(source.indexOf('NativePdfSessions.cleanOrphans(this)')<source.indexOf('super.onCreate(state)'));
 const runner=readFileSync(resolve(root,'scripts/android-emulator-test.mjs'),'utf8');assert.match(runner,/await runNativePdfJourney\(/);
 const manifest=readFileSync(resolve(root,'android/app/src/main/AndroidManifest.xml'),'utf8');assert.match(manifest,/<activity android:name="\.NativePdfActivity"[^>]*android:exported="false"/);assert.match(manifest,/android:allowBackup="false"/);
});
