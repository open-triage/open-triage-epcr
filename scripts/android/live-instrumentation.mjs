import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {redactAndroidDiagnostics} from './diagnostics.mjs';

/** A real live-process checkpoint: normal instrumentation completion is not readiness. */
export function startLiveInstrumentation(command,args,{cwd,checkpoint,phase='live-checkpoint',timeoutMs=600000,killGraceMs=1000,redact=value=>value,secrets=[]}={}) {
  if(typeof checkpoint!=='string'||!checkpoint.length)throw new Error('A live instrumentation checkpoint is required');
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(phase))throw new Error('A fixed safe instrumentation phase is required');
  const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});
  let output='',announced=false,failed=false,failure,truncated=false,killTimer,readyResolve,readyReject,closedResolve;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const closed=new Promise(resolve=>{closedResolve=resolve;});
  const sanitize=value=>{try{return redactAndroidDiagnostics(redact(value),secrets);}catch{return '[diagnostics redaction failed]';}};
  const failureFor=message=>{
    if(!failure){failure=new Error(message);failure.diagnostics={phase};}
    return failure;
  };
  const fail=(message,terminate=true)=>{if(failed)return;failed=true;clearTimeout(timeout);readyReject(failureFor(message));if(terminate){child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),killGraceMs);}};
  const timeout=setTimeout(()=>fail('Live instrumentation checkpoint timed out'),timeoutMs);
  const collect=chunk=>{
    if(failed)return;
    if(Buffer.byteLength(output)+chunk.length>256*1024){truncated=true;fail('Live instrumentation output exceeded its bound');return;}
    output+=chunk.toString();
    if(!announced&&output.includes(checkpoint)){announced=true;clearTimeout(timeout);readyResolve(sanitize(output));}
  };
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('error',()=>fail('Live instrumentation could not start',false));
  child.once('close',(code,signal)=>{
    clearTimeout(timeout);clearTimeout(killTimer);
    const safeOutput=sanitize(output);
    if(!announced||failed){
      const error=failureFor('Instrumentation exited before its live-process checkpoint');
      const relativePath=join('android','app','build','reports','android-live-instrumentation',phase+'-'+randomUUID()+'.json');
      Object.assign(error.diagnostics,{exitCode:code,signal,truncated,reportPath:relativePath});
      try{
        const directory=join(cwd??process.cwd(),'android','app','build','reports','android-live-instrumentation');
        mkdirSync(directory,{recursive:true,mode:0o700});
        writeFileSync(join(cwd??process.cwd(),relativePath),JSON.stringify({version:1,phase,reason:error.message,exitCode:code,signal,truncated,output:safeOutput},null,2)+'\n',{flag:'wx',mode:0o600});
      }catch{error.diagnostics.reportPath=null;error.diagnostics.reportWriteFailed=true;}
      readyReject(error);
    }
    closedResolve({code,signal,output:safeOutput,...(failure?{diagnostics:failure.diagnostics}:{})});
  });
  return {child,ready,closed};
}
