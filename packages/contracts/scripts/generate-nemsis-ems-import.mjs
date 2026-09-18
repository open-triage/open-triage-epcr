import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const sourcePath = resolve(repository, "packages/contracts/fixtures/nemsis-3.5.1/EMSDataSet.sch.xml");
const officialRootArgument = process.argv.indexOf("--official-root");
const officialRoot = officialRootArgument >= 0 ? resolve(process.argv[officialRootArgument + 1]) : undefined;
const check = process.argv.includes("--check");
const generatedPath = resolve(repository, "packages/contracts/src/nemsis-3.5.1-ems.generated.ts");
const parityPath = resolve(repository, "packages/contracts/fixtures/nemsis-3.5.1/ems-fixture-outcomes.json");
const encounterPath = resolve(repository, "packages/contracts/fixtures/nemsis-3.5.1/ems-fixture-encounters.json");

const decode = (value) => value.replaceAll("&quot;", '"').replaceAll("&apos;", "'")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const attrs = (value) => Object.fromEntries([...value.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/gs)]
  .map((match) => [match[1], decode(match[3])]));
const elementIds = (value) => [...value.matchAll(/(?:nem:)?\b(e[A-Z][A-Za-z]+\.\d{2})\b/g)].map((match) => match[1]);
const referenceIds = (value) => [...value.matchAll(/(?:nem:)?\b([de][A-Z][A-Za-z]+\.\d{2})\b/g)].map((match) => match[1]);
const quote = (value) => JSON.stringify(value);
const ref = (value, target) => value.trim() === "." ? target : (referenceIds(value).at(-1) ?? target);
const splitTop = (value, keyword) => {
  const parts = []; let depth = 0; let quoted = false; let start = 0;
  for (let index = 0; index <= value.length - keyword.length; index += 1) {
    if (value[index] === "'") quoted = !quoted;
    if (quoted) continue;
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    if (depth === 0 && value.slice(index, index + keyword.length) === keyword) {
      parts.push(value.slice(start, index)); start = index + keyword.length; index = start - 1;
    }
  }
  if (parts.length) parts.push(value.slice(start));
  return parts;
};
const unwrap = (value) => {
  let result = value.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0; let complete = true; let quoted = false;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === "'") quoted = !quoted;
      if (quoted) continue;
      if (result[index] === "(") depth += 1;
      if (result[index] === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) { complete = false; break; }
    }
    if (!complete) break;
    result = result.slice(1, -1).trim();
  }
  return result;
};
const empty = (id) => `any(undocumented(${quote(id)}), emptyPayload(${quote(id)}))`;
const literal = (value) => /^-?\d+(?:\.\d+)?$/.test(value) ? value : quote(value.replace(/^'|'$/g, ""));
function translate(xpath, target) {
  const value = unwrap(decode(xpath).replace(/\s+/g, " "));
  if (value === "* != ''") return "anyPayload()";
  if (value === "* = ''") return "not(anyPayload())";
  const quantifiedMatch = /^some \$[A-Za-z]+ in .* satisfies matches\(\$[A-Za-z]+, '([^']*)'\)$/.exec(value);
  if (quantifiedMatch) {
    const ids = elementIds(value.slice(0, value.indexOf(" satisfies ")));
    return `any(${ids.map((id) => `matches(${quote(id)}, ${quote(quantifiedMatch[1])})`).join(", ")})`;
  }
  if (/^some \$element in /.test(value)) return "anyPayload()";
  for (const [keyword, operator] of [[" or ", "any"], [" and ", "all"]]) {
    const parts = splitTop(value, keyword);
    if (parts.length) return `${operator}(${parts.map((part) => translate(part, target)).join(", ")})`;
  }
  if (/^not\([\s\S]*\)$/.test(value)) return `not(${translate(value.slice(4, -1), target)})`;
  const filteredNode = /^(.+?)\[([\s\S]+)\]$/.exec(value);
  if (filteredNode && ref(filteredNode[1], target)) return translate(filteredNode[2], ref(filteredNode[1], target));
  if (value === "false()") return "never()";
  if (value === "true()") return "always()";
  let match;
  match = /^starts-with\((.+?),\s*(.+)\)$/.exec(value);
  if (match) return `startsWith(${quote(ref(match[1], target))}, ${quote(ref(match[2], target))})`;
  match = /^matches\((.+?),\s*'([^']*)'\)$/.exec(value);
  if (match) return `matches(${quote(ref(match[1], target))}, ${quote(match[2])})`;
  match = /^(.+) castable as xs:integer$/.exec(value);
  if (match) return `matches(${quote(ref(match[1], target))}, ${quote("^-?[0-9]+$")})`;
  match = /^count\((.+)\)\s*(=|!=|<=|>=|<|>)\s*(\d+)$/.exec(value);
  if (match) {
    const id = ref(match[1], target); const count = Number(match[3]);
    if (match[2] === "=") return `all(minimum(${quote(id)}, ${count}), maximum(${quote(id)}, ${count}))`;
    if (match[2] === "<=") return `maximum(${quote(id)}, ${count})`;
    if (match[2] === ">=") return `minimum(${quote(id)}, ${count})`;
    if (match[2] === "<") return `maximum(${quote(id)}, ${count - 1})`;
    if (match[2] === ">") return `minimum(${quote(id)}, ${count + 1})`;
    return `not(all(minimum(${quote(id)}, ${count}), maximum(${quote(id)}, ${count})))`;
  }
  match = /^xs:dateTime\((.+)\)\s*(<=|>=|<|>)\s*xs:dateTime\((.+)\)$/.exec(value);
  if (match) {
    const comparisons = { "<": "before", ">": "after", "<=": "same-or-before", ">=": "same-or-after" };
    return `timeCompare(${quote(ref(match[1], target))}, ${quote(comparisons[match[2]])}, ${quote(ref(match[3], target))})`;
  }
  match = /^xs:dateTime\((.+)\)\s*<=\s*current-dateTime\(\)\s*\+\s*xs:dayTimeDuration\('P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?'\)$/.exec(value);
  if (match) {
    const seconds = Number(match[2] ?? 0) * 86400 + Number(match[3] ?? 0) * 3600 + Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0);
    return `timeCompare(${quote(ref(match[1], target))}, "same-or-before", "evaluation-time", ${seconds})`;
  }
  match = /^xs:decimal\((.+)\)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/.exec(value);
  if (match) {
    const comparisons = { "<": "less-than", ">": "greater-than", "<=": "less-or-equal", ">=": "greater-or-equal" };
    return `compareValue(${quote(ref(match[1], target))}, ${quote(comparisons[match[2]])}, ${match[3]})`;
  }
  match = /^@(CodeType|ETCO2Type)\s*(=|!=)\s*'([^']+)'$/.exec(value);
  if (match) {
    const expression = match[1] === "CodeType" ? `codeType(${quote(target)}, ${quote(match[3])})`
      : `attribute(${quote(target)}, ${quote(match[1])}, ${quote(match[3])})`;
    return match[2] === "!=" ? `not(${expression})` : expression;
  }
  match = /^@(NV|PN)\s*(=|!=)\s*'([^']+)'$/.exec(value);
  if (match) {
    const expression = `${match[1] === "NV" ? "hasNotValue" : "hasPertinentNegative"}(${quote(target)}, ${quote(match[3])})`;
    return match[2] === "!=" ? `not(${expression})` : expression;
  }
  match = /^@(NV|PN|CodeType|ETCO2Type)$/.exec(value);
  if (match) return match[1] === "NV" ? `hasNotValue(${quote(target)})` : match[1] === "PN"
    ? `hasPertinentNegative(${quote(target)})` : `attribute(${quote(target)}, ${quote(match[1])})`;
  match = /^@xsi:nil\s*=\s*'true'$/.exec(value);
  if (match) return `emptyPayload(${quote(target)})`;
  const comparison = /^(.+?)\s*(=|!=|<=|>=|<|>)\s*(.+)$/.exec(value);
  if (comparison) {
    const left = comparison[1].trim(); const operator = comparison[2]; const right = comparison[3].trim();
    const leftId = ref(left, target); const rightId = ref(right, target);
    if (right === "''") { const expression = empty(leftId); return operator === "!=" ? `not(${expression})` : expression; }
    if (left === "''") { const expression = empty(rightId); return operator === "!=" ? `not(${expression})` : expression; }
    const tuple = /^\((.*)\)$/.exec(right);
    if (tuple && leftId) {
      const values = splitTop(tuple[1], ",").length ? splitTop(tuple[1], ",") : tuple[1].split(",");
      const includesEmpty = values.some((item) => item.trim() === "''");
      const nonEmptyValues = values.filter((item) => item.trim() !== "''");
      const memberExpression = nonEmptyValues.length
        ? `member(${quote(leftId)}, ${nonEmptyValues.map((item) => literal(item.trim())).join(", ")})`
        : undefined;
      const expression = includesEmpty
        ? (memberExpression ? `any(${empty(leftId)}, ${memberExpression})` : empty(leftId))
        : memberExpression;
      if (!expression) throw new Error(`Empty membership tuple for ${target}: ${value}`);
      return operator === "!=" ? `not(${expression})` : expression;
    }
    if (leftId && rightId && !/^'/.test(right)) {
      const names = { "=": "equal", "!=": "not-equal", "<": "less-than", "<=": "less-or-equal", ">": "greater-than", ">=": "greater-or-equal" };
      return `compare(${quote(leftId)}, ${quote(names[operator])}, ${quote(rightId)})`;
    }
    if (leftId && (/^'.*'$/.test(right) || /^-?\d/.test(right))) {
      const names = { "=": "equal", "!=": "not-equal", "<": "less-than", "<=": "less-or-equal", ">": "greater-than", ">=": "greater-or-equal" };
      return `compareValue(${quote(leftId)}, ${quote(names[operator])}, ${literal(right)})`;
    }
  }
  throw new Error(`Unsupported XPath for ${target}: ${value}`);
}
function predicates(context) {
  const result = [];
  for (let index = 0; index < context.length; index += 1) if (context[index] === "[") {
    let depth = 1; let quoted = false; const start = ++index;
    while (index < context.length && depth) {
      if (context[index] === "'") quoted = !quoted;
      if (!quoted && context[index] === "[") depth += 1;
      if (!quoted && context[index] === "]") depth -= 1;
      index += 1;
    }
    result.push(context.slice(start, index - 1)); index -= 1;
  }
  return result.filter((value) => !/^\d+$/.test(value.trim()));
}

