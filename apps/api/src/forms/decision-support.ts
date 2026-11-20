import { createHash } from "node:crypto";
import { localizedWestDefinition, shippedWestDefinition, westCatalogText, westColourLabels } from "../../../../defines/decision_support/west-localization.mjs";
import { ConflictException, Logger } from "@nestjs/common";
import {
  WEST_A_DECISION_SUPPORT_KEY,
  decisionSupportCategoryCriteria,
  decisionSupportPickerCategories,
  isSelectableDecisionSupportCriterion,
  type CatalogDraftCustomCodedElement,
  type ClinicalDecisionSupportConfiguration,
  type DecisionSupportCatalogElement,
  type DecisionSupportDefinition,
  type DecisionSupportFieldName,
  type DecisionSupportNumericInput,
} from "@open-triage/contracts";
import type { EntityManager } from "typeorm";
import { validateDecisionSupportDefinition } from "./decision-support-definition.js";

export const DECISION_SUPPORT_NAMESPACE = "west.opentriage.org";

type Manager = Pick<EntityManager, "query">;
type CodeChoice = CatalogDraftCustomCodedElement["choices"][number];

const logger = new Logger("DecisionSupport");
const slugByField = {
  categories: "Categories",
  criteria: "Criteria",
  noWarningCriteria: "NoWarningCriteria",
  newsScale: "NewsScale",
  overrideColour: "OverrideColour",
  physiologyScore: "PhysiologyScore",
} satisfies Record<DecisionSupportFieldName, string>;
const supportedNumericTypes = new Set(["integer", "decimal"]);

let shippedWest: DecisionSupportDefinition | undefined;

function invalidConfiguration(reason: string): ConflictException {
  logger.error(reason);
  return new ConflictException({ code: "clinical.decisionSupportInvalid" });
}

function shippedDefinition(key: string): DecisionSupportDefinition {
  if (key !== WEST_A_DECISION_SUPPORT_KEY) throw invalidConfiguration(`Unsupported decision support system ${key}`);
  try {
    return shippedWest ??= validateDecisionSupportDefinition(shippedWestDefinition());
  } catch (error) {
    throw invalidConfiguration(`Unable to load the shipped decision support definition: ${String(error)}`);
  }
}

function choice(code: string, label: string, swedishLabel: string): CodeChoice {
  return { code, label, localization: { schemaVersion: 1, sv: { label: swedishLabel, reviewedSource: { label } } } };
}

function findingLabels(definition: DecisionSupportDefinition, language: "en" | "sv") {
  const categories = new Map<string, string>();
  const criteria = new Map<string, string>();
  const { noneOption } = definition.assessment.elements.criteria;
  for (const category of decisionSupportPickerCategories(definition.categories)) {
    categories.set(category.id, category.displayLabel ?? category.category);
    for (const { criterion, labelSuffix } of decisionSupportCategoryCriteria(category)) {
      if (!isSelectableDecisionSupportCriterion(criterion)) continue;
      const label = criterion.displayLabel ?? criterion.text;
      criteria.set(criterion.id, labelSuffix ? `${label} (${labelSuffix[language]})` : label);
    }
    criteria.set(`${category.id}.${noneOption.code}`, noneOption.label[language]);
  }
  return { categories, criteria };
}

function catalogFindingLabels(pinned: DecisionSupportDefinition) {
  return { english: findingLabels(localizedWestDefinition(pinned, "en"), "en"), swedish: findingLabels(pinned, "sv") };
}

