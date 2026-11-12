import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

/** Early checks consume the real workspace barrel before any generated dist exists. */
export function realContractsSourcePlugin(){
 return{name:'unbuilt-workspace-contracts',setup(builder){
  builder.onResolve({filter:/^@open-triage\/contracts$/},()=>({path:fileURLToPath(new URL('../../packages/contracts/src/index.ts',import.meta.url))}));
 }};
}

export function assertUnbuiltWorkspaceInputs(metafile){
 const inputs=Object.keys(metafile.inputs);
 assert(inputs.some(path=>path.endsWith('packages/contracts/src/index.ts')),'Early bundle must include the real contracts source barrel');
 assert.deepEqual(inputs.filter(path=>/(?:packages|apps)\/[^/]+\/(?:dist|\.next(?:-[^/]*)?|out)\//.test(path)),[],'Early bundle must not depend on generated workspace outputs');
}
