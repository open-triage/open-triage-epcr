import { evaluateValidationBundleSafely } from './dist/index.js';

const PROVENANCE = 'stationary-populate-v1';
const attributes = () => ({ 'x-open-triage-demo': PROVENANCE });
const pick = (items, random) => items[Math.floor(random() * items.length)];
const ordinary = value => value?.kind === 'coded' ? value.code : value?.kind === 'scalar' ? value.value : undefined;
const numericVitals = { 'eVitals.06': [125, 20], 'eVitals.07': [78, 12], 'eVitals.09': [94, 12],
  'eVitals.10': [85, 20], 'eVitals.12': [97, 2], 'eVitals.14': [18, 4], 'eVitals.16': [36, 5],
  'eVitals.17': [1, 1], 'eVitals.23': [15, 0], 'eVitals.24': [37, 0.6], 'eVitals.27': [4, 3],
  'eVitals.32': [8, 1], 'eVitals.33': [11, 1], 'eVitals.34': [2, 2], 'ePatient.15': [52, 23] };

export function withCustomGenerationModel(configuration, { elements, groups }) {
  elements = [...elements];
  groups = [...groups];
  for (const group of Object.values(configuration.customGroups ?? {})) {
    groups.push({ id: `${group.namespace}.${group.slug}`, parent: group.correlatesTo ?? 'PatientCareReportGroup',
      customId: group.id, minimum: 0, maximum: group.recurrence === 'single' ? 1 : null });
  }
  const fields = configuration.definition.sections.flatMap(section => section.fields);
  for (const field of fields.filter(field => field.source.kind === 'custom')) {
    const custom = configuration.customFields?.[field.source.elementDefinitionId];
    if (!custom || custom.retired) throw new Error(`Active custom field ${field.key} is unavailable`);
    const group = configuration.customGroups?.[field.source.groupDefinitionId ?? custom.groupDefinitionId];
    elements.push({ id: `${custom.namespace}.${custom.slug}`, customId: custom.id,
      base: ({ number: 'decimal', coded: 'string', other: 'string' })[custom.datatype] ?? custom.datatype,
      path: [group ? `${group.namespace}.${group.slug}` : custom.correlatesTo ?? 'PatientCareReportGroup'],
      minimum: ['Mandatory', 'Required'].includes(custom.usage) ? 1 : 0,
      maximum: custom.recurrence === 'single' ? 1 : null,
      definition: { datatype: { constraints: custom.constraints ?? {} }, valueSource: { kind: custom.datatype === 'coded' ? 'inline-enumerated' : 'scalar' } },
      choices: custom.datatype === 'coded' ? custom.choices.map(choice => ({ ...choice, codeSystem: custom.codeSystem })) : undefined,
    });
  }
  return { elements, groups };
}
function scalarValid(metadata, value) {
  const limits = metadata.definition.datatype?.constraints ?? {};
  const text = String(value);
  if (limits.minLength !== undefined && text.length < Number(limits.minLength) ||
    limits.maxLength !== undefined && text.length > Number(limits.maxLength)) return false;
  if (limits.pattern && !new RegExp(`^(?:${limits.pattern})$`, 'u').test(text)) return false;
  if (['integer', 'decimal'].includes(metadata.base)) {
    const number = Number(value);
    if (!Number.isFinite(number) || metadata.base === 'integer' && !Number.isInteger(number)) return false;
    if (number < Number(limits.minInclusive ?? limits.minimum ?? -Infinity) ||
      number > Number(limits.maxInclusive ?? limits.maximum ?? Infinity)) return false;
    if (limits.totalDigits !== undefined && text.replace(/[^0-9]/g, '').length > Number(limits.totalDigits)) return false;
  }
  if (['date', 'dateTime'].includes(metadata.base)) {
    if (!Number.isFinite(Date.parse(text))) return false;
    if (limits.minInclusive && text.slice(0, 10) < String(limits.minInclusive).slice(0, 10) ||
      limits.maxInclusive && text.slice(0, 10) > String(limits.maxInclusive).slice(0, 10)) return false;
  }
  return true;
}

