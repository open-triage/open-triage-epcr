import assert from 'node:assert/strict';
import test from 'node:test';
import {assertNoRemoteFontInitializer} from '../scripts/android/native-startup.mjs';

test('generic startup permits local lifecycle initialization and rejects automatic remote emoji fonts',()=>{
  const local='<manifest><application><provider android:name="androidx.startup.InitializationProvider"><meta-data android:name="androidx.lifecycle.ProcessLifecycleInitializer" /></provider></application></manifest>';
  assert.doesNotThrow(()=>assertNoRemoteFontInitializer(local));
  assert.throws(()=>assertNoRemoteFontInitializer(local.replace('androidx.lifecycle.ProcessLifecycleInitializer','androidx.emoji2.text.EmojiCompatInitializer')),/downloadable font provider/);
  assert.throws(()=>assertNoRemoteFontInitializer(''),/actual merged/);
});
