import { hospitalFieldId, narrativeText, type ClinicalFormConfiguration, type EpsClinicalMapping } from '@open-triage/contracts';

type Json = Record<string, unknown>;
export type HistoricalMapping = EpsClinicalMapping & {
  semanticRole?: string;
  expectedUnit?: { system: string; code: string };
};
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): Json[] => Array.isArray(value) ? value.map(object) : [];
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
export const historicalResource = (resourceType: string) => ['Observation', 'Procedure', 'Patient'].includes(resourceType);

/** An administrator explicitly declares a custom narrative destination's meaning.
 * A matching primitive datatype alone never licenses a historical fact in an
 * encounter measurement, treatment, or arbitrarily chosen patient field. */
export function historicalDestination(mapping: HistoricalMapping, form: ClinicalFormConfiguration): string | null {
  const type = String(mapping.resourceType);
  if (!historicalResource(type)) return null;
  const expected = type === 'Observation' ? 'historical-observation' : type === 'Procedure' ? 'historical-procedure' : 'patient-identifier';
  if (mapping.semanticRole !== expected || mapping.representation !== 'text') return 'historicalDestination';
  const id = hospitalFieldId(mapping.destination);
  if (type === 'Patient' && mapping.destination.kind === 'nemsis' && id === 'ePatient.01') return null;
  if (mapping.destination.kind !== 'custom') return 'historicalDestination';
  const custom = form.customFields?.[id];
  if (!custom || custom.datatype !== 'string' || custom.correlatesTo || custom.groupDefinitionId) return 'historicalDestination';
  if (type === 'Patient' && (custom.recurrence !== 'single' || custom.identifying !== true)) return 'historicalDestination';
  return null;
}

/** Patient identifiers have a namespace, not a terminology code. A mapping uses
 * the explicit selector 'identifier'; no name matching or identifier coercion. */
export function historicalConcept(resource: Json): Json {
  if (resource.resourceType !== 'Patient') return object(resource.code);
  return { coding: list(resource.identifier).map(identifier => ({ system: identifier.system, code: 'identifier', display: identifier.value })) };
}
export function hasUnknownSemantics(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnknownSemantics);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    ((key === 'modifierExtension' || key === 'extension' || key === 'implicitRules') &&
      (Array.isArray(item) ? item.length > 0 : !!item)) || hasUnknownSemantics(item));
}
function dated(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const date = new Date(value);
  const calendarDate = value.slice(0, 10);
  return Number.isFinite(date.getTime()) && new Date(`${calendarDate}T00:00:00Z`).toISOString().slice(0, 10) === calendarDate;
}
function hasDate(resource: Json, prefix: string): boolean {
  const choices = Object.keys(resource).filter(key => key.startsWith(prefix) && !key.startsWith('_'));
  if (choices.length !== 1) return false;
  if (choices[0] === `${prefix}DateTime` || choices[0] === `${prefix}Instant`) return dated(resource[choices[0]]);
  if (choices[0] !== `${prefix}Period`) return false;
  const period = object(resource[choices[0]]);
  return dated(period.start) && (period.end === undefined || dated(period.end) && Date.parse(String(period.end)) >= Date.parse(String(period.start)));
}

/** Readable source serialization preserves all supplied facts, including status,
 * certainty, dates, unit codings, qualifiers and repeated components. It never
 * promotes the entry into a current observation or a procedure performed here.
 * Unsupported values remain view-only; provenance alone cannot fix lost meaning. */
export function historicalSource(resource: Json, mapping: HistoricalMapping) {
  const readable = { ...resource };
  if (resource.text) readable.text = { ...object(resource.text), div: narrativeText(String(object(resource.text).div ?? '')) };
  const incoming = JSON.stringify(readable, null, 2);
  const fail = (finding: string) => ({ incoming, value: incoming, finding });
  if (hasUnknownSemantics(resource)) return fail('semantics');
  if (resource.resourceType === 'Patient') {
    const identifiers = list(resource.identifier).filter(identifier => identifier.system === mapping.system);
    if (mapping.code !== 'identifier' || identifiers.length !== 1) return fail('identifierAmbiguous');
    const identifier = identifiers[0]!;
    // Period-limited, old, secondary and temporary identifiers cannot silently
    // become the current configured identity. Their source remains readable.
    if (!nonempty(identifier.value) || identifier.period || identifier.use && !['usual', 'official'].includes(String(identifier.use)) || resource.active === false) return fail('identifierAmbiguous');
    return { incoming, value: identifier.value, finding: null };
  }
  const observation = resource.resourceType === 'Observation';
  if (!hasDate(resource, observation ? 'effective' : 'performed')) return fail('historicalDate');
  if (observation ? !['final', 'amended', 'corrected'].includes(String(resource.status)) : resource.status !== 'completed') return fail('status');
  if (observation) {
    if (['hasMember', 'derivedFrom', 'focus'].some(key => list(resource[key]).length)) return fail('semantics');
    const values = [resource, ...list(resource.component)];
    // A configured quantity unit applies exactly to a single observation value.
    // Multi-component readings with potentially distinct units require a richer
    // mapping and remain view-only rather than being flattened or converted.
    if (list(resource.component).length) return fail('historicalComponents');
    for (const value of values) {
      const choices = Object.keys(value).filter(key => key.startsWith('value'));
      if (choices.length > 1 || (choices.length && value.dataAbsentReason)) return fail('semantics');
      if (!choices.length) {
        const absent = object(value.dataAbsentReason);
        if (!list(absent.coding).length || !list(absent.coding).every(coding => nonempty(coding.system) && nonempty(coding.code))) return fail('historicalValue');
      } else if (choices[0] === 'valueQuantity') {
        const quantity = object(value.valueQuantity);
        if (typeof quantity.value !== 'number' || !Number.isFinite(quantity.value)) return fail('historicalValue');
        if (!mapping.expectedUnit || quantity.system !== mapping.expectedUnit.system || quantity.code !== mapping.expectedUnit.code) return fail('historicalUnit');
        if (quantity.comparator !== undefined && !['<', '<=', '>=', '>'].includes(String(quantity.comparator))) return fail('semantics');
      } else {
        if (mapping.expectedUnit) return fail('historicalUnit');
        if (!['valueString', 'valueBoolean', 'valueInteger', 'valueCodeableConcept'].includes(choices[0]!)) return fail('historicalValue');
        if (choices[0] === 'valueString' && !nonempty(value.valueString) || choices[0] === 'valueBoolean' && typeof value.valueBoolean !== 'boolean' || choices[0] === 'valueInteger' && !Number.isInteger(value.valueInteger) || choices[0] === 'valueCodeableConcept' && (!list(object(value.valueCodeableConcept).coding).length || !list(object(value.valueCodeableConcept).coding).every(coding => nonempty(coding.system) && nonempty(coding.code)))) return fail('historicalValue');
      }
    }
  }
  return { incoming, value: incoming, finding: null };
}
