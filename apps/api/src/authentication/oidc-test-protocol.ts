import type { ServerMetadata } from "openid-client";
import { oidcConfiguration } from "./oidc-library.js";
import { publicSigningKeyIds } from "./oidc-signing-keys.js";
import { regionalIdentity, type ValidatedRegionalIdentity } from "./regional-identity.service.js";
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
    parameters.acr_values=personal.policy.acr;
    parameters.claims=JSON.stringify({id_token:{...(personal.policy.purposeClaim?{[personal.policy.purposeClaim]:{essential:true,value:personal.policy.purposes![personal.purpose]}}:{}),acr:{essential:true,value:personal.policy.acr},auth_time:{essential:true},amr:{essential:true}}});
  }
  if (binding.pkce) { parameters.code_challenge=await client.calculatePKCECodeChallenge(binding.verifier); parameters.code_challenge_method="S256"; }
  return client.buildAuthorizationUrl(config,parameters).href;
}
type Validation = {identityValidated:true;freshPersonalAuthentication:false;pkceS256:boolean};
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL):Promise<Validation>;
export function testCodeExchange(metadata:ServerMetadata,clientId:string,secret:string,binding:TestBinding,callback:URL,mappings:OidcDraft["mappings"]):Promise<Validation & {identity:ValidatedRegionalIdentity}>;
export async function testCodeExchange(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding, callback: URL, mappings?: OidcDraft["mappings"]) {
  const claims=await validatedCodeClaims(metadata,clientId,secret,binding,callback);
  // Identity diagnostics never approve personal proof, even with method claims.
  const identity=regionalIdentity(claims as unknown as Record<string,unknown>,mappings??{displayName:"",email:""});
  const validation={identityValidated:true as const,freshPersonalAuthentication:false as const,pkceS256:binding.pkce};
  return mappings ? {...validation,identity} : validation;
}
export async function personalCodeExchange(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding,
  callback: URL, mappings: OidcDraft["mappings"], policy: PersonalProofPolicy, purpose: PersonalAuthenticationPurpose, beganAt: Date) {
  const claims=await validatedCodeClaims(metadata,clientId,secret,binding,callback);
  return {identity:regionalIdentity(claims as unknown as Record<string,unknown>,mappings),
    proof:validatePersonalProof(claims as unknown as Record<string,unknown>,policy,purpose,beganAt)};
}
async function validatedCodeClaims(metadata: ServerMetadata, clientId: string, secret: string, binding: TestBinding, callback: URL) {
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
  return claims;
}
