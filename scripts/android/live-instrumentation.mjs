import {spawn} from 'node:child_process';

/** A real live-process checkpoint: normal instrumentation completion is not readiness. */
export function startLiveInstrumentation(command,args,{cwd,checkpoint,timeoutMs=600000,killGraceMs=1000,redact=value=>value}={}) {
  if(typeof checkpoint!=='string'||!checkpoint.length)throw new Error('A live instrumentation checkpoint is required');
  const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});
  let output='',announced=false,failed=false,killTimer,readyResolve,readyReject,closedResolve;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const fail=message=>{if(failed)return;failed=true;clearTimeout(timeout);readyReject(new Error(message));child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),killGraceMs);};
  const timeout=setTimeout(()=>fail('Live instrumentation checkpoint timed out'),timeoutMs);
  const collect=chunk=>{
    if(failed)return;
    if(Buffer.byteLength(output)+chunk.length>256*1024){fail('Live instrumentation output exceeded its bound');return;}
    output+=chunk.toString();
    if(!announced&&output.includes(checkpoint)){announced=true;clearTimeout(timeout);readyResolve(redact(output));}
  };
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',()=>{clearTimeout(timeout);readyReject(new Error('Live instrumentation could not start'));});
  child.once('close',(code,signal)=>{
    clearTimeout(timeout);clearTimeout(killTimer);
    if(!announced)readyReject(new Error('Instrumentation exited before its live-process checkpoint'));
    closedResolve({code,signal,output:redact(output)});
  });
  return {child,ready,closed};
}
