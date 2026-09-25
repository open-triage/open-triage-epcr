import { UnprocessableEntityException } from "@nestjs/common";
import {
  DEFAULT_AGENCY_APPEARANCE,
  MAX_REPORT_MEDIA_ALLOWANCE_BYTES,
  MIN_REPORT_MEDIA_ALLOWANCE_BYTES,
  type AgencyAppearance,
  type UpdateAgencyMediaSettingsCommand,
} from "@open-triage/contracts";

const MEBIBYTE = 1024 * 1024;
const CONTROL_CHARACTER = /[\p{Cc}\p{Cf}]/u;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_LOGO_BYTES = 128 * 1024;

function text(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") throw new UnprocessableEntityException(`${name} must be text`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized.length > maximum || CONTROL_CHARACTER.test(normalized)) {
    throw new UnprocessableEntityException(`${name} must contain 1-${maximum} visible characters`);
  }
  return normalized;
}

function optionalText(value: unknown, name: string, maximum: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, name, maximum);
}

function color(value: unknown, name: string): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new UnprocessableEntityException(`${name} must be a lowercase six-digit hex color`);
  }
  return value;
}

function relativeLuminance(value: string): number {
  const components = [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255)
    .map((component) => component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4);
  return components[0]! * 0.2126 + components[1]! * 0.7152 + components[2]! * 0.0722;
}

export function contrastRatio(left: string, right: string): number {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

function appearance(value: unknown): AgencyAppearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnprocessableEntityException("appearance must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(Object.keys(DEFAULT_AGENCY_APPEARANCE));
  if (Object.keys(candidate).some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => !(key in candidate))) {
    throw new UnprocessableEntityException("appearance must contain exactly the supported properties");
  }
  const helperText = text(candidate.helperText, "appearance.helperText", 300);
  if (helperText !== DEFAULT_AGENCY_APPEARANCE.helperText &&
      (/\b(?:password|passcode|credential|token|secret)\s*[:=]/iu.test(helperText) ||
       /\busername\b[\s\S]{0,80}\bpassword\b/iu.test(helperText))) {
    throw new UnprocessableEntityException("appearance.helperText must not disclose credentials or secrets");
  }
  let logoPngDataUrl: string | null = null;
  if (candidate.logoPngDataUrl !== null) {
    if (typeof candidate.logoPngDataUrl !== "string") {
      throw new UnprocessableEntityException("appearance.logoPngDataUrl must be a PNG data URL or null");
    }
    const matched = PNG_DATA_URL.exec(candidate.logoPngDataUrl);
    let bytes: Buffer;
    try { bytes = Buffer.from(matched?.[1] ?? "", "base64"); }
    catch { throw new UnprocessableEntityException("appearance.logoPngDataUrl is not valid base64"); }
    if (!matched || bytes.length < 24 || bytes.length > MAX_LOGO_BYTES ||
        !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new UnprocessableEntityException("appearance.logoPngDataUrl must be a valid PNG no larger than 128 KiB");
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 1024 || height > 1024) {
      throw new UnprocessableEntityException("appearance logo dimensions must be between 1 and 1024 pixels");
    }
    logoPngDataUrl = candidate.logoPngDataUrl;
  }
  const accentColor = color(candidate.accentColor, "appearance.accentColor");
  const accentDarkColor = color(candidate.accentDarkColor, "appearance.accentDarkColor");
  if (contrastRatio(accentColor, "#ffffff") < 4.5 || contrastRatio(accentDarkColor, "#ffffff") < 4.5) {
    throw new UnprocessableEntityException("accent colors must have at least 4.5:1 contrast against white");
  }
  return {
    brandText: text(candidate.brandText, "appearance.brandText", 100), helperText, logoPngDataUrl,
    accentColor, accentDarkColor,
    browserThemeColor: color(candidate.browserThemeColor, "appearance.browserThemeColor"),
    pwaBackgroundColor: color(candidate.pwaBackgroundColor, "appearance.pwaBackgroundColor"),
    pwaName: text(candidate.pwaName, "appearance.pwaName", 100),
    pwaShortName: text(candidate.pwaShortName, "appearance.pwaShortName", 30),
  };
}

function demographics(value: unknown): UpdateAgencyMediaSettingsCommand["demographics"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UnprocessableEntityException("demographics must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set(["agencyUniqueStateId", "agencyNumber", "stateCode", "stateDisplay",
    "stateCodeSystem", "stateTerminologyVersion"]);
  if (Object.keys(candidate).some((key) => !allowed.has(key)) || [...allowed].some((key) => !(key in candidate))) {
    throw new UnprocessableEntityException("demographics must contain exactly the supported dAgency properties");
  }
  const stateCode = text(candidate.stateCode, "demographics.stateCode", 2);
  if (!/^[0-9]{2}$/.test(stateCode)) {
    throw new UnprocessableEntityException("demographics.stateCode must be a two-digit ANSI state code");
  }
  const stateCodeSystem = optionalText(candidate.stateCodeSystem, "demographics.stateCodeSystem", 100);
  if (stateCodeSystem !== null && stateCodeSystem !== "ANSI-STATE") {
    throw new UnprocessableEntityException("demographics.stateCodeSystem must be ANSI-STATE when supplied");
  }
  return {
    agencyUniqueStateId: text(candidate.agencyUniqueStateId, "demographics.agencyUniqueStateId", 50),
    agencyNumber: text(candidate.agencyNumber, "demographics.agencyNumber", 15), stateCode,
    stateDisplay: optionalText(candidate.stateDisplay, "demographics.stateDisplay", 100),
    stateCodeSystem, stateTerminologyVersion: optionalText(candidate.stateTerminologyVersion,
      "demographics.stateTerminologyVersion", 100),
  };
}

export function validateUpdateAgencyMediaSettings(input: unknown): UpdateAgencyMediaSettingsCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UnprocessableEntityException("Agency Settings must be an object");
  }
  const body = input as Record<string, unknown>;
  const allowedKeys = new Set(["expectedRevision", "reportMediaAllowanceBytes", "imageMediaLimitBytes", "appearance", "demographics"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new UnprocessableEntityException("Agency Settings contains an unsupported property");
  }
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
    throw new UnprocessableEntityException("expectedRevision must be a positive integer");
  }
  const allowance = Number(body.reportMediaAllowanceBytes);
  if (!Number.isSafeInteger(body.reportMediaAllowanceBytes) ||
      allowance < MIN_REPORT_MEDIA_ALLOWANCE_BYTES || allowance > MAX_REPORT_MEDIA_ALLOWANCE_BYTES ||
      allowance % MEBIBYTE !== 0) {
    throw new UnprocessableEntityException(
      "reportMediaAllowanceBytes must be a whole MiB between 1 MiB and 2 GiB"
    );
  }
  const imageLimit = Number(body.imageMediaLimitBytes);
  if (!Number.isSafeInteger(body.imageMediaLimitBytes) ||
      imageLimit < MIN_REPORT_MEDIA_ALLOWANCE_BYTES || imageLimit > MAX_REPORT_MEDIA_ALLOWANCE_BYTES ||
      imageLimit % MEBIBYTE !== 0 || imageLimit > allowance) {
    throw new UnprocessableEntityException(
      "imageMediaLimitBytes must be a whole MiB between 1 MiB and the total report media allowance"
    );
  }
  return { expectedRevision: Number(body.expectedRevision), reportMediaAllowanceBytes: allowance,
    imageMediaLimitBytes: imageLimit,
    appearance: appearance(body.appearance), demographics: demographics(body.demographics) };
}
