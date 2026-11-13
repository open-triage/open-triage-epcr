import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export async function buildNativeBootstrap(output = fileURLToPath(new URL('../native-out', import.meta.url))) {
  const web = fileURLToPath(new URL('..', import.meta.url));
  await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
  const result = await build({ metafile: true, absWorkingDir: web, entryPoints: ['bootstrap/native-bootstrap.tsx'], outfile: join(output, 'native-bootstrap.js'),
    bundle: true, platform: 'browser', format: 'iife', globalName: 'OpenTriageBootstrap', jsx: 'automatic', minify: true,
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env.NEXT_PUBLIC_API_URL': JSON.stringify('same-origin'),
      'process.env.NEXT_PUBLIC_BASE_PATH': JSON.stringify(''), 'process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION': JSON.stringify('false'),
      'process.env': JSON.stringify({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'same-origin' }) } });
  const clinical = ['app/page.tsx', 'components/clinician-session-gate.tsx', 'components/encounter-timeline.tsx'];
  assert(!Object.keys(result.metafile.inputs).some(file => clinical.some(path => file.endsWith(path))), 'The native bootstrap must not bundle clinical screens');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content"><link rel="stylesheet" href="/native-bootstrap.css"><script defer src="/native-bootstrap.js"></script></head><body><div id="native-bootstrap"></div></body></html>';
  for (const route of ['', '404', 'enroll', 'review-call', 'admin-preview']) {
    await mkdir(join(output, route), { recursive: true }); await writeFile(join(output, route, 'index.html'), html);
  }
  await build({ absWorkingDir: web, entryPoints: ['service-worker/service-worker.ts'], outfile: join(output, 'sw.js'), bundle: true, format: 'iife', minify: true,
    define: { __OPEN_TRIAGE_BUILD_SHA__: JSON.stringify('native-bootstrap') } });
  await copyFile(join(web, 'public/manifest.webmanifest'), join(output, 'manifest.webmanifest'));
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildNativeBootstrap();
