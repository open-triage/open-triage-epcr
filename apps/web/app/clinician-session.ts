import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration,INSTALLATION_GENERATION_KEY } from "./installation-transition-generation";
import { platformRequestError } from "./platform-errors";
import { SYNTHETIC_DEMO_FIXTURE, type AuthenticatedSession, type CreateClinicianSessionCommand,
  type ReauthenticationResult } from "@open-triage/contracts";
import { DEMO_CLINICIAN_ID, DEMO_ORGANIZATION_ID } from "./demo-identity";
import { selectedInstallationSettings } from "./installation-settings";
import { apiRequestUrl, bindBrowserOrganization, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export const DEMO_CLINICIAN_USERNAME = SYNTHETIC_DEMO_FIXTURE.username;
export const DEMO_CLINICIAN_PASSWORD = SYNTHETIC_DEMO_FIXTURE.password;
export const CLINICIAN_SESSION_STORAGE_KEY = "open-triage.clinician-session.v1";

const localDemoIdentity = {
  user: { id: DEMO_CLINICIAN_ID, displayName: "Synthetic Clinician" },
  organization: { id: DEMO_ORGANIZATION_ID, name: "OpenTriage Synthetic EMS" }
} as const;

export function sessionIsActive(session: AuthenticatedSession, now = new Date()): boolean {
  return Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > now.getTime();
}

export function loadClinicianSession(storage: Pick<Storage, "getItem" | "removeItem">, now = new Date()): AuthenticatedSession | null {
  const encoded = storage.getItem(CLINICIAN_SESSION_STORAGE_KEY);
  if (!encoded) return null;
  try {
    const session = JSON.parse(encoded) as AuthenticatedSession;
    if ((!session.csrfToken && !session.accessToken) || !session.user?.id || (!session.organization?.id && !(session.organization === null && (session.installationOwner || session.installationSuperadmin))) || !sessionIsActive(session, now)) {
      storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
    return null;
  }
}

export function sessionRequestToken(session: AuthenticatedSession): string {
  return session.csrfToken ?? session.accessToken ?? "";
}

export function storeClinicianSession(storage: Pick<Storage, "setItem">, session: AuthenticatedSession): void {
  storage.setItem(CLINICIAN_SESSION_STORAGE_KEY, JSON.stringify(session));
  bindBrowserOrganization(session.organization?.id);
}

export function clearClinicianSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
  bindBrowserOrganization(undefined);
}

export async function createClinicianSession(command: CreateClinicianSessionCommand, now = new Date()): Promise<AuthenticatedSession> {
  const installationGeneration = authenticationInstallationGeneration();
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/sessions", configuration);
  if (url) {
    const response = await fetch(url, browserRequestInit({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command)
    }));
    assertAuthenticationInstallationGeneration(installationGeneration);
    if (!response.ok) throw await platformRequestError(response);
    const authenticated = await response.json() as AuthenticatedSession;
    assertAuthenticationInstallationGeneration(installationGeneration);
    return authenticated;
  }

  // The clinician-only static prototype has no database-backed accounts. Its local
  // credential check is intentionally separate from installation configuration.
  if (command.username !== DEMO_CLINICIAN_USERNAME || command.password !== DEMO_CLINICIAN_PASSWORD) {
    throw new Error("The username or password is incorrect.");
  }
  return {
    accessToken: crypto.randomUUID(),
    ...localDemoIdentity,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + selectedInstallationSettings().authentication.sessionDurationMinutes * 60 * 1_000).toISOString(),
    capabilities: ["clinical:demo", "clinical:document"],
    workspaceAvailable: true,
  };
}

/** Re-establishes server authority after a browser restart without trusting the persisted identity payload. */
export async function authenticateRestartedClinicianSession(stored: AuthenticatedSession): Promise<AuthenticatedSession | null> {
  let installationGeneration: string | null;
  try { installationGeneration = authenticationInstallationGeneration(); } catch { return null; }
  const url = apiRequestUrl("/api/sessions/current");
  if (!url) return stored;
  const response = await fetch(url, browserRequestInit({ method: "GET", cache: "no-store" }));
  if (response.status === 401) return null;
  if (!response.ok) throw await platformRequestError(response);
  const authenticated = await response.json() as AuthenticatedSession;
  try { assertAuthenticationInstallationGeneration(installationGeneration); } catch { return null; }
  if (authenticated.user.id !== stored.user.id || authenticated.organization?.id !== stored.organization?.id) return null;
  return {
    ...authenticated,
    ...(stored.csrfToken ? { csrfToken: stored.csrfToken } : {}),
    ...(stored.accessToken ? { accessToken: stored.accessToken } : {}),
  };
}

