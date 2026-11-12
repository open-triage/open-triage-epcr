import {spawnSync} from 'node:child_process';

/** Test infrastructure only. The installed application keeps its ordinary Android UID. */
export function scopedAgencyAdbdRoot({adb,serial,allowRoot=process.env.OPEN_TRIAGE_ANDROID_ALLOW_SCOPED_ADBD_ROOT==='1',execute=spawnSync}) {
 const raw=(args,timeout=10000)=>execute(adb,args,{encoding:'utf8',timeout,maxBuffer:65536});
 const call=args=>{const r=raw(['-s',serial,...args]);if(r.error||r.status!==0)throw new Error('Scoped Android fixture routing command failed');return String(r.stdout??'').trim();};
 const property=name=>call(['shell','getprop',name]);
 const uid=()=>{const value=call(['shell','id','-u']);if(!/^[0-9]+$/.test(value))throw new Error('Cannot establish original adbd UID');return Number(value);};
 if(property('ro.kernel.qemu')!=='1'||property('ro.debuggable')!=='1'||!['userdebug','eng'].includes(property('ro.build.type')))throw new Error('Canonical HTTPS fixture routing requires an isolated debuggable emulator');
 const initial=uid();if(![0,2000].includes(initial))throw new Error('Unsupported original adbd UID');
 const previous=call(['reverse','--list']);
 const mapping=previous.split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-2)==='tcp:443')?.at(-1);
 if(mapping&&!/^(tcp:[0-9]+|localabstract:[A-Za-z0-9_.-]+)$/.test(mapping))throw new Error('Unknown original reverse mapping must remain untouched');
 const reconnect=expected=>{
  for(let attempt=0;attempt<3;attempt++){
   if(serial.includes(':'))raw(['connect',serial],5000);
   const wait=raw(['-s',serial,'wait-for-device'],10000);if(wait.error||wait.status!==0)continue;
   try{if(uid()===expected)return;}catch{/* Daemon may still be restarting. */}
  }
  throw new Error('Scoped adbd restart did not restore the expected UID within its bound');
 };
 let restored=false,changed=false;
 const restore=()=>{
  if(restored)return;
  const errors=[];
  try {
   const current=call(['reverse','--list']).split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-2)==='tcp:443')?.at(-1);
   if(current!==mapping){if(mapping)call(['reverse','tcp:443',mapping]);else if(current)call(['reverse','--remove','tcp:443']);}
   const after=call(['reverse','--list']).split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-2)==='tcp:443')?.at(-1);
   if(after!==mapping)throw new Error('Original reverse listener was not restored');
  }catch(error){errors.push(error);}
  try{if(changed){call(['unroot']);reconnect(initial);}if(uid()!==initial)throw new Error('Original adbd UID was not restored');
   const finalMapping=call(['reverse','--list']).split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-2)==='tcp:443')?.at(-1);
   if(finalMapping!==mapping)throw new Error('Original reverse listener changed after restoring adbd');}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'Scoped Android fixture routing cleanup failed');
  restored=true;
 };
 try {
  if(!allowRoot)throw new Error('Canonical HTTPS fixture requires OPEN_TRIAGE_ANDROID_ALLOW_SCOPED_ADBD_ROOT=1 for this disposable emulator');
  // Try the privileged listener first; preserve a daemon that already has permission.
  const probe=raw(['-s',serial,'reverse','tcp:443','tcp:9444']);
  if(probe.error||probe.status!==0){
   if(initial===0||!/permission denied/i.test(String(probe.stderr??'')))throw new Error('Canonical HTTPS reverse listener probe failed');
   if(previous.trim())throw new Error('Other reverse listeners must be released before restarting the disposable adbd');
   changed=true;call(['root']);reconnect(0);
   call(['reverse','tcp:443','tcp:9444']);
  }
  if(mapping)call(['reverse','tcp:443',mapping]);else call(['reverse','--remove','tcp:443']);
 }catch(error){try{restore();}catch(cleanup){throw new AggregateError([error,cleanup],'Scoped Android fixture routing setup and cleanup failed');}throw error;}
 return restore;
}
