/** End disposable API children before removing their database or fixture files. */
export async function stopFixtureChild(child, {graceMs=5000}={}) {
  if (!child.pid || child.exitCode!==null || child.signalCode!==null) return {forced:false};
  return new Promise((resolve,reject)=>{
    let forced=false;
    const done=(code,signal)=>{clearTimeout(timer);child.removeListener('error',failed);resolve({forced,code,signal});};
    const failed=error=>{clearTimeout(timer);child.removeListener('exit',done);reject(error);};
    child.once('exit',done);child.once('error',failed);
    const timer=setTimeout(()=>{forced=true;child.kill('SIGKILL');},graceMs);
    child.kill('SIGTERM');
  });
}
export async function stopFixtureChildren(children) {
  const results=await Promise.all(children.map(child=>stopFixtureChild(child)));
  if(results.some(result=>result.forced)) console.log('Synthetic API cleanup used bounded forced shutdown after graceful termination did not complete');
}
