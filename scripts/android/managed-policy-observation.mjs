import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** Expected Android 13 persisted Bundle values, distinct from configured MDM JSON. */
export function canonicalAndroidManagedPolicy(policy) {
  assert(policy&&Object.getPrototypeOf(policy)===Object.prototype,'Expected a primitive managed policy JSON object');
  return Object.fromEntries(Object.entries(policy).map(([key,value])=>{
    if(typeof value==='string')return[key,value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g,'')];
    if(typeof value==='boolean')return[key,value];
    assert(typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=2147483647,'Managed observation supports only String, Integer and Boolean values');
    return[key,value];
  }));
}

/** Match the existing native JSONArray observer, including Android slash escaping. */
export function androidManagedPolicyObservationJson(policy) {
  const canonical=canonicalAndroidManagedPolicy(policy);
  const rows=Object.keys(canonical).sort().map(key=>{
    const value=canonical[key];
    return[key,typeof value==='string'?'String':typeof value==='boolean'?'Boolean':'Integer',value];
  });
  return JSON.stringify(rows).replaceAll('/','\\/');
}

export function androidManagedPolicyFingerprint(policy) {
  return createHash('sha256').update(androidManagedPolicyObservationJson(policy),'utf8').digest('hex');
}
