import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {savepointDataSource} from './fixtures/savepoint-data-source.mjs';

function fixture() {
  const stack=[];
  const client={query:async sql=>{
    await setImmediate();
    const name=sql.split(' ').at(-1);
    if(sql.startsWith('savepoint '))stack.push(name);
    else {
      const index=stack.indexOf(name);
      assert.ok(index>=0,`savepoint ${name} does not exist`);
      stack.splice(index+(sql.startsWith('rollback')?1:0));
    }
    return {rows:[]};
  }};
  return {database:savepointDataSource(client),stack};
}

test('single-client fixture serializes overlapping independent and nested sibling transactions',async()=>{
  const {database,stack}=fixture();const events=[];
  await Promise.all([
    database.transaction(async()=>{
      events.push('outer-start');
      await Promise.all([1,2].map(n=>database.transaction(async()=>{
        events.push(`nested-${n}-start`);await setImmediate();events.push(`nested-${n}-end`);
      })));
      events.push('outer-end');
    }),
    database.transaction('REPEATABLE READ',async()=>{events.push('sibling');})
  ]);
  assert.deepEqual(events,['outer-start','nested-1-start','nested-1-end','nested-2-start','nested-2-end','outer-end','sibling']);
  assert.deepEqual(stack,[]);
});

test('nested failure rolls back only its own savepoint and does not poison queued work',async()=>{
  const {database,stack}=fixture();const error=new Error('expected nested failure');
  await database.transaction(async()=>{
    await assert.rejects(database.transaction(async()=>{throw error;}),error);
    assert.equal(stack.length,1);
    assert.equal(await database.transaction(async()=>42),42);
  });
  const failed=database.transaction(async()=>{throw error;});
  const succeeding=database.transaction(async()=>43);
  await assert.rejects(failed,error);assert.equal(await succeeding,43);assert.deepEqual(stack,[]);
});
