export interface InstallationSettings {
  schemaVersion: "1.0.0";
  language: "en" | "sv";
  regionalFormat?: "en-US" | "sv-SE" | null;
  timeZone?: string | null;
  signIn: {
    brandText: string;
    helperText: string;
  };
  clinicalRetention: { durationHours: number; automaticDeletionEnabled: boolean };
  authentication: {
    sessionDurationMinutes: number;
    idleTimeoutMinutes: number;
    minimumPasswordLength: number;
    temporaryPasswordHours: number;
  };
  offlineRecovery: {
    windowHours: number;
    restartReauthenticationRequired: boolean;
  };
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

function languageAt(value: unknown): "en" | "sv" {
  if (value !== "en" && value !== "sv") throw new TypeError("language must be en or sv");
  return value;
}

function regionalFormatAt(value: unknown): "en-US" | "sv-SE" | null {
  if (value !== null && value !== "en-US" && value !== "sv-SE") throw new TypeError("regionalFormat must be en-US, sv-SE, or null");
  return value;
}

function timeZoneAt(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z_+-]+)+)$/.test(value)) throw new TypeError("timeZone must be a named IANA time zone or null");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); } catch { throw new TypeError("timeZone must be a named IANA time zone or null"); }
  return value;
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

function boundedIntegerAt(value: unknown, path: string, minimum: number, maximum: number): number {
  const parsed = integerAt(value, path, minimum);
  if (parsed > maximum) throw new TypeError(`${path} must be less than or equal to ${maximum}`);
  return parsed;
}

function stringAt(value: unknown, path: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new TypeError(`${path} must be a string between 1 and ${maximumLength} characters`);
  }
  return value;
}

/** Runtime boundary for settings loaded from JSON or deployment configuration. */
export function parseInstallationSettings(value: unknown): InstallationSettings {
  const root = objectAt(value, "installation settings");
  exactKeys(root, "installation settings", ["schemaVersion", "language", ...(root.regionalFormat === undefined ? [] : ["regionalFormat"]), ...(root.timeZone === undefined ? [] : ["timeZone"]), "signIn", "clinicalRetention", "authentication", "offlineRecovery", "exports"]);
  if (root.schemaVersion !== "1.0.0") throw new TypeError("installation settings.schemaVersion must be 1.0.0");
  const signIn = objectAt(root.signIn, "signIn");
  const retention = objectAt(root.clinicalRetention, "clinicalRetention");
  const authentication = objectAt(root.authentication, "authentication");
  const offlineRecovery = objectAt(root.offlineRecovery, "offlineRecovery");
  const exports = objectAt(root.exports, "exports");
  exactKeys(signIn, "signIn", ["brandText", "helperText"]);
  exactKeys(retention, "clinicalRetention", ["durationHours", "automaticDeletionEnabled"]);
  exactKeys(authentication, "authentication", ["sessionDurationMinutes", "idleTimeoutMinutes", "minimumPasswordLength", "temporaryPasswordHours"]);
  exactKeys(offlineRecovery, "offlineRecovery", ["windowHours", "restartReauthenticationRequired"]);
  exactKeys(exports, "exports", ["downloadsAllowed", "auditExportsAllowed", "configurationExportsAllowed"]);
  return {
    schemaVersion: "1.0.0",
    language: languageAt(root.language),
    ...(root.regionalFormat === undefined ? {} : { regionalFormat: regionalFormatAt(root.regionalFormat) }),
    ...(root.timeZone === undefined ? {} : { timeZone: timeZoneAt(root.timeZone) }),
    signIn: {
      brandText: stringAt(signIn.brandText, "signIn.brandText", 100),
      helperText: stringAt(signIn.helperText, "signIn.helperText", 300),
    },
    clinicalRetention: {
      durationHours: integerAt(retention.durationHours, "clinicalRetention.durationHours", 1),
      automaticDeletionEnabled: booleanAt(retention.automaticDeletionEnabled, "clinicalRetention.automaticDeletionEnabled"),
    },
    authentication: {
      sessionDurationMinutes: integerAt(authentication.sessionDurationMinutes, "authentication.sessionDurationMinutes", 15),
      idleTimeoutMinutes: integerAt(authentication.idleTimeoutMinutes, "authentication.idleTimeoutMinutes", 5),
      minimumPasswordLength: integerAt(authentication.minimumPasswordLength, "authentication.minimumPasswordLength", 8),
      temporaryPasswordHours: integerAt(authentication.temporaryPasswordHours, "authentication.temporaryPasswordHours", 1),
    },
    offlineRecovery: {
      windowHours: boundedIntegerAt(offlineRecovery.windowHours, "offlineRecovery.windowHours", 1, 168),
      restartReauthenticationRequired: booleanAt(offlineRecovery.restartReauthenticationRequired, "offlineRecovery.restartReauthenticationRequired"),
    },
    exports: {
      downloadsAllowed: booleanAt(exports.downloadsAllowed, "exports.downloadsAllowed"),
      auditExportsAllowed: booleanAt(exports.auditExportsAllowed, "exports.auditExportsAllowed"),
      configurationExportsAllowed: booleanAt(exports.configurationExportsAllowed, "exports.configurationExportsAllowed"),
    },
  };
}
