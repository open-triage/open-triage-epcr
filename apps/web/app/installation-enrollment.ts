import { transitionInstallation } from "./installation-transition";
import { apiRequestUrl, browserRouteUrl, browserRequestConfiguration } from "./browser-api";
export type InstallationSummary={id:string;installationId:string;organizationId:string;unitId:string;name:string;enrolledAt:string;revokedAt:string|null};
export async function installationRequest<T>(path:string,body?:unknown):Promise<T> {
 if(!navigator.locks) throw new Error("Enrollment requires a browser with secure cross-tab storage coordination");
 return navigator.locks.request("open-triage.installation-enrollment",async()=>{
 const configuration=browserRequestConfiguration();
 if(configuration.mode==="static") throw new Error("Enrollment requires the live application");
 const request=async()=>{
 const response=await fetch(apiRequestUrl(`/api/installations/${path}`,configuration)??browserRouteUrl(`/api/installations/${path}`,configuration),{
 cache:"no-store",credentials:"include",...(body?{method:"POST",headers:{"content-type":"application/json","x-installation-enrollment":"1"},body:JSON.stringify(body)}:{})});
 if(!response.ok) throw new Error("Enrollment failed. Request a new code or use the intended browser installation.");
 return response.json() as Promise<T>;
 };
 return body && typeof body === "object" && "reassign" in body && body.reassign === true
 ? transitionInstallation(request) : request();
 });
}
