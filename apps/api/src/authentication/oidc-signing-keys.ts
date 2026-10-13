import {createPublicKey} from "node:crypto";
/** Shared discovery and every runtime JWKS refresh enforce public, bounded keys. */
export function publicSigningKeyIds(jwks:Record<string,unknown>) {
 if(!Array.isArray(jwks.keys)||!jwks.keys.length||jwks.keys.length>100)throw new Error("Invalid signing keys");
 const ids=jwks.keys.filter(value=>value&&typeof value==="object"&&value.use!=="enc"&&["RSA","EC","OKP"].includes(value.kty)).map(value=>{
  if(Object.hasOwn(value,"d")||value.key_ops!==undefined&&(!Array.isArray(value.key_ops)||!value.key_ops.includes("verify")))throw new Error("Invalid public signing key");
  createPublicKey({key:value,format:"jwk"});
  return typeof value.kid==="string"&&value.kid.length>0&&value.kid.length<=200&&!/[\u0000-\u001f]/.test(value.kid)?value.kid:"(no kid)";
 });
 if(!ids.length)throw new Error("Missing signing keys");return ids;
}
