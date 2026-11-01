import {EPS_DEPENDENCIES} from './eps-output.js';
// Legacy states remain readable in immutable submission history.
export type EpsValidation={engine:'receiver'|'hl7-validator-7.0.2'|'unavailable';state:'pending'|'passed'|'failed'|'unavailable';dependencies:typeof EPS_DEPENDENCIES;issues:{severity:string;code:string;expression:string[]}[]};
/** Profile validation happens at the receiver on explicit publication, never during preview. */
export async function receiverEpsValidation():Promise<EpsValidation>{
 return {engine:'receiver',state:'pending',dependencies:EPS_DEPENDENCIES,issues:[]};
}