function scalar(metadata, random, timeline) {
  const limits = metadata.definition.datatype?.constraints ?? {};
  if (metadata.base === 'dateTime') return timeline[metadata.id] ?? timeline['eTimes.07'];
  if (metadata.base === 'date') {
    const at = new Date(timeline['eTimes.03']);
    at.setUTCFullYear(at.getUTCFullYear() - Math.max(1, Math.round(normal(random, 50, 22))));
    return at.toISOString().slice(0, 10);
  }
  if (metadata.base === 'boolean') return random() < 0.5;
  if (metadata.base === 'time') return timeline['eTimes.07'].slice(11, 19);
  if (metadata.base === 'duration') return `PT${1 + Math.floor(random() * 30)}M`;
  if (metadata.base === 'binary') return 'U3ludGhldGljIGZpeHR1cmU=';
  if (metadata.base === 'anyURI') return 'https://example.test/synthetic';
  const min = Number(limits.minInclusive ?? limits.minimum ?? 0);
  const max = Number(limits.maxInclusive ?? limits.maximum ?? Math.max(min + 100, 100));
  if (['integer', 'decimal'].includes(metadata.base)) {
    const [mean, deviation] = numericVitals[metadata.id] ?? [(min + max) / 2, (max - min) / 6];
    const digits = metadata.base === 'integer' || metadata.id === 'eVitals.16' ? 0 : Math.min(2, Number(limits.fractionDigits ?? 1));
    return Number(Math.max(min, Math.min(max, normal(random, mean, deviation))).toFixed(digits));
  }
  // Try diverse fictional values first, then known catalog formats. Every result
  // is checked against the *installed* constraints; unknown formats fail closed.
  const token = Math.floor(random() * 1e8).toString(36);
  const length = Math.min(Number(limits.maxLength ?? 60), Math.max(Number(limits.minLength ?? 1), 18));
  const candidates = [`Synthetic ${token}`.padEnd(Number(limits.minLength ?? 0), 'x').slice(0, length),
    '10002', '40.71026,-73.98806', '18TWL12345678', '212-555-0100', '123456789', 'synthetic@example.test',
    '100', '0', '1', 'Unknown', 'SYNTHETIC', 'A', 'US'];
  for (const candidate of candidates) if (scalarValid(metadata, candidate)) return candidate;
  // Common agency formats such as SYN-[A-Z]{3}-[0-9]{4}.
  if (limits.pattern) {
    const candidate = limits.pattern.replace(/^\^|\$$/g, '')
      .replace(/\[([A-Z])-([A-Z])\]\{(\d+)\}/g, (_, a, b, n) => Array.from({ length: Math.min(1000, Number(n)) },
        () => String.fromCharCode(a.charCodeAt(0) + Math.floor(random() * (b.charCodeAt(0) - a.charCodeAt(0) + 1)))).join(''))
      .replace(/(?:\[0-9\]|\\d)\{(\d+)\}/g, (_, n) => Array.from({ length: Math.min(1000, Number(n)) }, () => Math.floor(random() * 10)).join(''));
    if (scalarValid(metadata, candidate)) return candidate;
  }
  throw new Error(`Cannot generate ${metadata.id}: unsupported catalog format ${limits.pattern ?? JSON.stringify(limits)}`);
}

export function validationProblems(bundle, document, timestamp) {
  const findings = new Map();
  for (const target of ['live', 'sign']) {
    const result = evaluateValidationBundleSafely(bundle, document, target, { timestamp });
    if (result.failures.length) throw new Error(`Validation evaluation failed: ${JSON.stringify(result.failures)}`);
    for (const finding of result.findings.filter(finding => ['error', 'warning'].includes(finding.severity))) {
      findings.set(`${finding.ruleId}:${finding.primaryTarget?.groupInstanceId ?? ''}`, finding);
    }
  }
  return [...findings.values()];
}

/** Bounded synthesis: propose catalog-valid values, repair failed predicates,
 * then re-evaluate using the production engine. Never silently disable a rule. */
