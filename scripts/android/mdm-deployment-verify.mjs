import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {approvedMdmRelease, verifyMdmDownload, headwindDeploymentTarget, headwindInstalledInventory} from './mdm-deployment-contract.mjs';

// Snapshot inputs are private actual-console/Android observations, not fixtures or acceptance declarations.
const usage = 'Use --release <approved-tag> --mdm-origin <origin> --configuration <json> --device <json> --installed <json> --not-before <epoch-ms> --output <new-json>';
const options = {}, allowed = ['--release', '--mdm-origin', '--configuration', '--device', '--installed', '--not-before', '--output'];
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  assert(allowed.includes(key) && !Object.hasOwn(options, key) && value && !value.startsWith('--'), usage);
  options[key] = value;
}
assert(allowed.every(key => options[key]), usage);
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const catalog = await json(new URL('../../packages/contracts/config/android-releases.json', import.meta.url));
const selected = approvedMdmRelease(catalog, options['--release']);
const configuration = await json(resolve(options['--configuration']));
const device = await json(resolve(options['--device']));
const installed = await json(resolve(options['--installed']));
const application = configuration.applications.find(value => value.pkg === selected.descriptor.applicationId && String(value.action) === '1');
assert(application, 'The actual selected configuration must target the approved clinical app');
const target = headwindDeploymentTarget(configuration, device, selected.descriptor, application.url);
const inventory = headwindInstalledInventory(device, selected.descriptor, installed, Number(options['--not-before']));
const artifact = await verifyMdmDownload(application.url, options['--mdm-origin'], selected.descriptor);
const result = {schemaVersion: 1, status: 'verified-deployment-observations', observedAt: new Date().toISOString(),
  releaseTag: selected.tag, descriptor: selected.descriptor, target, inventory, artifact,
  scope: 'Artifact bytes, actual configured target and supplied current inventory observations; clinical/policy/upgrade acceptance is separate.'};
await writeFile(resolve(options['--output']), JSON.stringify(result, null, 2) + '\n', {flag: 'wx', mode: 0o600});
console.log(JSON.stringify({status: result.status, releaseTag: selected.tag, versionCode: selected.descriptor.versionCode, apkSha256: artifact.apkSha256}));
