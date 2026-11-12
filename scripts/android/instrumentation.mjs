import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);

// adb joins arguments after "shell" before the device's shell parses them.
// Host execFile separation alone cannot preserve spaces or prevent expansion.
export function adbShellArguments(args) {
  const index=args.indexOf('shell');
  if(index<0)return args;
  const quote=value=>"'"+String(value).replaceAll("'","'\"'\"'")+"'";
  return [...args.slice(0,index+1),args.slice(index+1).map(quote).join(' ')];
}

/** Inline TLS providers must keep serving while the Android child drives them. */
export async function runInstrumentation(command,args,options={}) {
  const {stdout}=await execute(command,adbShellArguments(args),{encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024,...options});
  return stdout;
}