export function generateDocument({ source, configuration, model, bundle, dispatchedAt, random, now = new Date(), maxPasses = 60,
  preserveExisting = false, createId = () => globalThis.crypto.randomUUID() }) {
  const document = structuredClone(source);
  const metadata = new Map(model.elements.map(element => [element.id, element]));
  const groupMetadata = new Map(model.groups.map(group => [group.id, group]));
  const fields = configuration.definition.sections.flatMap(section => section.fields);
  const fieldId = field => field.source.kind === 'nemsis' ? field.source.elementId :
    model.elements.find(element => element.customId === field.source.elementDefinitionId)?.id;
  const fieldsById = new Map(fields.map(field => [fieldId(field), field]));
  const timeline = operationalTimeline(dispatchedAt, random, preserveExisting ? now : undefined);
  const protectedElements = new Set(preserveExisting ? source.groups.flatMap(group => group.instances.flatMap(instance =>
    instance.elements.filter(element => element.values.some(value => value.attributes?.['x-open-triage-demo'] !== PROVENANCE))
      .map(element => element.id))) : []);
  const values = id => document.groups.flatMap(group => group.instances.flatMap(instance =>
    instance.elements.filter(element => element.id === id).flatMap(element => element.values)));
  function group(id, trail = new Set()) {
    const existing = document.groups.find(group => group.id === id);
    if (existing?.instances.length) return existing.instances[0];
    if (trail.has(id)) throw new Error(`Catalog group cycle at ${id}`);
    trail.add(id);
    const spec = groupMetadata.get(id);
    if (!spec) throw new Error(`No clinical group definition for ${id}`);
    const parent = spec.parent ? group(spec.parent, trail) : undefined;
    const instance = { instanceId: createId(`group:${id}:${parent?.instanceId ?? 'root'}`), ...(parent ? { parentInstanceId: parent.instanceId } : {}), attributes: attributes(), elements: [] };
    if (existing) existing.instances.push(instance); else document.groups.push({ id, instances: [instance] });
    return instance;
  }
  function choices(id) {
    const spec = metadata.get(id);
    const field = fieldsById.get(id);
    let candidates = spec?.choices ?? configuration.catalogFields[id]?.codeChoices ?? [];
    if (field?.choicePolicy) candidates = candidates.filter(candidate => field.choicePolicy.some(choice => choice.kind === 'code' &&
      choice.code === candidate.code && choice.codeSystem === (candidate.codeSystem ?? '')));
    return candidates;
  }
  function makeValue(id, literal) {
    const spec = metadata.get(id);
    if (!spec) throw new Error(`Cannot generate ${id}: not in the clinical catalog`);
    const candidates = choices(id);
    const coded = spec.definition.valueSource?.kind !== 'scalar' || spec.choices !== undefined;
    if (coded) {
      const selected = literal === undefined ? pick(candidates, random) : candidates.find(choice => String(choice.code) === String(literal));
      if (selected) return { kind: 'coded', occurrenceId: createId(), code: selected.code,
        ...(selected.codeSystem ? { system: selected.codeSystem } : {}), display: selected.label, attributes: attributes() };
      const policy = fieldsById.get(id)?.choicePolicy;
      const absent = policy ? policy.filter(choice => choice.kind === 'not-value') : spec.definition.permittedNotValues;
      if (literal === undefined && absent?.length) return { kind: 'null', occurrenceId: createId(),
        notValue: { code: pick(absent, random).code }, attributes: attributes() };
      if (literal === undefined && !policy && spec.definition.permittedPertinentNegatives?.length) return {
        kind: 'pertinent-negative', occurrenceId: createId(), code: pick(spec.definition.permittedPertinentNegatives, random).code,
        attributes: attributes(),
      };
      throw new Error(`Cannot generate ${id}: no enabled code${literal === undefined ? '' : ` matching ${literal}`}`);
    }
    let value = literal ?? scalar(spec, random, timeline);
    if (spec.base === 'dateTime') value = String(value).replace(/(?:\.\d+)?Z$/, '+00:00');
    if (['string', 'anyURI', 'date', 'time', 'duration', 'binary'].includes(spec.base)) value = String(value);
    if (!scalarValid(spec, value)) throw new Error(`Cannot generate ${id}: value does not satisfy catalog constraints`);
    return { kind: 'scalar', occurrenceId: createId(), value,
      ...(spec.base === 'dateTime' ? { precision: 'second', utcOffsetMinutes: 0 } : {}),
      attributes: { ...attributes(), ...(id === 'eVitals.16' ? { ETCO2Type: '3340001' } : {}) } };
  }
  function set(id, literal, count = 1) {
    if (id === 'eRecord.01' || protectedElements.has(id)) return;
    const spec = metadata.get(id);
    if (!spec) throw new Error(`Rule references unavailable clinical field ${id}`);
    if (count > 100 || spec.maximum !== null && count > spec.maximum) throw new Error(`Impossible occurrence count for ${id}: ${count}`);
    const instance = group(spec.path.at(-1));
    let element = instance.elements.find(element => element.id === id);
    if (!element) { element = { id, values: [] }; instance.elements.push(element); }
    element.values = Array.from({ length: count }, (_, index) => ({ ...makeValue(id, literal),
      occurrenceId: element.values[index]?.occurrenceId ?? createId(`occurrence:${id}:${instance.instanceId}:${index}`) }));
  }
  function remove(id) {
    if (id === 'eRecord.01' || protectedElements.has(id)) return;
    for (const group of document.groups) for (const instance of group.instances) {
      instance.elements = instance.elements.filter(element => element.id !== id);
    }
  }
  // Dispatch identity remains recognizable; date/times and clinical values are
  // regenerated from current configuration, rather than copying a canned record.
  const identity = new Set(['eRecord.01', 'eResponse.03', 'eResponse.04']);
  for (const field of fields) {
    const id = fieldId(field);
    if (!metadata.has(id) || identity.has(id)) continue;
    const spec = metadata.get(id);
    if (spec.definition.valueSource?.kind !== 'scalar' && !choices(id).length &&
      !spec.definition.permittedNotValues?.length && !spec.definition.permittedPertinentNegatives?.length &&
      !field.required && !spec.minimum) { remove(id); continue; }
    set(id, undefined, Math.max(1, spec.minimum ?? 0));
  }
  for (const element of model.elements) {
    if (element.id.startsWith('eTimes.') && values(element.id).length) set(element.id, timeline[element.id]);
  }
  // GCS and blood-pressure components describe one coherent observation.
  const systolic = Number(ordinary(values('eVitals.06')[0]));
  if (values('eVitals.07').length && Number.isFinite(systolic)) set('eVitals.07', Math.round(systolic * (0.55 + random() * 0.15)));
  const components = ['eVitals.19', 'eVitals.20', 'eVitals.21'].map(id => Number(ordinary(values(id)[0])));
  if (values('eVitals.23').length && components.every(Number.isFinite)) set('eVitals.23', components.reduce((a, b) => a + b, 0));

  function repair(expression, want = true) {
    if (expression.operator === 'not') return repair(expression.operand, !want);
    if (['all', 'any'].includes(expression.operator)) {
      const every = expression.operator === 'all' ? want : !want;
      for (const operand of every ? expression.operands : [pick(expression.operands, random)]) repair(operand, want);
      return;
    }
    const id = expression.elementId;
    switch (expression.operator) {
      case 'present': if (want) { if (!values(id).length) set(id); } else remove(id); break;
      case 'undocumented': if (want) remove(id); else set(id); break;
      case 'minimum-occurrences': if (want) set(id, undefined, Math.max(expression.count, values(id).length)); else remove(id); break;
      case 'maximum-occurrences': if (want) {
        if (!expression.count) remove(id); else if (values(id).length > expression.count) set(id, undefined, expression.count);
      } else set(id, undefined, expression.count + 1); break;
      case 'minimum-groups': if (want && expression.count === 1) group(expression.groupId); break;
      case 'equals': case 'coded': case 'member': {
        const allowed = expression.operator === 'member' ? expression.values : [expression.value ?? expression.code];
        if (want) set(id, pick(allowed, random));
        else { const alternatives = choices(id).filter(choice => !allowed.map(String).includes(String(choice.code)));
          if (alternatives.length) set(id, pick(alternatives, random).code); else set(id); }
        break;
      }
      case 'compare-literal': case 'compare-elements': {
        const target = id ?? expression.leftElementId;
        const reference = expression.operator === 'compare-literal' ? expression.value : ordinary(values(expression.rightElementId)[0]);
        if (reference === undefined) { set(expression.rightElementId); break; }
        let comparison = expression.comparison;
        if (!want) comparison = ({ equal: 'not-equal', 'not-equal': 'equal', 'less-than': 'greater-or-equal',
          'less-or-equal': 'greater-than', 'greater-than': 'less-or-equal', 'greater-or-equal': 'less-than' })[comparison];
        const adjustment = ({ 'less-than': -1, 'greater-than': 1, 'not-equal': 1 })[comparison] ?? 0;
        set(target, typeof reference === 'number' ? reference + adjustment : reference); break;
      }
      case 'compare-times': {
        if (!want) break;
        const right = expression.right.kind === 'evaluation-time' ? now.toISOString() : ordinary(values(expression.right.elementId)[0]);
        if (!right) { set(expression.right.elementId); break; }
        const direction = ['before', 'same-or-before'].includes(expression.comparison) ? -1 : 1;
        set(expression.leftElementId, new Date(Date.parse(String(right)) + expression.offsetSeconds * 1000 + direction * 1000).toISOString()); break;
      }
      case 'matches': {
        const current = ordinary(values(id)[0]);
        const rounded = Math.round(Number(current));
        if (want && Number.isFinite(rounded) && new RegExp(expression.pattern, 'u').test(String(rounded))) set(id, rounded);
        else set(id);
        break;
      }
      case 'attribute': if (want && !protectedElements.has(id)) for (const value of values(id)) value.attributes = { ...value.attributes, [expression.name]: expression.value ?? '1' }; break;
      case 'quantified': if (want && expression.values?.length) set(id, pick(expression.values, random)); break;
      default: if (id && metadata.has(id)) set(id);
    }
  }
  function formCondition(expression) {
    if (expression.operator === 'exists') return values(fieldId(fields.find(field => field.key === expression.field) ?? { source: {} })).length > 0;
    if (expression.operator === 'equals') return values(fieldId(fields.find(field => field.key === expression.field) ?? { source: {} }))
      .some(value => String(ordinary(value)) === String(expression.value));
    if (expression.operator === 'not') return !formCondition(expression.condition);
    if (expression.operator === 'and') return expression.conditions.every(formCondition);
    if (expression.operator === 'or') return expression.conditions.some(formCondition);
    throw new Error(`Unsupported form condition ${expression.operator}`);
  }
  let findings = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    for (const field of fields) for (const rule of field.rules ?? []) {
      if (rule.kind === 'visibility' && !formCondition(rule.expression)) remove(fieldId(field));
      if (rule.kind === 'requiredness' && formCondition(rule.expression) && !values(fieldId(field)).length) set(fieldId(field));
    }
    findings = validationProblems(bundle, document, now.toISOString());
    if (!findings.length) return { document, timeline };
    for (const finding of findings) {
      const rule = bundle.rules.find(rule => rule.ruleId === finding.ruleId);
      if (!rule) continue;
      try { repair(rule.assertion); }
      catch { // Another permitted applicability branch may satisfy a conditional rule.
        if (rule.applicability) { try { repair(rule.applicability, false); } catch {} }
      }
      if (pass % 5 === 4 && rule.applicability) { try { repair(rule.applicability, false); } catch {} }
    }
  }
  throw new Error(`Could not satisfy active validation after ${maxPasses} passes: ${JSON.stringify(findings.map(finding => ({
    ruleId: finding.ruleId, element: finding.primaryTarget?.elementId, message: finding.message,
  })))}`);
}

