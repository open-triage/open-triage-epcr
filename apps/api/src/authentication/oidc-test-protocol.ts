import type { ServerMetadata } from "openid-client";
import { oidcConfiguration } from "./oidc-library.js";
import { publicSigningKeyIds } from "./oidc-signing-keys.js";
import { regionalIdentity, type ValidatedRegionalIdentity } from "./regional-identity.service.js";
import type { OidcDraft } from "./oidc-draft.service.js";
import { providerFetch } from "./oidc-network.js";
export type TestBinding = { state: string; nonce: string; verifier: string; callback: string; pkce: boolean };
export async function testAuthorization(metadata: ServerMetadata, clientId: string, secret: string, scopes: string[], binding: TestBinding) {
  const client = await import("openid-client");
  const config = await oidcConfiguration(metadata,clientId,secret);
  const parameters: Record<string,string> = {redirect_uri:binding.callback,response_type:"code",scope:scopes.join(" "),state:binding.state,nonce:binding.nonce,prompt:"login"};
  if (binding.pkce) { parameters.code_challenge=await client.calculatePKCECodeChallenge(binding.verifier); parameters.code_challenge_method="S256"; }
  return client.buildAuthorizationUrl(config,parameters).href;
}
type Validation = {identityValidated:true;freshPersonalAuthentication:false;pkceS256:boolean};
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL):Promise<Validation>;
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL,mappings:OidcDraft["mappings"]):Promise<Validation & {identity:ValidatedRegionalIdentity}>;
export async function testCodeExchange(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding, callback: URL, mappings?: OidcDraft["mappings"]) {
  const client = await import("openid-client");
  const config = await oidcConfiguration(metadata,clientId,secret);
  config[client.customFetch]=async(input,init)=>{
    const response=await providerFetch(input,init);
    if(String(input)===metadata.jwks_uri)publicSigningKeyIds(await response.clone().json() as Record<string,unknown>);
    return response;
  };
  // Code-flow TLS validation alone is insufficient for this acceptance test:
  // explicitly verify every ID-token signature, using the bounded JWKS transport.
  client.enableNonRepudiationChecks(config);
  const tokens = await client.authorizationCodeGrant(config,callback,{expectedState:binding.state,expectedNonce:binding.nonce,pkceCodeVerifier:binding.pkce?binding.verifier:undefined,idTokenExpected:true});
  const claims=tokens.claims();
  if (!claims || typeof claims.sub!=="string" || !claims.sub || typeof claims.iat!=="number" || typeof claims.exp!=="number" || claims.iat>Date.now()/1000+60 || claims.exp<=Date.now()/1000 || claims.nbf!==undefined && (typeof claims.nbf!=="number" || claims.nbf>Date.now()/1000+60)) throw new Error("Invalid identity claims");
  // This establishes identity validation only. Neither prompt=login, iat,
  // auth_time nor arbitrary provider amr/acr establishes approved personal proof.
  const identity=regionalIdentity(claims as unknown as Record<string,unknown>,mappings??{displayName:"",email:""});
  const validation={identityValidated:true as const,freshPersonalAuthentication:false as const,pkceS256:binding.pkce};
  // Profile evidence is opt-in for server-side review. Diagnostic/demo callers
  // retain the bounded validation-only result and cannot accidentally print it.
  return mappings ? {...validation,identity} : validation;
}
