import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import type { ShellState } from "./standard-encounter";
import { bundledEncounterDefinition } from "./standard-encounter";
import { getNemsisGroup, requireNemsisDataElement, resolveNemsisElementValues } from "./nemsis-data-model";

export const DRAFT_SAVE_DEBOUNCE_MS = 1_000;
export type DraftSyncStatus = "Saved" | "Saving" | "Pending sync" | "Conflict";

export interface ActiveDraftReport {
  readonly id: string;
  readonly revision: number;
  readonly formVersionId: string;
  readonly callNumber?: string;
  readonly documentingUserId?: string;
  readonly catalogReleaseId?: string;
  readonly status?: "draft";
}

export interface DraftGroupMutation {
  readonly id: string;
  readonly groupId: string;
  readonly parentGroupInstanceId?: string | null;
  readonly ordinal: number;
  readonly documentedTime?: string;
}

export type DraftValue =
  | { readonly kind: "text" | "uri"; readonly value: string }
  | { readonly kind: "integer" | "numeric"; readonly value: string | number; readonly lexical?: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "date" | "datetime" | "time" | "duration"; readonly value: string }
  | { readonly kind: "binary"; readonly value: string }
  | { readonly kind: "coded"; readonly code: string; readonly codeSystem?: string; readonly display?: string }
  | { readonly kind: "null" | "pertinent-negative"; readonly absenceCode: string; readonly display?: string }
  | { readonly kind: "absent"; readonly absenceCode?: string; readonly display?: string };

export interface DraftOccurrenceMutation {
  readonly id: string;
  readonly elementId: string;
  readonly groupInstanceId: string;
  readonly ordinal: number;
  readonly sourceAttributes?: Record<string, unknown>;
  readonly value: DraftValue;
}

export interface SaveDraftReportCommand {
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly authorId: string;
  readonly deviceId: string;
  readonly clientTime: string;
  readonly groups: ReadonlyArray<DraftGroupMutation>;
  readonly occurrences: ReadonlyArray<DraftOccurrenceMutation>;
}

export interface SavedDraftReport { readonly id: string; readonly revision: number; readonly status: "draft" }

