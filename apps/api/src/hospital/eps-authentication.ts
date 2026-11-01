/** The EPS receiver authenticates company tokens using the Bearer scheme. */
export function epsAuthenticationHeaders(secret:string):Record<string,string> {
 return {Authorization:`Bearer ${secret}`};
}
