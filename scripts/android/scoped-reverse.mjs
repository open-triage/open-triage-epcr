import {spawnSync} from 'node:child_process';

/** Retain exactly the prior device listener; this grants no device privileges. */
export function scopedAndroidReverse({adb,serial,local='tcp:443',remote='tcp:9444',execute=spawnSync}) {
 const invoke=args=>{
  const result=execute(adb,['-s',serial,'reverse',...args],{encoding:'utf8',timeout:10000});
  if(result.error||result.status!==0){
   const denied=/permission denied/i.test(String(result.stderr??''));
   throw new Error(denied?'Android reverse listener requires device permission for port 443; use the explicitly approved emulator routing prerequisite.': 'Android reverse operation failed; inspect the leased device routing before acceptance.');
  }
  return String(result.stdout??'');
 };
 const mapping=()=>invoke(['--list']).split('\n').map(line=>line.trim().split(/\s+/)).find(parts=>parts.at(-2)===local)?.at(-1);
 const previous=mapping();
 if(previous&&!/^(tcp:[0-9]+|localabstract:[A-Za-z0-9_.-]+)$/.test(previous))throw new Error('Unknown reverse mapping must remain untouched');
 let restored=false;
 const restore=()=>{if(restored)return;const current=mapping();if(current!==previous){if(previous)invoke([local,previous]);else if(current)invoke(['--remove',local]);}if(mapping()!==previous)throw new Error('Original reverse endpoint was not restored exactly');restored=true;};
 try{invoke([local,remote]);}catch(error){try{restore();}catch(cleanup){throw new AggregateError([error,cleanup],'Android reverse setup and restoration failed');}throw error;}
 return restore;
}
