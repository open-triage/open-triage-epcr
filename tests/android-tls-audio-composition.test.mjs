import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const runner=readFileSync(new URL('../scripts/android-emulator-test.mjs',import.meta.url),'utf8');
const tls=readFileSync(new URL('../scripts/android/tls-journey.mjs',import.meta.url),'utf8');
test('default acceptance covers saved audio and unfinished audio/TLS with one protected report seed per fixture',()=>{
 assert.match(runner,/runReportRecoveryJourney\(\{ root, fixture: fixtures\[0\][^\n]*audio: true[^\n]*beforeReconnect: runReassignmentTransition/);
 assert.doesNotMatch(runner,/runReportRecoveryJourney\(\{[^\n]*fixture: fixtures\[1\]/,'The second fixture belongs to the composed TLS/unfinished audio process-loss journey');
 assert.match(tls,/runReportRecoveryJourney\(\{root,fixture,adb,serial,run,api,audio:true,unsavedAudio:true,hooks:/);
 for(const hook of ['beforeProcessKill','beforeSessionWithdrawal','beforeReconnect'])assert(tls.includes(hook));
 const rotate=runner.indexOf('await runTlsJourney('),stop=runner.indexOf('await stopFixtureChild(children[1])'),oidc=runner.indexOf('await runOidcJourney(');
 const agency=runner.indexOf('await runAgencyHandoffJourney(');
 assert(rotate>0&&stop>rotate&&agency>stop&&oidc>agency,'TLS finishes before agency and OIDC reuse the target API port');
 assert.match(runner,/!process\.argv\.includes\('--agency-only'\)\) await runTlsJourney/,'Focused agency acceptance must not rerun the full TLS journey');
});
