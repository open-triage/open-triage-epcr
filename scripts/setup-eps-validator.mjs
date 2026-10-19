import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
// Operator-selected writable folder, never source-controlled runtime binaries or credentials.
const directory=resolve(process.argv[2]??'.local/eps-validator');
await mkdir(directory,{recursive:true,mode:0o700});
const version='7.0.2',expected='e3e50f06b806437821b7aef8189a1b790415cb96c5036e0812ed62981452b377';
const file=join(directory,`validator_cli-${version}.jar`);
let bytes;try{bytes=await readFile(file);}catch{const response=await fetch(`https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${version}/validator_cli.jar`,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('Official validator download failed');bytes=Buffer.from(await response.arrayBuffer());}
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Official validator checksum mismatch');
await writeFile(file,bytes,{mode:0o600});
console.log(`Pinned HL7 validator ${version} verified at ${file}`);
console.log('Configure EPS_VALIDATOR_JAVA with an absolute Java21 executable path, EPS_VALIDATOR_JAR with this JAR, and EPS_VALIDATOR_CACHE_HOME with a private writable directory.');
