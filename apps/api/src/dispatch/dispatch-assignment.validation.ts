type JsonRecord = Record<string, unknown>;

export type DispatchCatalogCode = { readonly code: string; readonly label: string };
export type DispatchCatalogOccurrence = { readonly min: number; readonly max: number | "unbounded" };
export type DispatchCatalogGroup = {
  readonly id: string;
  readonly parentId: string | null;
  readonly occurrence: DispatchCatalogOccurrence;
};
export type DispatchCatalogElement = {
  readonly id: string;
  readonly groupPath: ReadonlyArray<string>;
  readonly occurrence: DispatchCatalogOccurrence;
  readonly nillable: boolean;
  readonly datatype: {
    readonly base: string;
    readonly constraints: Readonly<Record<string, string | number>>;
  };
  readonly permittedNotValues: ReadonlyArray<DispatchCatalogCode>;
  readonly permittedPertinentNegatives: ReadonlyArray<DispatchCatalogCode>;
  readonly valueSource:
    | { readonly kind: "scalar" }
    | { readonly kind: "inline-enumerated"; readonly values: ReadonlyArray<DispatchCatalogCode> }
    | { readonly kind: "bundled-list"; readonly bundledListIds: ReadonlyArray<string> }
    | {
        readonly kind: "external-code-system";
        readonly systems: ReadonlyArray<{ readonly id: string }>;
        readonly bundledListIds: ReadonlyArray<string>;
      };
};
export type DispatchValidationCatalog = {
  readonly release: string;
  readonly dataset: string;
  readonly groups: ReadonlyArray<DispatchCatalogGroup>;
  readonly elements: ReadonlyArray<DispatchCatalogElement>;
  readonly bundledLists: ReadonlyArray<{
    readonly id: string;
    readonly values: ReadonlyArray<DispatchCatalogCode & { readonly codeSystem?: string }>;
  }>;
};

export type DispatchValidationFinding = {
  readonly severity: "error" | "warning";
  readonly code: string;
  /** RFC 6901 JSON Pointer into the submitted snapshot. */
  readonly pointer: string;
  readonly message: string;
  readonly groupId?: string;
  readonly elementId?: string;
};

export type DispatchValidationResult =
  | { readonly status: "rejected"; readonly canonical: null; readonly findings: ReadonlyArray<DispatchValidationFinding> }
  | {
      readonly status: "applied" | "applied_with_findings";
      readonly canonical: JsonRecord;
      readonly findings: ReadonlyArray<DispatchValidationFinding>;
    };

