import assert from 'node:assert/strict';
const testOnlyPaths=new Set([
 'scripts/android/upgrade-harness-source.mjs',
 'scripts/android/upgrade-policy-fixture.mjs',
 'scripts/android/report-journey.mjs',
 'scripts/android/journey-cleanup.mjs',
 'tests/android-journey-cleanup.test.mjs',
 'scripts/android-release-upgrade.mjs',
 'android/app/src/androidTest/java/org/opentriage/development/ReportRecoveryJourneyTest.java',
 'android/app/src/androidTest/java/org/opentriage/development/HistoricalUpgradePreparation.java',
 'tests/android-upgrade-preparation.test.mjs',
 'android/app/src/androidTest/java/org/opentriage/development/UpgradePolicyTransportTest.java',
 'android/app/src/androidTest/java/org/opentriage/development/UpgradeSessionProof.java',
]);
export function assertUpgradeHarnessSource({artifactSource,testSource,changedPaths}) {
 assert.match(artifactSource,/^[a-f0-9]{40}$/);assert.match(testSource,/^[a-f0-9]{40}$/);
 assert(Array.isArray(changedPaths));
 if(artifactSource===testSource)assert.equal(changedPaths.length,0,'Identical artifact/test source must have no differences');
 else assert(changedPaths.length>0 && changedPaths.every(path=>testOnlyPaths.has(path)),
   'A separately versioned upgrade harness may change only the explicit test-only paths, never production app/API/UI/contracts');
}

/** A prior production installation is evidence, never disposable setup state. */
export function assertFreshUpgradeTarget(result) {
 assert(!result.error&&!result.signal,'Cannot establish production package absence');
 assert.equal(String(result.stdout??'').trim(),'','Refusing to replace or reset an existing production installation; use a fresh isolated emulator');
 assert.equal(String(result.stderr??'').trim(),'','Cannot establish production package absence');
 assert.equal(result.status,1,'Upgrade acceptance requires a fresh isolated emulator with no production package');
}
