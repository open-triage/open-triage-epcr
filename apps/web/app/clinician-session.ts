import { platformRequestError } from "./platform-errors";
import { SYNTHETIC_DEMO_FIXTURE, type ClinicianSession, type CreateClinicianSessionCommand,
  type ReauthenticationResult } from "@open-triage/contracts";
import { DEMO_CLINICIAN_ID, DEMO_ORGANIZATION_ID } from "./demo-identity";
import { selectedInstallationSettings } from "./installation-settings";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export const DEMO_CLINICIAN_USERNAME = SYNTHETIC_DEMO_FIXTURE.username;
export const DEMO_CLINICIAN_PASSWORD = SYNTHETIC_DEMO_FIXTURE.password;
export const CLINICIAN_SESSION_STORAGE_KEY = "open-triage.clinician-session.v1";

const localDemoIdentity = {
  user: { id: DEMO_CLINICIAN_ID, displayName: "Synthetic Clinician" },
  organization: { id: DEMO_ORGANIZATION_ID, name: "OpenTriage Synthetic EMS" }
} as const;

export function sessionIsActive(session: ClinicianSession, now = new Date()): boolean {
  return Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > now.getTime();
}

export function loadClinicianSession(storage: Pick<Storage, "getItem" | "removeItem">, now = new Date()): ClinicianSession | null {
  const encoded = storage.getItem(CLINICIAN_SESSION_STORAGE_KEY);
  if (!encoded) return null;
  try {
    const session = JSON.parse(encoded) as ClinicianSession;
    if ((!session.csrfToken && !session.accessToken) || !session.user?.id || !session.organization?.id || !sessionIsActive(session, now)) {
      storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
    return null;
  }
}

export function sessionRequestToken(session: ClinicianSession): string {
  return session.csrfToken ?? session.accessToken ?? "";
}

export function storeClinicianSession(storage: Pick<Storage, "setItem">, session: ClinicianSession): void {
  storage.setItem(CLINICIAN_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearClinicianSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
}

export async function createClinicianSession(command: CreateClinicianSessionCommand, now = new Date()): Promise<ClinicianSession> {
  const configuration = browserRequestConfiguration();
  const url = apiRequestUrl("/api/sessions", configuration);
  if (url) {
    const response = await fetch(url, browserRequestInit({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command)
    }));
    if (!response.ok) throw await platformRequestError(response);
    return response.json() as Promise<ClinicianSession>;
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
export async function authenticateRestartedClinicianSession(stored: ClinicianSession): Promise<ClinicianSession | null> {
  const url = apiRequestUrl("/api/sessions/current");
  if (!url) return stored;
  const response = await fetch(url, browserRequestInit({ method: "GET", cache: "no-store" }));
  if (response.status === 401) return null;
  if (!response.ok) throw await platformRequestError(response);
  const authenticated = await response.json() as ClinicianSession;
  if (authenticated.user.id !== stored.user.id || authenticated.organization.id !== stored.organization.id) return null;
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
    headers: { "x-csrf-token": csrfToken }
  }));
}

export async function changeClinicianPassword(currentPassword: string, newPassword: string, csrfToken: string): Promise<ClinicianSession> {
  const url = apiRequestUrl("/api/sessions/password");
  if (!url) throw new Error("Password replacement is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ currentPassword, newPassword, csrfToken })
  }));
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<ClinicianSession>;
}

export const CLINICIAN_REAUTHENTICATED_EVENT = "open-triage:session-reauthenticated";

export async function reauthenticateClinicianSession(currentPassword: string,
  csrfToken: string): Promise<ReauthenticationResult> {
  const url = apiRequestUrl("/api/sessions/reauthenticate");
  if (!url) throw new Error("Reauthentication is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ currentPassword })
  }));
  if (!response.ok) throw await platformRequestError(response);
  const result = await response.json() as ReauthenticationResult;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CLINICIAN_REAUTHENTICATED_EVENT));
  return result;
}
