import type {AuthenticatedSession} from "@open-triage/contracts";
import {bindBrowserOrganization} from "./browser-api";
import {INSTALLATION_SESSION_HINT_KEY} from "./installation-transition-generation";

export const CLINICIAN_SESSION_STORAGE_KEY = "open-triage.clinician-session.v1";

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

export function storeClinicianSession(storage: Pick<Storage, "setItem"> & Partial<Pick<Storage,"removeItem">>, session: AuthenticatedSession): void {
  storage.setItem(CLINICIAN_SESSION_STORAGE_KEY, JSON.stringify(session));
  storage.removeItem?.(INSTALLATION_SESSION_HINT_KEY);
  bindBrowserOrganization(session.organization?.id);
}

export function clearClinicianSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
  bindBrowserOrganization(undefined);
}