/** The catalog identity depends on the installation and field, not the currently shipped version. */
function elementIdentity(namespace: string, slug: string): string {
  const uuidNamespace = Buffer.from("aec98e8f2405491eb420dc68ad66984e", "hex");
  const bytes = createHash("sha1").update(uuidNamespace).update(`${namespace}.${slug}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

export function decisionSupportCatalogFields(definition: DecisionSupportDefinition, organizationId: string):
ClinicalDecisionSupportConfiguration["fields"] {
  function base(field: DecisionSupportFieldName, recurrence: "single" | "multiple") {
    const slug = `Org${organizationId.replaceAll("-", "")}_${slugByField[field]}`;
    const english = westCatalogText(field, "en");
    const swedish = westCatalogText(field, "sv");
    return {
      id: elementIdentity(DECISION_SUPPORT_NAMESPACE, slug),
      namespace: DECISION_SUPPORT_NAMESPACE,
      slug,
      title: english.label,
      definition: english.description,
      recurrence,
      correlatesTo: definition.assessment.group,
      usage: "Optional" as const,
      identifying: false,
      decisionSupportField: field,
      localization: { schemaVersion: 1 as const, sv: { ...swedish, reviewedSource: english } },
    };
  }
  function coded(field: DecisionSupportFieldName, recurrence: "single" | "multiple", choices: CodeChoice[]) {
    return {
      ...base(field, recurrence),
      datatype: "coded" as const,
      codeSystem: `https://opentriage.org/codes/${definition.key}/${field}`,
      choices,
      permittedNotValues: [],
      permittedPertinentNegatives: [],
    };
  }
  const { english, swedish } = catalogFindingLabels(definition);
  function findingField(field: "categories" | "criteria") {
    return coded(field, "multiple", Array.from(swedish[field], ([code, label]) =>
      choice(code, english[field].get(code) ?? label, label)));
  }
  const scale = definition.assessment.elements.newsScale;
  return {
    categories: findingField("categories"),
    criteria: findingField("criteria"),
    noWarningCriteria: { ...base("noWarningCriteria", "single"), datatype: "boolean", constraints: {} },
    newsScale: coded("newsScale", "single", Object.entries(scale.values).map(([code, value]) =>
      choice(code, value.label.en, value.label.sv))),
    overrideColour: coded("overrideColour", "single", definition.assessment.result.overrideAllowed.map((colour) =>
      choice(colour, westColourLabels[colour].en, definition.triage_colors[colour]))),
    physiologyScore: { ...base("physiologyScore", "single"), datatype: "number", constraints: { minimum: 0 },
      integer: true, readOnly: true },
  };
}

async function validateCatalogBindings(manager: Manager, releaseId: string, definition: DecisionSupportDefinition): Promise<void> {
  const inputs = Object.values(definition.inputs).filter((input): input is DecisionSupportNumericInput => "element" in input);
  const [catalog] = await manager.query<Array<{ key: string; vital_group: boolean }>>(`select
    lower(standard) || '-' || coalesce(provenance->>'dataModelVersion', version) as key,
    exists(select 1 from catalog.group_definition where release_id=$1 and group_id=$2 and repeating) as vital_group
    from catalog.release where id=$1 and sealed`, [releaseId, definition.assessment.group]);
  if (catalog?.key !== definition.catalogKey || !catalog.vital_group) {
    throw invalidConfiguration(`Vital group ${definition.assessment.group} is unavailable in catalog ${releaseId}`);
  }
  const observed = await manager.query<Array<{ element_id: string; base_datatype: string; pattern: string | null }>>(`select
    element_id,base_datatype,definition#>>'{datatype,constraints,pattern}' as pattern
    from catalog.element_definition where release_id=$1 and $2=any(group_path) and element_id=any($3::text[])`,
  [releaseId, definition.assessment.group, inputs.map((input) => input.element)]);
  const fieldById = new Map(observed.map((row) => [row.element_id, row]));
  for (const input of inputs) {
    const field = fieldById.get(input.element);
    if (!field || !supportsNumericBinding(field, input)) {
      throw invalidConfiguration(`Observation binding ${input.element} is unavailable or incompatible in catalog ${releaseId}`);
    }
  }
}