const source = await readFile(sourcePath, "utf8");
const normalizations = {};
const wildcard = {
  nemSch_e001: "nil-needs-absence", nemSch_e002: "nv-needs-empty", nemSch_e008: "pn-needs-empty-no-nv",
  nemSch_e009: "unique-nv", nemSch_e010: "unique-pn",
};
const priorityExclusions = [...new Set(elementIds(source).filter((id) => id.startsWith("eExam.")))].sort()
  .concat(["eHistory.10", "eSituation.01", "eSituation.18", "eArrest.14", "ePatient.15", "eSituation.10", "eMedications.03", "eProcedures.03"]);
const wildcardExclusions = {
  nemSch_e001: ["eCustomResults.01"], nemSch_e002: ["eCustomResults.01", ...priorityExclusions],
  nemSch_e008: ["eCustomResults.01", ...priorityExclusions], nemSch_e009: ["eCustomResults.01"],
  nemSch_e010: ["eCustomResults.01", ...priorityExclusions],
};
const inferredScope = (context, target) => {
  const explicit = [...context.matchAll(/(?:nem:)?\b(e[A-Z][A-Za-z]+\.[A-Za-z]+Group)\b/g)].at(-1)?.[1];
  if (explicit) return explicit;
  if (/^ePatient\.(?:15|16)$/.test(target)) return "ePatient.AgeGroup";
  if (target.startsWith("eVitals.")) return "eVitals.VitalGroup";
  if (target.startsWith("eMedications.")) return ["eMedications.05", "eMedications.06"].includes(target)
    ? "eMedications.DosageGroup" : "eMedications.MedicationGroup";
  if (target.startsWith("eProcedures.")) return "eProcedures.ProcedureGroup";
  if (/^eDisposition\.0[1-9]$|^eDisposition\.10$/.test(target)) return "eDisposition.DestinationGroup";
  if (/^eDisposition\.2[45]$/.test(target)) return "eDisposition.HospitalTeamActivationGroup";
  if (/^eDisposition\.(?:27|28|29|30)$/.test(target)) return "eDisposition.IncidentDispositionGroup";
  return undefined;
};
for (const ruleMatch of source.matchAll(/<sch:rule\b([^>]*)>([\s\S]*?)<\/sch:rule>/g)) {
  const rule = attrs(ruleMatch[1]);
  const targetLet = [...ruleMatch[2].matchAll(/<sch:let\b([^>]*)\/?>(?:<\/sch:let>)?/g)]
    .map((match) => attrs(match[1])).find(({ name }) => name === "nemsisElements")?.value ?? "";
  for (const assertionMatch of ruleMatch[2].matchAll(/<sch:assert\b([^>]*)>([\s\S]*?)<\/sch:assert>/g)) {
    const assertion = attrs(assertionMatch[1]);
    const targetCandidates = elementIds(targetLet);
    const contextCandidates = elementIds(rule.context ?? "");
    const subjectCandidates = elementIds(assertion.subject ?? "");
    const candidates = [...targetCandidates, ...(contextCandidates.length ? [contextCandidates.at(-1)] : []), ...subjectCandidates];
    const primaryTargetElementId = wildcard[assertion.id] ? "*" : candidates[0];
    if (!primaryTargetElementId) throw new Error(`Cannot derive target candidate for ${assertion.id}`);
    let normalizedSource;
    if (wildcard[assertion.id]) normalizedSource = `require allElements("${wildcard[assertion.id]}"${(wildcardExclusions[assertion.id] ?? [])
      .map((id) => `, ${quote(id)}`).join("")})`;
    else {
      const assertionExpression = translate(assertion.test, primaryTargetElementId);
      const conditions = predicates(rule.context ?? "").map((predicate) => translate(predicate, primaryTargetElementId));
      const scope = assertion.id === "nemSch_e174" ? undefined : inferredScope(rule.context ?? "", primaryTargetElementId);
      if (assertion.id === "nemSch_e145") conditions.push(`not(attribute(${quote(primaryTargetElementId)}, "CodeType"))`);
      normalizedSource = `${scope ? `for each(${quote(scope)})\n` : ""}${conditions.length ? `when ${conditions.length === 1 ? conditions[0] : `all(${conditions.join(", ")})`}\n` : ""}require ${assertionExpression}`;
    }
    normalizations[assertion.id] = { primaryTargetElementId, source: normalizedSource };
  }
}
const generated = `/* Generated by scripts/generate-nemsis-ems-import.mjs from the pinned official source. */\n` +
  `import type { NemsisNormalizationTable } from "./nemsis-schematron-import.js";\n\n` +
  `export const NEMSIS_351_EMS_SOURCE_SHA256 = ${JSON.stringify(createHash("sha256").update(source).digest("hex"))} as const;\n` +
  `export const NEMSIS_351_EMS_NORMALIZATIONS = ${JSON.stringify(normalizations, null, 2)} as const satisfies NemsisNormalizationTable;\n`;

