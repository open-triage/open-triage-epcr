import type { ClinicianSession, CreateClinicianSessionCommand } from "@open-triage/contracts";

export const DEMO_CLINICIAN_USERNAME = "demo.clinician";
export const DEMO_CLINICIAN_PASSWORD = "open-triage-demo";
export const CLINICIAN_SESSION_STORAGE_KEY = "open-triage.clinician-session.v1";

const localDemoIdentity = {
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" }
} as const;

export function sessionIsActive(session: ClinicianSession, now = new Date()): boolean {
  return Number.isFinite(Date.parse(session.expiresAt)) && Date.parse(session.expiresAt) > now.getTime();
}

export function loadClinicianSession(storage: Pick<Storage, "getItem" | "removeItem">, now = new Date()): ClinicianSession | null {
  const encoded = storage.getItem(CLINICIAN_SESSION_STORAGE_KEY);
  if (!encoded) return null;
  try {
    const session = JSON.parse(encoded) as ClinicianSession;
    if (!session.accessToken || !session.user?.id || !session.organization?.id || !sessionIsActive(session, now)) {
      storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
    return null;
  }
}

export function storeClinicianSession(storage: Pick<Storage, "setItem">, session: ClinicianSession): void {
  storage.setItem(CLINICIAN_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearClinicianSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(CLINICIAN_SESSION_STORAGE_KEY);
}

function apiBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true" || process.env.NEXT_PUBLIC_BASE_PATH) return null;
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

export async function createClinicianSession(command: CreateClinicianSessionCommand, now = new Date()): Promise<ClinicianSession> {
  const baseUrl = apiBaseUrl();
  if (baseUrl) {
    const response = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command)
    });
    if (!response.ok) throw new Error(response.status === 401 ? "The username or password is incorrect." : "Sign in is unavailable.");
    return response.json() as Promise<ClinicianSession>;
  }

  // The static synthetic prototype has no server. It mirrors the seeded demo
  // organization so the published, non-clinical artifact remains usable.
  if (command.username !== DEMO_CLINICIAN_USERNAME || command.password !== DEMO_CLINICIAN_PASSWORD) {
    throw new Error("The username or password is incorrect.");
  }
  return {
    accessToken: crypto.randomUUID(),
    ...localDemoIdentity,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 14 * 60 * 60 * 1_000).toISOString()
  };
}

export async function endClinicianSession(accessToken: string): Promise<void> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) return;
  await fetch(`${baseUrl}/api/sessions/current`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` }
  });
}