export async function endClinicianSession(csrfToken: string): Promise<void> {
  const url = apiRequestUrl("/api/sessions/current");
  if (!url) return;
  await fetch(url, browserRequestInit({
    method: "DELETE",
    signal:AbortSignal.timeout(5000),
    headers: { "x-csrf-token": csrfToken }
  }));
}

export async function changeClinicianPassword(currentPassword: string, newPassword: string, csrfToken: string): Promise<AuthenticatedSession> {
  const installationGeneration = authenticationInstallationGeneration();
  const url = apiRequestUrl("/api/sessions/password");
  if (!url) throw new Error("Password replacement is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ currentPassword, newPassword, csrfToken })
  }));
  assertAuthenticationInstallationGeneration(installationGeneration);
  if (!response.ok) throw await platformRequestError(response);
  const authenticated = await response.json() as AuthenticatedSession;
  assertAuthenticationInstallationGeneration(installationGeneration);
  return authenticated;
}

export const CLINICIAN_REAUTHENTICATED_EVENT = "open-triage:session-reauthenticated";
export class PersonalAuthenticationRedirect extends Error {}

async function navigateToPersonalAuthentication(authorizationUrl: string,settle=true): Promise<never> {
  const url=new URL(authorizationUrl);
  if(url.protocol!=="https:" || url.username || url.password)throw new Error("Invalid personal authentication destination");
  // This barrier settles all participating writers and removes plaintext/keys
  // before another identity can become visible. Encrypted deadlines are retained.
  const {transitionInstallation}=await import("./installation-transition");
  if(settle)await transitionInstallation(async()=>{});
  window.location.assign(url.href);
  throw new PersonalAuthenticationRedirect("Personal authentication started");
}
export async function organizationLoginAvailable(): Promise<boolean> {
  const url=apiRequestUrl("/api/sessions/authentication-options");
  if(!url)return false;
  const response=await fetch(url,browserRequestInit({cache:"no-store"}));
  if(!response.ok)throw await platformRequestError(response);
  return (await response.json() as {organization:boolean}).organization===true;
}
export async function beginPersonalClinicianSession(purpose:"login"|"switch",csrfToken?:string):Promise<never>{
  const initialGeneration=authenticationInstallationGeneration(),url=apiRequestUrl("/api/sessions/oidc/login");
  if(!url)throw new Error("Personal authentication requires a live API");
  const {transitionInstallation}=await import("./installation-transition");
  assertAuthenticationInstallationGeneration(initialGeneration);
  let generation:string|null=null;
  // Keep the shared barrier through the begin response: pending writers settle
  // while outgoing authority is live, and another tab cannot log in while that
  // response still owns the outgoing cookie.
  const result=await transitionInstallation(async()=>{
    generation=window.localStorage.getItem(INSTALLATION_GENERATION_KEY);
    const response=await fetch(url,browserRequestInit({method:"POST",headers:{"content-type":"application/json","x-personal-authentication":"1",...(csrfToken?{"x-csrf-token":csrfToken}:{})},body:JSON.stringify({purpose})}));
    if(!response.ok)throw await platformRequestError(response);
    return await response.json() as {authorizationUrl:string};
  });
  assertAuthenticationInstallationGeneration(generation);
  return navigateToPersonalAuthentication(result.authorizationUrl,false);
}
export async function completePersonalClinicianSession():Promise<AuthenticatedSession|null>{
  const generation=authenticationInstallationGeneration(),url=apiRequestUrl("/api/sessions/current");
  if(!url)return null;
  const response=await fetch(url,browserRequestInit({cache:"no-store"}));
  assertAuthenticationInstallationGeneration(generation);
  if(!response.ok)throw await platformRequestError(response);
  const session=await response.json() as AuthenticatedSession;
  assertAuthenticationInstallationGeneration(generation);
  if(session.authenticationSource!=="oidc"||!session.csrfToken||!sessionIsActive(session))return null;
  return session;
}

export async function reauthenticateClinicianSession(currentPassword: string,
  csrfToken: string, forcePersonalAuthentication = false): Promise<ReauthenticationResult> {
  const installationGeneration = authenticationInstallationGeneration();
  const url = apiRequestUrl("/api/sessions/reauthenticate");
  if (!url) throw new Error("Reauthentication is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ currentPassword, ...(forcePersonalAuthentication ? { forcePersonalAuthentication: true } : {}) })
  }));
  assertAuthenticationInstallationGeneration(installationGeneration);
  if (!response.ok) throw await platformRequestError(response);
  const result = await response.json() as ReauthenticationResult | {authorizationUrl:string};
  assertAuthenticationInstallationGeneration(installationGeneration);
  if("authorizationUrl" in result)return navigateToPersonalAuthentication(result.authorizationUrl);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLINICIAN_REAUTHENTICATED_EVENT));
  return result;
}
