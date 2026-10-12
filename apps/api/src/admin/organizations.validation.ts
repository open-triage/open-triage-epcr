import { BadRequestException } from "@nestjs/common";
import type { CreateAgencyCommand, UpdateAgencyCommand } from "@open-triage/contracts";

import { validateUpdateAgencyMediaSettings } from "./agency-settings.validation.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Agency details are required");
  return input as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BadRequestException(`${label} is required and must contain at most ${max} characters`);
  }
  return value.trim();
}
export function agencyHostnameSuffix(): string | null {
  const configured = process.env.AGENCY_BASE_DOMAIN?.trim().toLowerCase();
  let domain: string;
  try { domain = configured || new URL(process.env.WEB_ORIGIN ?? "http://localhost:3000").hostname; }
  catch { return null; }
  if (/^[0-9.]+$/.test(domain) || domain.split(".").some((label) =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return domain;
}

export function agencyHostname(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  let hostname = text(value, "Hostname", 253).toLowerCase();
  if (!hostname.includes(".")) {
    const suffix = agencyHostnameSuffix();
    if (suffix) hostname = `${hostname}.${suffix}`;
  }
  if (hostname.length > 253 || !hostname.includes(".") || hostname.split(".").some((label) =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new BadRequestException("Use a hostname such as test.opentriage.org, without a scheme, port or path");
  }
  return hostname;
}
export function validateCreateAgency(input: unknown): CreateAgencyCommand {
  const body = object(input);
  const parent = body.parentOrganizationId ?? null;
  if (parent !== null && (typeof parent !== "string" || !uuid.test(parent))) throw new BadRequestException("Choose a valid parent agency");
  if (typeof body.catalogReleaseId !== "string" || !uuid.test(body.catalogReleaseId)) throw new BadRequestException("Choose a published catalog");
  const startingFormVersionId = body.startingFormVersionId ?? null;
  const startingValidationVersionId = body.startingValidationVersionId ?? null;
  if (startingFormVersionId !== null && (typeof startingFormVersionId !== "string" || !uuid.test(startingFormVersionId))
    || startingValidationVersionId !== null && (typeof startingValidationVersionId !== "string" || !uuid.test(startingValidationVersionId)))
    throw new BadRequestException("Choose published starting configurations");
  if (Boolean(startingFormVersionId) !== Boolean(startingValidationVersionId))
    throw new BadRequestException("Choose both a starting form and validation rules");
  const settings = body.settings === undefined ? undefined
    : validateUpdateAgencyMediaSettings({ ...object(body.settings), expectedRevision: 1 });
  const timeZone = text(settings ? settings.timeZone ?? "UTC" : body.timeZone, "Time zone", 100);
  try { new Intl.DateTimeFormat("en", { timeZone }); } catch { throw new BadRequestException("Choose a valid IANA time zone"); }
  return { name: text(body.name, "Agency name"), parentOrganizationId: parent,
    hostname: agencyHostname(body.hostname), timeZone, catalogReleaseId: body.catalogReleaseId,
    startingFormVersionId, startingValidationVersionId,
    ...(settings ? { settings } : {}),
    agencyUniqueStateId: text(settings?.demographics.agencyUniqueStateId ?? body.agencyUniqueStateId, "Agency unique state ID", 100),
    agencyNumber: text(settings?.demographics.agencyNumber ?? body.agencyNumber, "Agency number", 100), stateCode: text(settings?.demographics.stateCode ?? body.stateCode, "State code", 100) };
}
export function validateUpdateAgency(input: unknown): UpdateAgencyCommand {
  const body = object(input);
  if (Object.hasOwn(body, "parentOrganizationId")) throw new BadRequestException("Existing agencies cannot move between agency groups");
  if (typeof body.active !== "boolean" || !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
    throw new BadRequestException("Agency status and revision are required");
  }
  return { name: text(body.name, "Agency name"), hostname: agencyHostname(body.hostname),
    active: body.active, expectedRevision: Number(body.expectedRevision) };
}
