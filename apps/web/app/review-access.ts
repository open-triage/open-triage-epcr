import type { ClinicianSession } from "@open-triage/contracts";

/** Match the server's patient-data ceiling, including cached session grants. */
export function reviewAccess(session: ClinicianSession) {
  const installationAuthority = session.installationOwner || session.installationSuperadmin;
  const all = !installationAuthority && (session.capabilities?.includes("review:all") ?? false);
  return {
    all,
    administrator: all && (session.capabilities?.includes("review:admin") ?? false),
  };
}