function supportsNumericBinding(field: { base_datatype: string; pattern: string | null }, input: DecisionSupportNumericInput): boolean {
  if (supportedNumericTypes.has(field.base_datatype)) return field.base_datatype !== "integer" || input.precision === 0;
  // NEMSIS represents diastolic pressure as text to accommodate a palpable reading.
  // A definition may explicitly accept this shape when the full numeric range fits.
  if (field.base_datatype !== "string" || !field.pattern || !input.nonNumericValue) return false;
  try {
    const regex = new RegExp(`^(?:${field.pattern})$`);
    const factor = 10 ** input.precision;
    for (let unit = Math.round(input.minValue * factor); unit <= Math.round(input.maxValue * factor); unit++) {
      if (!regex.test(String(unit / factor))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the currently shipped version when a new report is created. Persist each
 * version once so a later deployment can still deliver the original definition.
 */
export async function pinShippedDecisionSupport(
  manager: Manager,
  organizationId: string,
  releaseId: string,
  key: string | null | undefined,
  registerElements = false,
): Promise<string | null> {
  if (!key) return null;
  const definition = shippedDefinition(key);
  await validateCatalogBindings(manager, releaseId, definition);
  const serialized = JSON.stringify(definition);
  await manager.query(`insert into catalog.decision_support_definition (system_key,version,definition)
    values ($1,$2,$3::json) on conflict (system_key,version) do nothing`, [key, definition.version, serialized]);
  const [pin] = await manager.query<Array<{ id: string; identical: boolean }>>(`select id, definition::text=$3 as identical
    from catalog.decision_support_definition where system_key=$1 and version=$2`, [key, definition.version, serialized]);
  if (!pin?.identical) {
    throw invalidConfiguration(`Shipped decision support ${key}/${definition.version} differs from its registered version`);
  }
  if (registerElements) {
    const fields = JSON.stringify(Object.values(decisionSupportCatalogFields(definition, organizationId)));
    await manager.query(`insert into catalog.element_identity (id,namespace,canonical_key)
      select id,namespace,namespace || '.' || slug from jsonb_to_recordset($1::jsonb) as x(id uuid,namespace text,slug text)
      on conflict (id) do nothing`, [fields]);
    await manager.query(`insert into forms.custom_element_definition
      (id,organization_id,namespace,slug,title,base_datatype,identifying,definition)
      select (field->>'id')::uuid,$1,field->>'namespace',field->>'slug',field->>'title',
        case when (field->>'integer')::boolean then 'integer' else field->>'datatype' end,
        false,field from jsonb_array_elements($2::jsonb) as f(field)
      on conflict (id) do update set title=excluded.title, definition=excluded.definition
      where forms.custom_element_definition.definition is distinct from excluded.definition`, [organizationId, fields]);
  }
  return pin.id;
}

export async function loadPinnedDecisionSupport(manager: Manager, organizationId: string, pinId: string):
Promise<ClinicalDecisionSupportConfiguration> {
  const [row] = await manager.query<Array<{ definition: unknown }>>(`select definition
    from catalog.decision_support_definition where id=$1`, [pinId]);
  try {
    const definition = validateDecisionSupportDefinition(row?.definition);
    return { definition, fields: decisionSupportCatalogFields(definition, organizationId) };
  } catch (error) {
    throw invalidConfiguration(`Unable to load pinned decision support ${pinId}: ${String(error)}`);
  }
}

export async function registeredDecisionSupportElements(manager: Manager, organizationId: string):
Promise<DecisionSupportCatalogElement[]> {
  const rows = await manager.query<Array<{ definition: DecisionSupportCatalogElement }>>(`select definition
    from forms.custom_element_definition where organization_id=$1 and namespace=$2 order by slug`,
  [organizationId, DECISION_SUPPORT_NAMESPACE]);
  if (!rows.length) return [];
  // Existing installations may have registered these choices before the English translation shipped.
  const { english, swedish } = catalogFindingLabels(shippedDefinition(WEST_A_DECISION_SUPPORT_KEY));
  return rows.map(({ definition }) => {
    const field = definition.decisionSupportField;
    if ((field !== "categories" && field !== "criteria") || definition.datatype !== "coded") return definition;
    return { ...definition, choices: definition.choices.map((item) => {
      const source = item.localization?.sv?.label;
      const translation = english[field].get(item.code);
      if (!source || source !== swedish[field].get(item.code) || !translation) return item;
      return { ...item, ...choice(item.code, translation, source) };
    }) };
  });
}
