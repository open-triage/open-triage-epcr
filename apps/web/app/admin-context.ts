import type { AdminContext } from "@open-triage/contracts";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

export async function loadAdminContext(): Promise<AdminContext> {
  const response = await fetch(`${apiBaseUrl()}/api/admin/context`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Your account is not authorized to administer this installation."
      : "Administration configuration is unavailable.");
  }
  return response.json() as Promise<AdminContext>;
}