/** Produces an RFC-4122-shaped, deterministic identity for a local report entity. */
export function stableDraftId(reportId: string, localId: string): string {
  const hash = (seed: number) => {
    let value = seed;
    for (const character of `${reportId}:${localId}`) value = Math.imul(value ^ character.charCodeAt(0), 16_777_619);
    return (value >>> 0).toString(16).padStart(8, "0");
  };
  const hex = `${hash(2_166_136_261)}${hash(2_166_136_262)}${hash(2_166_136_263)}${hash(2_166_136_264)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function draftValue(elementId: string, value: EncounterValue): DraftValue {
  if (value.kind === "coded") return { kind: "coded", code: value.code, ...(value.system ? { codeSystem: value.system } : {}), ...(value.display ? { display: value.display } : {}) };
  if (value.kind === "pertinent-negative") return { kind: "pertinent-negative", absenceCode: value.code, ...(value.display ? { display: value.display } : {}) };
  if (value.kind === "null") return value.notValue
    ? { kind: "null", absenceCode: value.notValue.code, ...(value.notValue.display ? { display: value.notValue.display } : {}) }
    : { kind: "absent" };
  if (value.kind === "absent") return { kind: "absent" };
  const base = requireNemsisDataElement(elementId).datatype.base;
  if (base === "integer") return { kind: "integer", value: typeof value.value === "boolean" ? Number(value.value) : value.value };
  if (["decimal", "double", "float"].includes(base)) return { kind: "numeric", value: typeof value.value === "boolean" ? Number(value.value) : value.value };
  if (base === "boolean") return { kind: "boolean", value: Boolean(value.value) };
  if (base === "date") return { kind: "date", value: String(value.value) };
  if (base === "dateTime") return { kind: "datetime", value: String(value.value) };
  if (base === "time") return { kind: "time", value: String(value.value) };
  if (base === "duration") return { kind: "duration", value: String(value.value) };
  if (base === "anyURI") return { kind: "uri", value: String(value.value) };
  if (base === "base64Binary") return { kind: "binary", value: String(value.value) };
  return { kind: "text", value: String(value.value) };
}

function eventDocument(shell: ShellState): EncounterDocument {
  const groups = shell.encounter.document.groups.filter(({ id }) => !["eNarrativeSection", "eVitals.VitalGroup", "eMedications.MedicationGroup", "eMedications.DosageGroup", "eProcedures.ProcedureGroup"].includes(id));
  const eventGroups: Array<EncounterDocument["groups"][number]> = [];
  const coded = (elementId: string, label: string) => {
    const option = resolveNemsisElementValues(requireNemsisDataElement(elementId)).permissibleValues.find((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    return option ? { kind: "coded" as const, code: option.code, display: option.label } : null;
  };
  const timestamp = (date: string | undefined, time: string) => `${date ?? "2026-04-18"}T${time}:00Z`;
  for (const event of shell.encounter.events) {
    if (event.kind === "note") eventGroups.push({ id: "eNarrativeSection", instances: [{ instanceId: event.id, attributes: { documentedTime: timestamp(event.date, event.time) }, elements: [{ id: "eNarrative.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:narrative`, value: event.detail }] }] }] });
    if (event.vitals) {
      const elements: Array<{ id: string; value: EncounterValue }> = [
        { id: "eVitals.01", value: { kind: "scalar", occurrenceId: `${event.id}:time`, value: timestamp(event.date, event.time) } },
      ];
      bundledEncounterDefinition.events.vitals.fields.forEach((field) => {
          const raw = event.vitals![field.id];
          const absence = event.vitals!.nullValues[field.id];
          if (raw) {
            elements.push({ id: field.reference, value: { kind: "scalar", occurrenceId: `${event.id}:${field.reference}`, value: Number(raw) } });
            return;
          }
          if (!absence) return;
          const pertinent = field.absenceStates.find((item) => item.code === absence)?.kind === "PN";
          elements.push({ id: field.reference, value: pertinent
            ? { kind: "pertinent-negative", occurrenceId: `${event.id}:${field.reference}`, code: absence }
            : { kind: "null", occurrenceId: `${event.id}:${field.reference}`, notValue: { code: absence } } });
        });
      eventGroups.push({ id: "eVitals.VitalGroup", instances: [{ instanceId: event.id, attributes: { documentedTime: timestamp(event.date, event.time) }, elements: elements.map(({ id, value }) => ({ id, values: [value] })) }] });
    }
    if (event.procedure) {
      const procedure = event.procedure;
      const success = coded("eProcedures.06", procedure.success);
      const outcome = coded("eProcedures.08", procedure.outcome);
      const complications = procedure.complications.map((code, index) => ({ kind: "coded" as const, occurrenceId: `${event.id}:complication:${index}`, code }));
      eventGroups.push({ id: "eProcedures.ProcedureGroup", instances: [{ instanceId: event.id, attributes: { documentedTime: timestamp(event.date, event.time) }, elements: [
        { id: "eProcedures.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: timestamp(event.date, event.time) }] },
        { id: "eProcedures.03", values: [{ kind: "coded", occurrenceId: `${event.id}:procedure`, code: procedure.code, system: "SNOMED-CT", display: procedure.label, attributes: { warningAcknowledged: procedure.warningAcknowledged } }] },
        { id: "eProcedures.05", values: [{ kind: "scalar", occurrenceId: `${event.id}:attempts`, value: procedure.attempts }] },
        ...(success ? [{ id: "eProcedures.06", values: [{ ...success, occurrenceId: `${event.id}:success` }] }] : []),
        ...(outcome ? [{ id: "eProcedures.08", values: [{ ...outcome, occurrenceId: `${event.id}:outcome` }] }] : []),
        ...(complications.length ? [{ id: "eProcedures.07", values: complications }] : []),
      ] }] });
    }
    if (event.medication) {
      const medication = event.medication;
      const route = coded("eMedications.04", medication.route.replace(/^.*?—\s*/, "")) ?? coded("eMedications.04", medication.route);
      const unit = coded("eMedications.06", medication.unit);
      const response = coded("eMedications.07", medication.response);
      eventGroups.push({ id: "eMedications.MedicationGroup", instances: [{ instanceId: event.id, attributes: { documentedTime: timestamp(event.date, event.time) }, elements: [
        { id: "eMedications.01", values: [{ kind: "scalar", occurrenceId: `${event.id}:time`, value: timestamp(event.date, event.time) }] },
        { id: "eMedications.03", values: [{ kind: "coded", occurrenceId: `${event.id}:medication`, code: medication.medicationCode, system: medication.codeType, display: medication.label, attributes: { response: medication.response, warningAcknowledged: medication.warningAcknowledged } }] },
        ...(route ? [{ id: "eMedications.04", values: [{ ...route, occurrenceId: `${event.id}:route` }] }] : []),
        ...(response ? [{ id: "eMedications.07", values: [{ ...response, occurrenceId: `${event.id}:response` }] }] : []),
      ] }] });
      eventGroups.push({ id: "eMedications.DosageGroup", instances: [{ instanceId: `${event.id}:dosage`, attributes: { documentedTime: timestamp(event.date, event.time) }, elements: [
        { id: "eMedications.05", values: [{ kind: "scalar", occurrenceId: `${event.id}:dose`, value: Number(medication.dose) }] },
        ...(unit ? [{ id: "eMedications.06", values: [{ ...unit, occurrenceId: `${event.id}:unit` }] }] : []),
      ] }] });
    }
  }
  return { ...shell.encounter.document, groups: [...groups, ...eventGroups] };
}

