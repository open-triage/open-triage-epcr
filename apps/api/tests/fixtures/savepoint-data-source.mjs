import {AsyncLocalStorage} from 'node:async_hooks';

/** Rollback-only integration fixtures share one PostgreSQL client. PostgreSQL
 * savepoints are a stack, not independent transaction contexts. Queue sibling
 * transactions, including nested siblings, while allowing reentrant service calls.
 * External I/O outside database.transaction remains concurrent (e.g. EPS lookup).
 * This is not a substitute for real multi-connection locking/concurrency tests.
 */
export function savepointDataSource(client) {
  const scope=new AsyncLocalStorage();
  const root={tail:Promise.resolve()};
  let sequence=0;
  const query=async(sql,args)=>(await client.query(sql,args)).rows;
  const manager={query};
  const transaction=(first,second)=>{
    const work=typeof first==='function'?first:second;
    const parent=scope.getStore()??root;
    const result=parent.tail.then(()=>scope.run({tail:Promise.resolve()},async()=>{
      const point=`fixture_${++sequence}`;
      await client.query(`savepoint ${point}`);
      try {
        const value=await work(manager);
        await client.query(`release savepoint ${point}`);
        return value;
      } catch(error) {
        try {
          await client.query(`rollback to savepoint ${point}`);
          await client.query(`release savepoint ${point}`);
        } catch(cleanup) {
          throw new AggregateError([error,cleanup],'Fixture savepoint cleanup failed');
        }
        throw error;
      }
    }));
    parent.tail=result.then(()=>undefined,()=>undefined);
    return result;
  };
  return {query,manager,transaction};
}