let parity;
let encounters;
if (officialRoot) {
  const { readdir } = await import("node:fs/promises");
  const directory = resolve(officialRoot, "SampleData/Schematron/EMS/svrl");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".xml")).sort();
  parity = [];
  for (const fixture of files) {
    const svrl = await readFile(resolve(directory, fixture), "utf8");
    parity.push({ fixture: fixture.replace(/\.xml$/, ""), firingSourceIdentities:
      [...new Set([...svrl.matchAll(/<svrl:failed-assert\b[\s\S]*?\bid="([^"]+)"/g)].map((match) => match[1]))].sort() });
  }
  const xmlDirectory = resolve(officialRoot, "SampleData/Schematron/EMS/xml");
  const xmlFiles = (await readdir(xmlDirectory)).filter((file) => file.endsWith(".xml")).sort();
  const flatten = (xml) => {
    const groups = {}; const stack = []; const groupCounts = {};
    const root = { key: "EMSDataSet#1", groupId: "EMSDataSet", instanceId: "EMSDataSet#1", elements: {} };
    groups[root.key] = root;
    const currentGroup = () => [...stack].reverse().find((entry) => entry.groupKey)?.groupKey ?? root.key;
    const finishElement = (entry) => {
      if (!/^[de][A-Z][A-Za-z]+\.\d{2}$/.test(entry.name)) return;
      const sourceAttributes = attrs(entry.rawAttributes);
      const ordinary = decode(entry.text).trim();
      const group = groups[entry.groupKey]; const occurrences = group.elements[entry.name] ??= [];
      const base = { occurrenceId: `${entry.groupKey}/${entry.name}-${occurrences.length + 1}`,
        ...(Object.keys(sourceAttributes).length ? { attributes: sourceAttributes } : {}),
        ...(sourceAttributes.NV ? { notValue: { code: sourceAttributes.NV } } : {}),
        ...(sourceAttributes.PN ? { pertinentNegative: { code: sourceAttributes.PN } } : {}) };
      occurrences.push(ordinary ? (sourceAttributes.CodeType
        ? { ...base, kind: "coded", code: ordinary, system: sourceAttributes.CodeType }
        : { ...base, kind: "scalar", value: ordinary })
        : { ...base, kind: sourceAttributes["xsi:nil"] === "true" ? "null" : "absent" });
    };
    for (const token of xml.matchAll(/<!--[\s\S]*?-->|<\?[^>]*\?>|<\/?[A-Za-z_:][-A-Za-z0-9_:.]*(?:\s[^>]*?)?\/?>|[^<]+/g)) {
      const raw = token[0];
      if (!raw.startsWith("<")) { if (stack.length) stack.at(-1).text += raw; continue; }
      if (raw.startsWith("<!--") || raw.startsWith("<?")) continue;
      const closing = /^<\//.test(raw); const selfClosing = /\/>$/.test(raw);
      const name = /^<\/?([A-Za-z_:][-A-Za-z0-9_:.]*)/.exec(raw)?.[1];
      if (!name) continue;
      if (closing) { const entry = stack.pop(); if (entry) finishElement(entry); continue; }
      const rawAttributes = raw.slice(name.length + 1, raw.length - (selfClosing ? 2 : 1));
      const parentGroup = currentGroup();
      const isGroup = /(?:Group|^e[A-Z][A-Za-z]+$|PatientCareReport)$/.test(name);
      let groupKey;
      if (isGroup) {
        const number = (groupCounts[name] = (groupCounts[name] ?? 0) + 1);
        groupKey = `${name}#${number}`;
        groups[groupKey] = { key: groupKey, groupId: name, instanceId: groupKey,
          ...(parentGroup !== root.key ? { parentInstanceId: parentGroup } : {}), elements: {} };
      }
      const entry = { name, rawAttributes, text: "", groupKey: groupKey ?? parentGroup };
      if (selfClosing) finishElement(entry); else stack.push(entry);
    }
    return groups;
  };
  const base = flatten(await readFile(resolve(xmlDirectory, "EMSDataSet--Base.xml"), "utf8"));
  const deltas = {};
  for (const file of xmlFiles) {
    const fixture = file.replace(/\.xml$/, "");
    const current = flatten(await readFile(resolve(xmlDirectory, file), "utf8"));
    const changed = {};
    for (const id of new Set([...Object.keys(base), ...Object.keys(current)])) {
      if (JSON.stringify(base[id] ?? null) !== JSON.stringify(current[id] ?? null)) changed[id] = current[id] ?? null;
    }
    deltas[fixture] = changed;
  }
  encounters = { base, deltas };
} else parity = JSON.parse(await readFile(parityPath, "utf8"));
const parityOutput = `${JSON.stringify(parity, null, 2)}\n`;
if (!encounters) encounters = JSON.parse(await readFile(encounterPath, "utf8"));
const encounterOutput = `${JSON.stringify(encounters)}\n`;

if (check) {
  if (await readFile(generatedPath, "utf8") !== generated) throw new Error(`${generatedPath} is stale`);
  if (await readFile(parityPath, "utf8") !== parityOutput) throw new Error(`${parityPath} is stale`);
  if (await readFile(encounterPath, "utf8") !== encounterOutput) throw new Error(`${encounterPath} is stale`);
} else {
  await mkdir(dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, generated);
  await mkdir(dirname(parityPath), { recursive: true });
  await writeFile(parityPath, parityOutput);
  await writeFile(encounterPath, encounterOutput);
}
