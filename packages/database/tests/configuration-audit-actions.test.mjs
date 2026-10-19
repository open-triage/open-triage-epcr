import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import test from 'node:test';
const directory=new URL('../../../supabase/migrations/',import.meta.url);
test('configuration audit action extensions preserve every previously supported operation',async()=>{
 let previous=new Set();let replacements=0;
 for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()){
  const sql=await readFile(new URL(file,directory),'utf8');
  for(const match of sql.matchAll(/add constraint configuration_event_action_check\s+check\s*\(\s*action in\s*\(([^]*?)\)\s*\)/gi)){
   const current=new Set([...match[1].matchAll(/'([^']+)'/g)].map(value=>value[1]));
   for(const action of previous)assert.ok(current.has(action),`${file} must preserve previously recorded ${action} events`);
   previous=current;replacements++;
  }
 }
 assert.ok(replacements>=4);for(const action of ['catalog.draft_delete','form.draft_delete','configuration.activate','hospital.credential_replace','hospital.resume'])assert.ok(previous.has(action),action);
});