export function randomFromSeed(state) {
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(random, mean, deviation) {
  return mean + deviation * Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * Math.cos(2 * Math.PI * random());
}

export function operationalTimeline(dispatchedAt, random, latest) {
  const minutes = (median, spread, min, max) => Math.max(min, Math.min(max, Math.exp(normal(random, Math.log(median), spread))));
  const notified = +dispatchedAt;
  const enroute = notified + minutes(2, 0.5, 0.5, 8) * 60000;
  const scene = enroute + minutes(9, 0.5, 2, 40) * 60000;
  const patient = scene + minutes(2, 0.5, 0.5, 8) * 60000;
  const left = patient + minutes(20, 0.5, 5, 70) * 60000;
  const destination = left + minutes(14, 0.55, 3, 55) * 60000;
  const transfer = destination + minutes(8, 0.6, 2, 35) * 60000;
  const available = transfer + minutes(12, 0.5, 3, 40) * 60000;
  const raw = { 'eTimes.01': notified - minutes(4, 0.4, 1, 10) * 60000,
    'eTimes.02': notified - minutes(1, 0.3, 0.2, 1) * 60000, 'eTimes.03': notified,
    'eTimes.04': notified + 15000, 'eTimes.05': enroute, 'eTimes.06': scene, 'eTimes.07': patient,
    'eTimes.08': patient + 30000, 'eTimes.09': left, 'eTimes.10': destination - 60000,
    'eTimes.11': destination, 'eTimes.12': transfer, 'eTimes.13': available,
    'eTimes.14': available + 300000, 'eTimes.15': available + 600000, 'eTimes.16': transfer };
  // Compress unusually late calls into the same date, preserving relative order.
  const end = Math.max(notified, Math.min(latest ? +latest : Infinity,
    Date.parse(`${dispatchedAt.toISOString().slice(0, 10)}T23:59:59Z`)));
  const scale = Math.min(1, (end - notified) / (raw['eTimes.15'] - notified));
  return Object.fromEntries(Object.entries(raw).map(([id, value]) => [id,
    new Date(value > notified ? notified + (value - notified) * scale : value).toISOString()]));
}
