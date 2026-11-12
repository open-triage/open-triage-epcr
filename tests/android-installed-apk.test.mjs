import assert from 'node:assert/strict';
import test from 'node:test';
import { singleInstalledBaseApkPath } from '../scripts/android/installed-apk.mjs';

test('observed modern randomized and older installed base APK paths are accepted verbatim', () => {
  for (const path of [
    '/data/app/~~kM0-A_b==/org.opentriage.android-X_y+z==/base.apk',
    '/data/app/org.opentriage.android-AbC123==/base.apk',
    '/data/app/random-prefix/pkg-random==/base.apk',
  ]) assert.equal(singleInstalledBaseApkPath(`package:${path}\r\n`), path);
});

test('split, ambiguous, unsafe or non-user installation paths fail closed', () => {
  for (const output of [
    '', 'package:', '/data/app/pkg/base.apk',
    'package:/data/app/pkg/base.apk\npackage:/data/app/pkg/split_config.apk\n',
    'package:/data/app/pkg/base.apk\npackage:/data/app/pkg/base.apk',
    'package:/system/app/pkg/base.apk', 'package:/data/app/../pkg/base.apk',
    'package:/data/app/./base.apk', 'package:/data/app/pkg/split.apk',
    'package:/data/app/pkg/base.apk ', ' package:/data/app/pkg/base.apk',
    'package:/data/app/p kg/base.apk', 'package:/data/app/pkg;id/base.apk',
    'package:/data/app/$(id)/base.apk', 'package:/data/app/`id`/base.apk',
    'package:/data/app/pkg/base.apk\u0000', 'package:/data/app/p\tkg/base.apk',
    'package:/data/app/pkg/base.apk\rjunk', 'package:/data/app/a/b/c/base.apk',
  ]) assert.throws(() => singleInstalledBaseApkPath(output), undefined, JSON.stringify(output));
});
