export interface InstallationSettings {
  schemaVersion: "1.0.0";
  syntheticFixtures: { enabled: boolean };
  sampleDispatchAssignment: { enabled: boolean };
  syntheticDataBanner: { enabled: boolean; heading: string; message: string };
  clinicalRetention: { durationHours: number; automaticDeletionEnabled: boolean };
  authentication: {
    sessionDurationMinutes: number;
    idleTimeoutMinutes: number;
    minimumPasswordLength: number;
  };
  administration: { readOnly: boolean };
  exports: {
    downloadsAllowed: boolean;
    auditExportsAllowed: boolean;
    configurationExportsAllowed: boolean;
  };
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, path: string, expected: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !(key in value));
  if (unknown.length || missing.length) {
    throw new TypeError(`${path} has invalid keys (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`);
  }
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function integerAt(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be an integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

/** Runtime boundary for settings loaded from JSON or deployment configuration. */
export function parseInstallationSettings(value: unknown): InstallationSettings {
  const root = objectAt(value, "installation settings");
  exactKeys(root, "installation settings", ["schemaVersion", "syntheticFixtures", "sampleDispatchAssignment", "syntheticDataBanner", "clinicalRetention", "authentication", "administration", "exports"]);
  if (root.schemaVersion !== "1.0.0") throw new TypeError("installation settings.schemaVersion must be 1.0.0");
  const fixtures = objectAt(root.syntheticFixtures, "syntheticFixtures");
  const assignment = objectAt(root.sampleDispatchAssignment, "sampleDispatchAssignment");
  const banner = objectAt(root.syntheticDataBanner, "syntheticDataBanner");
  const retention = objectAt(root.clinicalRetention, "clinicalRetention");
  const authentication = objectAt(root.authentication, "authentication");
  const administration = objectAt(root.administration, "administration");
  const exports = objectAt(root.exports, "exports");
  exactKeys(fixtures, "syntheticFixtures", ["enabled"]);
  exactKeys(assignment, "sampleDispatchAssignment", ["enabled"]);
  exactKeys(banner, "syntheticDataBanner", ["enabled", "heading", "message"]);
  exactKeys(retention, "clinicalRetention", ["durationHours", "automaticDeletionEnabled"]);
  exactKeys(authentication, "authentication", ["sessionDurationMinutes", "idleTimeoutMinutes", "minimumPasswordLength"]);
  exactKeys(administration, "administration", ["readOnly"]);
  exactKeys(exports, "exports", ["downloadsAllowed", "auditExportsAllowed", "configurationExportsAllowed"]);
  return {
    schemaVersion: "1.0.0",
    syntheticFixtures: { enabled: booleanAt(fixtures.enabled, "syntheticFixtures.enabled") },
    sampleDispatchAssignment: { enabled: booleanAt(assignment.enabled, "sampleDispatchAssignment.enabled") },
    syntheticDataBanner: {
      enabled: booleanAt(banner.enabled, "syntheticDataBanner.enabled"),
      heading: stringAt(banner.heading, "syntheticDataBanner.heading"),
      message: stringAt(banner.message, "syntheticDataBanner.message"),
    },
    clinicalRetention: {
      durationHours: integerAt(retention.durationHours, "clinicalRetention.durationHours", 1),
      automaticDeletionEnabled: booleanAt(retention.automaticDeletionEnabled, "clinicalRetention.automaticDeletionEnabled"),
    },
    authentication: {
      sessionDurationMinutes: integerAt(authentication.sessionDurationMinutes, "authentication.sessionDurationMinutes", 15),
      idleTimeoutMinutes: integerAt(authentication.idleTimeoutMinutes, "authentication.idleTimeoutMinutes", 5),
      minimumPasswordLength: integerAt(authentication.minimumPasswordLength, "authentication.minimumPasswordLength", 8),
    },
    administration: { readOnly: booleanAt(administration.readOnly, "administration.readOnly") },
    exports: {
      downloadsAllowed: booleanAt(exports.downloadsAllowed, "exports.downloadsAllowed"),
      auditExportsAllowed: booleanAt(exports.auditExportsAllowed, "exports.auditExportsAllowed"),
      configurationExportsAllowed: booleanAt(exports.configurationExportsAllowed, "exports.configurationExportsAllowed"),
    },
  };
}
