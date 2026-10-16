import type { ServerMetadata } from "openid-client";
import { oidcConfiguration } from "./oidc-library.js";
import { publicSigningKeyIds } from "./oidc-signing-keys.js";
import { externalIdentity, type ValidatedExternalIdentity } from "./external-identity.service.js";
import type { OidcDraft } from "./oidc-draft.service.js";
import { providerFetch } from "./oidc-network.js";
import { validatePersonalProof, type PersonalProofPolicy, type PersonalAuthenticationPurpose } from "./personal-proof.js";
export type TestBinding = { state: string; nonce: string; verifier: string; callback: string; pkce: boolean };
export async function testAuthorization(metadata: ServerMetadata, clientId: string, secret: string, scopes: string[], binding: TestBinding,
  personal?: { policy: PersonalProofPolicy; purpose: PersonalAuthenticationPurpose }) {
  const client = await import("openid-client");
  const config = await oidcConfiguration(metadata,clientId,secret);
  const parameters: Record<string,string> = {redirect_uri:binding.callback,response_type:"code",scope:scopes.join(" "),state:binding.state,nonce:binding.nonce,prompt:"login"};
  if (personal) {
    parameters.max_age="0";
    if (personal.policy.acr !== null) parameters.acr_values=personal.policy.acr;
    parameters.claims=JSON.stringify({id_token:{...(personal.policy.purposeClaim?{[personal.policy.purposeClaim]:{essential:true,value:personal.policy.purposes![personal.purpose]}}:{}),...(personal.policy.acr !== null?{acr:{essential:true,value:personal.policy.acr}}:{}),auth_time:{essential:true},amr:{essential:true}}});
  }
  if (binding.pkce) { parameters.code_challenge=await client.calculatePKCECodeChallenge(binding.verifier); parameters.code_challenge_method="S256"; }
  return client.buildAuthorizationUrl(config,parameters).href;
}
type Validation = {identityValidated:true;freshPersonalAuthentication:false;pkceS256:boolean};
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL):Promise<Validation>;
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL,mappings:OidcDraft["mappings"],privateOrigins?:string[]):Promise<Validation & {identity:ValidatedExternalIdentity}>;
export async function testCodeExchange(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding, callback: URL, mappings?: OidcDraft["mappings"],privateOrigins?:string[]) {
  const {identityClaims}=await validatedCodeClaims(metadata,clientId,secret,binding,callback,privateOrigins,mappings);
  // Identity diagnostics never approve personal proof, even with method claims.
  const identity=externalIdentity(identityClaims,mappings??{displayName:"",email:""});
  const validation={identityValidated:true as const,freshPersonalAuthentication:false as const,pkceS256:binding.pkce};
  return mappings ? {...validation,identity} : validation;
}
export async function personalCodeExchange(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding,
  callback: URL, mappings: OidcDraft["mappings"], policy: PersonalProofPolicy, purpose: PersonalAuthenticationPurpose, beganAt: Date,privateOrigins?:string[]) {
  const {claims,identityClaims}=await validatedCodeClaims(metadata,clientId,secret,binding,callback,privateOrigins,mappings);
  return {identity:externalIdentity(identityClaims,mappings),
    proof:validatePersonalProof(claims as unknown as Record<string,unknown>,policy,purpose,beganAt)};
}
async function validatedCodeClaims(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding, callback: URL,privateOrigins?:string[],mappings?:OidcDraft["mappings"]) {
  const client = await import("openid-client");
  const config = await oidcConfiguration(metadata,clientId,secret);
  config[client.customFetch]=async(input,init)=>{
    const response=await providerFetch(input,init,undefined,privateOrigins);
    if(String(input)===metadata.jwks_uri)publicSigningKeyIds(await response.clone().json() as Record<string,unknown>);
    return response;
  };
  // Code-flow TLS validation alone is insufficient for this acceptance test:
  // explicitly verify every ID-token signature, using the bounded JWKS transport.
  client.enableNonRepudiationChecks(config);
  const tokens = await client.authorizationCodeGrant(config,callback,{expectedState:binding.state,expectedNonce:binding.nonce,pkceCodeVerifier:binding.pkce?binding.verifier:undefined,idTokenExpected:true});
  const claims=tokens.claims();
  if (!claims || typeof claims.sub!=="string" || !claims.sub || typeof claims.iat!=="number" || typeof claims.exp!=="number" || claims.iat>Date.now()/1000+60 || claims.exp<=Date.now()/1000 || claims.nbf!==undefined && (typeof claims.nbf!=="number" || claims.nbf>Date.now()/1000+60)) throw new Error("Invalid identity claims");
  // Some providers (including Duende) return profile claims only at UserInfo.
  // Bind that response to the signed subject and use it solely for profile hints.
  // Authentication methods/freshness must continue to come from the ID token.
  const identityClaims:Record<string,unknown>={...claims};
  const missing=mappings ? [mappings.displayName,mappings.email,mappings.username??"preferred_username"].filter((key):key is string=>!!key && claims[key]===undefined) : [];
  if(missing.length && metadata.userinfo_endpoint && tokens.access_token){
    const profile=await client.fetchUserInfo(config,tokens.access_token,claims.sub);
    for(const key of missing)if(key!=='iss' && key!=='sub' && Object.hasOwn(profile,key))identityClaims[key]=profile[key];
  }
  return {claims,identityClaims};
}