export function shellStateToDraftMutations(reportId: string, shell: ShellState): Pick<SaveDraftReportCommand, "groups" | "occurrences"> {
  const document = eventDocument(shell);
  const instances = new Map(document.groups.flatMap((group) => group.instances.map((instance) => [`${group.id}:${instance.instanceId}`, instance] as const)));
  const groups: DraftGroupMutation[] = [];
  const occurrences: DraftOccurrenceMutation[] = [];
  document.groups.forEach((group) => {
    if (!getNemsisGroup(group.id)) return; // Custom fields require their pinned form-field identities.
    group.instances.forEach((instance, ordinal) => {
      const parentGroupId = getNemsisGroup(group.id)?.parentId;
      const parentCandidates = parentGroupId ? [...instances.entries()].filter(([key]) => key.startsWith(`${parentGroupId}:`)).map(([, candidate]) => candidate) : [];
      const parent = parentCandidates.find((candidate) => candidate.instanceId === instance.instanceId || instance.instanceId.startsWith(`${candidate.instanceId}:`)) ?? parentCandidates[0];
      const groupInstanceId = stableDraftId(reportId, `group:${instance.instanceId}`);
      const documentedTime = typeof instance.attributes?.documentedTime === "string" ? instance.attributes.documentedTime : undefined;
      groups.push({ id: groupInstanceId, groupId: group.id, ordinal, ...(parent ? { parentGroupInstanceId: stableDraftId(reportId, `group:${parent.instanceId}`) } : {}), ...(documentedTime ? { documentedTime } : {}) });
      instance.elements.forEach((element) => element.values.forEach((value, valueOrdinal) => {
        occurrences.push({
          id: stableDraftId(reportId, `occurrence:${value.occurrenceId}`), elementId: element.id,
          groupInstanceId, ordinal: valueOrdinal, ...(value.attributes ? { sourceAttributes: value.attributes } : {}),
          value: draftValue(element.id, value),
        });
      }));
    });
  });
  return { groups, occurrences };
}

function apiBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true" || process.env.NEXT_PUBLIC_BASE_PATH) return null;
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

export function usesLocalDemoDrafts(): boolean {
  return apiBaseUrl() === null;
}

export function draftChangesUrl(reportId: string): string {
  const base = apiBaseUrl();
  const path = `/api/reports/${reportId}/draft-changes`;
  return base ? `${base}${path}` : `${process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? ""}${path}`;
}

export async function saveDraftReport(accessToken: string, reportId: string, command: SaveDraftReportCommand): Promise<SavedDraftReport> {
  let response: Response;
  try {
    response = await fetch(draftChangesUrl(reportId), { method: "POST", cache: "no-store", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(command) });
  } catch {
    throw new Error("offline");
  }
  if (response.status === 409) throw new Error("conflict");
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "offline");
  return response.json() as Promise<SavedDraftReport>;
}

export async function signDraftReport(
  accessToken: string,
  reportId: string,
  expectedRevision: number,
  signerId: string,
  warningAcknowledgements: ReadonlyArray<string>,
): Promise<void> {
  const base = apiBaseUrl();
  if (!base) return;
  let response: Response;
  try {
    response = await fetch(`${base}/api/reports/${reportId}/sign`, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        commandId: crypto.randomUUID(),
        expectedRevision,
        signerId,
        attestation: { meaning: "clinician approval" },
        warningAcknowledgements: Object.fromEntries(warningAcknowledgements.map((id) => [id, true])),
        deviceId: `web:${reportId}`,
        clientTime: new Date().toISOString(),
      }),
    });
  } catch {
    throw new Error("The record could not be signed. Check your connection and try again.");
  }
  if (response.status === 409) throw new Error("The record changed before it could be signed. Reopen it and try again.");
  if (response.status === 422) throw new Error("The record did not pass server validation and was not signed.");
  if (!response.ok) throw new Error(response.status === 401 ? "Your shift session has ended." : "The record could not be signed.");
}