const schemaId = "https://open-triage.dev/schemas/dispatch-message/1.0.0";
const topLevelKeys = new Set([
  "$schema", "messageType", "schemaVersion", "messageId", "sourceRecordId", "revision", "eventType", "sentAt", "dataModel", "groups",
]);
const opaqueIdentity = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const offsetDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const criticalUpsertElements = new Set(["eResponse.03", "eResponse.04", "eResponse.13", "eResponse.14", "eTimes.02", "eTimes.03"]);
const phoneTypeCodes = new Set(["9913001", "9913003", "9913005", "9913007", "9913009"]);

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointer(...segments: Array<string | number>): string {
  return `/${segments.map((part) => String(part).replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function lexical(value: JsonRecord): unknown {
  return value.kind === "coded" ? value.code : value.value;
}

function datatypeError(element: DispatchCatalogElement, value: JsonRecord): string | undefined {
  const supplied = lexical(value);
  const { base, constraints } = element.datatype;
  if (base === "boolean") {
    if (typeof supplied !== "boolean") return "must be a boolean";
  } else if (base === "integer") {
    if (!(typeof supplied === "number" && Number.isSafeInteger(supplied))) return "must be a safe integer";
  } else if (base === "decimal") {
    if (!(typeof supplied === "number" && Number.isFinite(supplied))) return "must be a finite decimal";
  } else if (typeof supplied !== "string") return `must be a string for NEMSIS ${base}`;

  if (typeof supplied === "string") {
    if (base === "date" && (!/^\d{4}-\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$/.test(supplied) || !validCalendarDate(supplied))) return "must be an XSD date";
    if (base === "dateTime" && (!offsetDateTime.test(supplied) || !validCalendarDate(supplied) || Number.isNaN(Date.parse(supplied)))) return "must be an offset-aware XSD dateTime";
    if (base === "time" && !/^\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(supplied)) return "must be an XSD time";
    if (base === "duration" && !/^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(supplied)) return "must be an XSD duration";
    if (base === "binary" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(supplied)) return "must be base64";
    if (base === "anyURI") {
      try { new URL(supplied); } catch { return "must be an absolute URI"; }
    }
  }

  const text = String(supplied);
  if (typeof constraints.length === "number" && text.length !== constraints.length) return `must contain exactly ${constraints.length} characters`;
  if (typeof constraints.minLength === "number" && text.length < constraints.minLength) return `must contain at least ${constraints.minLength} characters`;
  if (typeof constraints.maxLength === "number" && text.length > constraints.maxLength) return `must contain at most ${constraints.maxLength} characters`;
  if (typeof constraints.pattern === "string") {
    try {
      if (!new RegExp(`^(?:${constraints.pattern})$`).test(text)) return "does not match the NEMSIS datatype pattern";
    } catch { return "uses a catalog pattern the server cannot evaluate"; }
  }
  if (typeof supplied === "number") {
    if (constraints.minInclusive !== undefined && supplied < Number(constraints.minInclusive)) return `must be at least ${constraints.minInclusive}`;
    if (constraints.maxInclusive !== undefined && supplied > Number(constraints.maxInclusive)) return `must be at most ${constraints.maxInclusive}`;
    if (constraints.minExclusive !== undefined && supplied <= Number(constraints.minExclusive)) return `must be greater than ${constraints.minExclusive}`;
    if (constraints.maxExclusive !== undefined && supplied >= Number(constraints.maxExclusive)) return `must be less than ${constraints.maxExclusive}`;
  }
  if (typeof supplied === "string" && (base === "date" || base === "dateTime")) {
    const observed = Date.parse(supplied);
    if (constraints.minInclusive !== undefined && observed < Date.parse(String(constraints.minInclusive))) return `must be no earlier than ${constraints.minInclusive}`;
    if (constraints.maxInclusive !== undefined && observed > Date.parse(String(constraints.maxInclusive))) return `must be no later than ${constraints.maxInclusive}`;
    if (constraints.minExclusive !== undefined && observed <= Date.parse(String(constraints.minExclusive))) return `must be later than ${constraints.minExclusive}`;
    if (constraints.maxExclusive !== undefined && observed >= Date.parse(String(constraints.maxExclusive))) return `must be earlier than ${constraints.maxExclusive}`;
  }
  if ((base === "integer" || base === "decimal") && typeof supplied === "number") {
    const normalized = Math.abs(supplied).toString().replace(/[eE].*$/, "");
    const [whole = "", fraction = ""] = normalized.split(".");
    if (typeof constraints.totalDigits === "number" && `${whole}${fraction}`.length > constraints.totalDigits) return `must have at most ${constraints.totalDigits} total digits`;
    if (typeof constraints.fractionDigits === "number" && fraction.length > constraints.fractionDigits) return `must have at most ${constraints.fractionDigits} fraction digits`;
  }
  return undefined;
}

function envelopeFindings(input: unknown, catalog: DispatchValidationCatalog): DispatchValidationFinding[] {
  const findings: DispatchValidationFinding[] = [];
  const add = (code: string, path: string, message: string): void => {
    findings.push({ severity: "error", code, pointer: path, message });
  };
  if (!record(input)) return [{ severity: "error", code: "dispatch.envelope", pointer: "", message: "Dispatch snapshot must be an object" }];
  for (const key of Object.keys(input)) if (!topLevelKeys.has(key)) add("dispatch.envelope.unknown-property", pointer(key), `Unknown envelope property ${key}`);
  if (input.$schema !== schemaId) add("dispatch.envelope.schema", "/$schema", `Unsupported dispatch schema ${String(input.$schema)}`);
  if (input.messageType !== "open-triage.dispatch") add("dispatch.envelope.message-type", "/messageType", "Unsupported message type");
  if (input.schemaVersion !== "1.0.0") add("dispatch.envelope.schema-version", "/schemaVersion", `Unsupported schema version ${String(input.schemaVersion)}`);
  if (typeof input.messageId !== "string" || !uuid.test(input.messageId)) add("dispatch.envelope.message-id", "/messageId", "messageId must be a UUID");
  if (typeof input.sourceRecordId !== "string" || !opaqueIdentity.test(input.sourceRecordId)) add("dispatch.envelope.source-record-id", "/sourceRecordId", "sourceRecordId must be a non-empty opaque identity of at most 200 characters");
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) add("dispatch.envelope.revision", "/revision", "revision must be a positive safe integer");
  if (input.eventType !== "upsert" && input.eventType !== "cancel") add("dispatch.envelope.event-type", "/eventType", "eventType must be upsert or cancel");
  if (typeof input.sentAt !== "string" || !offsetDateTime.test(input.sentAt) || Number.isNaN(Date.parse(input.sentAt))) add("dispatch.envelope.sent-at", "/sentAt", "sentAt must be a valid offset-aware date-time");
  if (!record(input.dataModel)) add("dispatch.envelope.data-model", "/dataModel", "dataModel must be an object");
  else {
    for (const key of Object.keys(input.dataModel)) if (!["standard", "version", "dataset"].includes(key)) add("dispatch.envelope.data-model", pointer("dataModel", key), `Unknown data model property ${key}`);
    if (input.dataModel.standard !== "NEMSIS" || input.dataModel.version !== catalog.release || input.dataModel.dataset !== catalog.dataset) {
      add("dispatch.envelope.data-model", "/dataModel", `Only NEMSIS ${catalog.release} ${catalog.dataset} is supported`);
    }
  }
  if (!Array.isArray(input.groups) || input.groups.length === 0) add("dispatch.envelope.groups", "/groups", "groups must be a non-empty array");
  return findings;
}

function attributesError(element: DispatchCatalogElement, attributes: unknown): string | undefined {
  if (attributes === undefined) return undefined;
  if (!record(attributes) || Object.keys(attributes).length === 0) return "attributes must be a non-empty object";
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value !== "string" || value.length === 0) return `${name} must be a non-empty string`;
    // PhoneNumberType is the dispatch contract's first explicitly supported XSD value attribute.
    if (element.id === "ePatient.18" && name === "PhoneNumberType") {
      if (!phoneTypeCodes.has(value)) return `${value} is not a NEMSIS 3.5.1 PhoneNumberType code`;
    } else return `${name} is not a supported NEMSIS attribute on ${element.id}`;
  }
  return undefined;
}

function valueError(element: DispatchCatalogElement, value: unknown, catalog: DispatchValidationCatalog): string | undefined {
  if (!record(value)) return "value occurrence must be an object";
  if (typeof value.occurrenceId !== "string" || !opaqueIdentity.test(value.occurrenceId)) return "occurrenceId must be an opaque identity";
  const allowedBase = new Set(["kind", "occurrenceId", "attributes"]);
  const attributeError = attributesError(element, value.attributes);
  if (attributeError) return attributeError;

  if (value.kind === "null") {
    allowedBase.add("notValue");
    if (!element.nillable || !record(value.notValue) || typeof value.notValue.code !== "string") return "null is not permitted by this NEMSIS element";
    const notValue = value.notValue;
    const option = element.permittedNotValues.find(({ code }) => code === notValue.code);
    if (!option) return `${String(value.notValue.code)} is not a permitted not-value code`;
    if (value.notValue.display !== undefined && value.notValue.display !== option.label) return "not-value display does not match the pinned catalog";
  } else if (value.kind === "pertinent-negative") {
    allowedBase.add("code"); allowedBase.add("display");
    const option = element.permittedPertinentNegatives.find(({ code }) => code === value.code);
    if (!option) return `${String(value.code)} is not a permitted pertinent-negative code`;
    if (value.display !== undefined && value.display !== option.label) return "pertinent-negative display does not match the pinned catalog";
  } else if (value.kind === "scalar") {
    allowedBase.add("value");
    if (element.valueSource.kind !== "scalar") return "coded NEMSIS content must use kind coded";
    const error = datatypeError(element, value);
    if (error) return error;
  } else if (value.kind === "coded") {
    allowedBase.add("code"); allowedBase.add("display"); allowedBase.add("system"); allowedBase.add("terminologyVersion");
    if (element.valueSource.kind === "scalar") return "scalar NEMSIS content must use kind scalar";
    if (typeof value.code !== "string" || value.code.length === 0) return "coded value requires a code";
    if (value.terminologyVersion !== undefined && (typeof value.terminologyVersion !== "string" || value.terminologyVersion.length === 0)) return "terminologyVersion must be a non-empty string";
    const error = datatypeError(element, value);
    if (error) return error;
    const listIds = "bundledListIds" in element.valueSource ? element.valueSource.bundledListIds : [];
    const options = element.valueSource.kind === "inline-enumerated"
      ? element.valueSource.values
      : listIds.flatMap((id) => catalog.bundledLists.find((list) => list.id === id)?.values ?? []);
    const option = options.find(({ code }) => code === value.code);
    if ((element.valueSource.kind === "inline-enumerated" || listIds.length > 0) && !option) return `${value.code} is not in the pinned NEMSIS value set`;
    if (option && value.display !== undefined && value.display !== option.label) return "display does not match the pinned catalog";
    if (option && "codeSystem" in option && option.codeSystem && value.system !== undefined && value.system !== option.codeSystem) return "code system does not match the pinned catalog";
    if (element.valueSource.kind === "external-code-system" && value.system !== undefined && !element.valueSource.systems.some(({ id }) => id === value.system)) return `${String(value.system)} is not a permitted code system`;
  } else return "value kind is not supported";

  const unexpected = Object.keys(value).find((key) => !allowedBase.has(key));
  return unexpected ? `unknown value property ${unexpected}` : undefined;
}

/**
 * Validates and sanitizes one parsed vendor snapshot against a pinned NEMSIS catalog.
 * Required dispatch content fails atomically; invalid optional occurrences are omitted.
 */
export function validateDispatchAssignment(input: unknown, catalog: DispatchValidationCatalog): DispatchValidationResult {
  const fatal = envelopeFindings(input, catalog);
  if (fatal.length || !record(input) || !Array.isArray(input.groups)) return { status: "rejected", canonical: null, findings: fatal };

  const warnings: DispatchValidationFinding[] = [];
  const groupsById = new Map(catalog.groups.map((group) => [group.id, group]));
  const elementsById = new Map(catalog.elements.map((element) => [element.id, element]));
  const instanceGroups = new Map<string, string>();
  const instanceParents = new Map<string, unknown>();
  const occurrenceIds = new Set<string>();
  const critical = new Set(criticalUpsertElements);
  if (input.eventType === "cancel") critical.add("eTimes.14");
  const add = (severity: "error" | "warning", code: string, path: string, message: string, identities: { groupId?: string; elementId?: string } = {}): void => {
    (severity === "error" ? fatal : warnings).push({ severity, code, pointer: path, message, ...identities });
  };

  for (const [groupIndex, suppliedGroup] of input.groups.entries()) {
    const groupPath = pointer("groups", groupIndex);
    if (!record(suppliedGroup) || typeof suppliedGroup.id !== "string" || !Array.isArray(suppliedGroup.instances) || suppliedGroup.instances.length === 0) {
      add("error", "dispatch.structure.group", groupPath, "Each group must have an id and a non-empty instances array");
      continue;
    }
    if (Object.keys(suppliedGroup).some((key) => !["id", "instances"].includes(key))) add("error", "dispatch.structure.group", groupPath, "Group contains an unknown property", { groupId: suppliedGroup.id });
    const group = groupsById.get(suppliedGroup.id);
    if (!group) {
      add("error", "dispatch.catalog.unknown-group", `${groupPath}/id`, `Unknown or custom NEMSIS group ${suppliedGroup.id}`, { groupId: suppliedGroup.id });
      continue;
    }
    if (group.occurrence.max !== "unbounded" && suppliedGroup.instances.length > group.occurrence.max) add("error", "dispatch.catalog.group-cardinality", `${groupPath}/instances`, `${group.id} exceeds cardinality ${group.occurrence.max}`, { groupId: group.id });
    for (const [instanceIndex, suppliedInstance] of suppliedGroup.instances.entries()) {
      const instancePath = `${groupPath}/instances/${instanceIndex}`;
      if (!record(suppliedInstance) || typeof suppliedInstance.instanceId !== "string" || !opaqueIdentity.test(suppliedInstance.instanceId) || !Array.isArray(suppliedInstance.elements)) {
        add("error", "dispatch.structure.instance", instancePath, "Group instance requires an opaque instanceId and elements array", { groupId: group.id });
        continue;
      }
      if (Object.keys(suppliedInstance).some((key) => !["instanceId", "parentInstanceId", "elements"].includes(key))) add("error", "dispatch.structure.instance", instancePath, "Group instance contains an unknown property", { groupId: group.id });
      if (instanceGroups.has(suppliedInstance.instanceId)) add("error", "dispatch.identity.duplicate-instance", `${instancePath}/instanceId`, `Duplicate instanceId ${suppliedInstance.instanceId}`, { groupId: group.id });
      else {
        instanceGroups.set(suppliedInstance.instanceId, group.id);
        instanceParents.set(suppliedInstance.instanceId, suppliedInstance.parentInstanceId);
      }
    }
  }
  if (fatal.length) return { status: "rejected", canonical: null, findings: fatal };

  const validHierarchy = (instanceId: string, seen = new Set<string>()): boolean => {
    if (seen.has(instanceId)) return false;
    seen.add(instanceId);
    const groupId = instanceGroups.get(instanceId);
    const group = groupId ? groupsById.get(groupId) : undefined;
    if (!group) return false;
    const parentId = instanceParents.get(instanceId);
    if (group.parentId === null) return parentId === undefined;
    return typeof parentId === "string" && instanceGroups.get(parentId) === group.parentId && validHierarchy(parentId, seen);
  };

  const canonicalGroups: JsonRecord[] = [];
  for (const [groupIndex, suppliedGroupValue] of input.groups.entries()) {
    const suppliedGroup = suppliedGroupValue as JsonRecord & { id: string; instances: JsonRecord[] };
    const group = groupsById.get(suppliedGroup.id)!;
    const canonicalInstances: JsonRecord[] = [];
    for (const [instanceIndex, suppliedInstance] of suppliedGroup.instances.entries()) {
      const instancePath = pointer("groups", groupIndex, "instances", instanceIndex);
      const elements = suppliedInstance.elements as unknown[];
      const containsCritical = elements.some((element) => record(element) && typeof element.id === "string" && critical.has(element.id));
      const parentId = suppliedInstance.parentInstanceId;
      const validParent = validHierarchy(suppliedInstance.instanceId as string);
      if (!validParent) {
        add(containsCritical ? "error" : "warning", "dispatch.catalog.group-placement", `${instancePath}/parentInstanceId`, group.parentId === null ? `${group.id} must not have a parent` : `${group.id} requires a parent instance of ${group.parentId}`, { groupId: group.id });
        continue;
      }

      const canonicalElements: JsonRecord[] = [];
      const seenElements = new Set<string>();
      for (const [elementIndex, suppliedElement] of elements.entries()) {
        const elementPath = `${instancePath}/elements/${elementIndex}`;
        if (!record(suppliedElement) || typeof suppliedElement.id !== "string" || !Array.isArray(suppliedElement.values) || suppliedElement.values.length === 0) {
          add("warning", "dispatch.structure.element", elementPath, "Optional element must have an id and a non-empty values array", { groupId: group.id });
          continue;
        }
        const element = elementsById.get(suppliedElement.id);
        if (!element) {
          add("error", "dispatch.catalog.unknown-element", `${elementPath}/id`, `Unknown or custom NEMSIS element ${suppliedElement.id}`, { groupId: group.id, elementId: suppliedElement.id });
          continue;
        }
        const isCritical = critical.has(element.id);
        if (Object.keys(suppliedElement).some((key) => !["id", "values"].includes(key))) {
          add(isCritical ? "error" : "warning", "dispatch.structure.element", elementPath, "Element contains an unknown property", { groupId: group.id, elementId: element.id });
          continue;
        }
        if (seenElements.has(element.id)) {
          add(isCritical ? "error" : "warning", "dispatch.catalog.element-cardinality", elementPath, `${element.id} is supplied more than once in this group instance`, { groupId: group.id, elementId: element.id });
          continue;
        }
        seenElements.add(element.id);
        if (element.groupPath.at(-1) !== group.id) {
          add(isCritical ? "error" : "warning", "dispatch.catalog.element-placement", `${elementPath}/id`, `${element.id} is not valid in ${group.id}`, { groupId: group.id, elementId: element.id });
          continue;
        }
        if (element.occurrence.max !== "unbounded" && suppliedElement.values.length > element.occurrence.max) {
          add(isCritical ? "error" : "warning", "dispatch.catalog.element-cardinality", `${elementPath}/values`, `${element.id} exceeds cardinality ${element.occurrence.max}`, { groupId: group.id, elementId: element.id });
          continue;
        }
        const canonicalValues: unknown[] = [];
        for (const [valueIndex, suppliedValue] of suppliedElement.values.entries()) {
          const valuePath = `${elementPath}/values/${valueIndex}`;
          let error = valueError(element, suppliedValue, catalog);
          if (!error && isCritical && record(suppliedValue) && suppliedValue.kind !== "scalar" && suppliedValue.kind !== "coded") error = "required dispatch content must have a concrete, non-null value";
          const occurrenceId = record(suppliedValue) ? suppliedValue.occurrenceId : undefined;
          const duplicate = typeof occurrenceId === "string" && occurrenceIds.has(occurrenceId);
          if (error || duplicate) {
            add(isCritical ? "error" : "warning", duplicate ? "dispatch.identity.duplicate-occurrence" : "dispatch.catalog.value", valuePath, duplicate ? `Duplicate occurrenceId ${occurrenceId}` : error!, { groupId: group.id, elementId: element.id });
            continue;
          }
          occurrenceIds.add(occurrenceId as string);
          canonicalValues.push(suppliedValue);
        }
        if (canonicalValues.length) canonicalElements.push({ id: element.id, values: canonicalValues });
      }
      canonicalInstances.push({ instanceId: suppliedInstance.instanceId, ...(parentId === undefined ? {} : { parentInstanceId: parentId }), elements: canonicalElements });
    }
    if (canonicalInstances.length) canonicalGroups.push({ id: group.id, instances: canonicalInstances });
  }

  const acceptedIds = new Map<string, number>();
  for (const group of canonicalGroups) for (const instance of group.instances as JsonRecord[]) for (const element of instance.elements as JsonRecord[]) acceptedIds.set(element.id as string, (acceptedIds.get(element.id as string) ?? 0) + (element.values as unknown[]).length);
  for (const elementId of critical) {
    if (acceptedIds.get(elementId) !== 1) add("error", "dispatch.required", "/groups", `${elementId} requires exactly one valid concrete value`, { elementId });
  }
  if (fatal.length) return { status: "rejected", canonical: null, findings: [...fatal, ...warnings] };
  const canonical: JsonRecord = { ...input, groups: canonicalGroups };
  return { status: warnings.length ? "applied_with_findings" : "applied", canonical, findings: warnings };
}
