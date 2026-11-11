import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

/** Inline TLS providers must keep serving while the Android child drives them. */
export async function runInstrumentation(command,args,options={}) {
  const {stdout}=await execute(command,args,{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024,...options});
  return stdout;
}
