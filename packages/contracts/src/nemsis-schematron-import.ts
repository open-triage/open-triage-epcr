import { formatValidationSource, type ValidationRuleSource } from "./validation-rules.js";

export const NEMSIS_351_EMS_RELEASE = "3.5.1" as const;
export const NEMSIS_351_EMS_BUILD = "3.5.1.251001CP2" as const;

export interface NemsisAssertionSource {
  identity: string;
  patternIdentity: string;
  ruleIdentity: string;
  context: string;
  expression: string;
  /** Exact inner XML of the official assertion message. */
  message: string;
  displayMessage: string;
  role: string;
  subject?: string;
  targetExpression: string;
}

export interface NemsisRuleNormalization {
  source: string;
  primaryTargetElementId: string;
  name?: string;
  message?: string;
}

export interface NemsisRuleProvenance {
  standard: "NEMSIS";
  dataset: "EMS";
  sourceIdentity: string;
  sourceRelease: string;
  sourceBuild: string;
  sourceSha256: string;
  patternIdentity: string;
  ruleIdentity: string;
  context: string;
  originalExpression: string;
  originalMessage: string;
  originalRole: string;
  targetExpression: string;
  subject?: string;
}

export interface ImportedNemsisRule extends ValidationRuleSource {
  provenance: NemsisRuleProvenance[];
}

export interface NemsisControlAccounting {
  namespaces: number;
  globalVariables: number;
  patterns: number;
  contextRules: number;
  localVariables: number;
  nonFindingReports: number;
  diagnostics: number;
  properties: number;
  xsltInstructions: number;
}

export interface NemsisCompatibilityProblem {
  code: "source" | "construct" | "identity" | "severity" | "normalization" | "target";
  message: string;
  sourceIdentity?: string;
}

export interface NemsisCompatibilityReport {
  compatible: boolean;
  release?: string;
  build?: string;
  assertionCount: number;
  controls: NemsisControlAccounting;
  problems: NemsisCompatibilityProblem[];
}

export type NemsisNormalizationTable = Readonly<Record<string, NemsisRuleNormalization>>;

export class NemsisSchematronCompatibilityError extends Error {
  readonly name = "NemsisSchematronCompatibilityError";
  constructor(readonly report: NemsisCompatibilityReport) {
    super(`NEMSIS Schematron is incompatible: ${report.problems.map(({ message }) => message).join("; ")}`);
  }
}

export interface ImportedNemsisRuleset {
  standard: "NEMSIS";
  dataset: "EMS";
  release: string;
  build: string;
  sourceSha256: string;
  assertions: NemsisAssertionSource[];
  rules: ImportedNemsisRule[];
  controls: NemsisControlAccounting;
  compatibility: NemsisCompatibilityReport;
}

const decode = (value: string): string => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function attributes(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])(.*?)\2/g)) result[match[1]!] = decode(match[3]!);
  return result;
}

function text(source: string): string {
  return decode(source.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function count(source: string, expression: RegExp): number { return [...source.matchAll(expression)].length; }

function sha256(source: string): string {
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const bytes = [...new TextEncoder().encode(source)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) words[index] = ((bytes[offset + index * 4]! << 24) |
      (bytes[offset + index * 4 + 1]! << 16) | (bytes[offset + index * 4 + 2]! << 8) | bytes[offset + index * 4 + 3]!) >>> 0;
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotate(words[index - 15]!, 7) ^ rotate(words[index - 15]!, 18) ^ (words[index - 15]! >>> 3);
      const s1 = rotate(words[index - 2]!, 17) ^ rotate(words[index - 2]!, 19) ^ (words[index - 2]! >>> 10);
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const upper = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const first = (h! + upper + choice + constants[index]! + words[index]!) >>> 0;
      const lower = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const second = (lower + majority) >>> 0;
      h=g; g=f; f=e; e=(d!+first)>>>0; d=c; c=b; b=a; a=(first+second)>>>0;
    }
    for (const [index, value] of [a,b,c,d,e,f,g,h].entries()) hash[index] = (hash[index]! + value!) >>> 0;
  }
  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

function sourceElements(expression: string): string[] {
  return [...expression.matchAll(/(?:nem:)?\b(e[A-Z][A-Za-z]+\.\d{2})\b/g)].map((match) => match[1]!);
}

function extractAssertions(source: string, problems: NemsisCompatibilityProblem[]): NemsisAssertionSource[] {
  const assertions: NemsisAssertionSource[] = [];
  const identities = new Set<string>();
  for (const patternMatch of source.matchAll(/<sch:pattern\b([^>]*)>([\s\S]*?)<\/sch:pattern>/g)) {
    const pattern = attributes(patternMatch[1]!);
    const patternIdentity = pattern.id;
    if (!patternIdentity) problems.push({ code: "identity", message: "A Schematron pattern has no identity" });
    for (const ruleMatch of patternMatch[2]!.matchAll(/<sch:rule\b([^>]*)>([\s\S]*?)<\/sch:rule>/g)) {
      const rule = attributes(ruleMatch[1]!);
      const ruleIdentity = rule.id;
      const context = rule.context;
      if (!ruleIdentity || !context) problems.push({ code: "identity", message: `A rule in ${patternIdentity ?? "unknown pattern"} has no identity or context` });
      const targetLet = [...ruleMatch[2]!.matchAll(/<sch:let\b([^>]*)\/?>(?:<\/sch:let>)?/g)]
        .map((match) => attributes(match[1]!)).find(({ name }) => name === "nemsisElements")?.value ?? ".";
      for (const assertionMatch of ruleMatch[2]!.matchAll(/<sch:assert\b([^>]*)>([\s\S]*?)<\/sch:assert>/g)) {
        const assertion = attributes(assertionMatch[1]!);
        const identity = assertion.id;
        if (!identity) { problems.push({ code: "identity", message: `An assertion in ${ruleIdentity ?? "unknown rule"} has no identity` }); continue; }
        if (identities.has(identity)) problems.push({ code: "identity", sourceIdentity: identity, message: `Assertion identity ${identity} is duplicated` });
        identities.add(identity);
        assertions.push({ identity, patternIdentity: patternIdentity ?? "", ruleIdentity: ruleIdentity ?? "", context: context ?? "",
          expression: assertion.test ?? "", message: assertionMatch[2]!.trim(), displayMessage: text(assertionMatch[2]!), role: assertion.role ?? "",
          targetExpression: targetLet, ...(assertion.subject ? { subject: assertion.subject } : {}) });
      }
    }
  }
  return assertions;
}

function controls(source: string): NemsisControlAccounting {
  const schemaStart = /<sch:schema\b[^>]*>([\s\S]*?)<sch:pattern\b/.exec(source)?.[1] ?? "";
  return {
    namespaces: count(source, /<sch:ns\b/g), globalVariables: count(schemaStart, /<sch:let\b/g),
    patterns: count(source, /<sch:pattern\b/g), contextRules: count(source, /<sch:rule\b/g),
    localVariables: count(source, /<sch:rule\b[^>]*>[\s\S]*?<sch:let\b/g),
    nonFindingReports: count(source, /<sch:report\b/g), diagnostics: count(source, /<sch:diagnostic\b/g),
    properties: count(source, /<sch:properties\b/g), xsltInstructions: count(source, /<xsl:[A-Za-z-]+\b/g),
  };
}

function severity(role: string): ValidationRuleSource["severity"] | undefined {
  if (role === "[ERROR]") return "error";
  if (role === "[WARNING]") return "warning";
  if (role === "[INFORMATION]" || role === "[INFO]") return "information";
  return undefined;
}

function provenance(assertion: NemsisAssertionSource, release: string, build: string, sourceSha256: string): NemsisRuleProvenance {
  return { standard: "NEMSIS", dataset: "EMS", sourceIdentity: assertion.identity, sourceRelease: release, sourceBuild: build,
    sourceSha256, patternIdentity: assertion.patternIdentity, ruleIdentity: assertion.ruleIdentity, context: assertion.context,
    originalExpression: assertion.expression, originalMessage: assertion.message, originalRole: assertion.role,
    targetExpression: assertion.targetExpression, ...(assertion.subject ? { subject: assertion.subject } : {}) };
}

export function importNemsisEmsSchematron(source: string, normalizations: NemsisNormalizationTable,
  expected: { release?: string; build?: string; sha256?: string } = {}): ImportedNemsisRuleset {
  const problems: NemsisCompatibilityProblem[] = [];
  const schemaMatch = /<sch:schema\b([^>]*)>/.exec(source);
  const schema = schemaMatch ? attributes(schemaMatch[1]!) : {};
  const build = schema.schemaVersion;
  const release = build?.match(/^\d+\.\d+\.\d+/)?.[0];
  const sourceSha256 = sha256(source);
  if (!schemaMatch || schema.id !== "EMSDataSet") problems.push({ code: "source", message: "Source is not an EMSDataSet Schematron schema" });
  if (!release || !build) problems.push({ code: "source", message: "Source has no recognizable schemaVersion" });
  if (expected.release && release !== expected.release) problems.push({ code: "source", message: `Expected release ${expected.release}, received ${release ?? "none"}` });
  if (expected.build && build !== expected.build) problems.push({ code: "source", message: `Expected build ${expected.build}, received ${build ?? "none"}` });
  if (expected.sha256 && sourceSha256 !== expected.sha256) problems.push({ code: "source", message: `Source digest ${sourceSha256} does not match ${expected.sha256}` });
  const accounting = controls(source);
  for (const reportMatch of source.matchAll(/<sch:report\b([^>]*)>/g)) {
    const report = attributes(reportMatch[1]!);
    if (report.test !== "false()") problems.push({ code: "construct", message: `Finding-producing sch:report test ${report.test ?? "(missing)"} is unsupported` });
  }
  const allowed = new Set(["schema", "title", "ns", "let", "pattern", "rule", "assert", "report", "diagnostics", "diagnostic", "properties", "value-of"]);
  for (const match of source.matchAll(/<sch:([A-Za-z-]+)\b/g)) if (!allowed.has(match[1]!)) {
    problems.push({ code: "construct", message: `Unsupported Schematron construct sch:${match[1]}` });
  }
  const assertions = extractAssertions(source, problems);
  const rules = new Map<string, ImportedNemsisRule>();
  for (const assertion of assertions) {
    const normalized = normalizations[assertion.identity];
    if (!normalized) { problems.push({ code: "normalization", sourceIdentity: assertion.identity, message: `No normalization for ${assertion.identity}` }); continue; }
    const mappedSeverity = severity(assertion.role);
    if (!mappedSeverity) { problems.push({ code: "severity", sourceIdentity: assertion.identity, message: `Unsupported role ${assertion.role || "(missing)"}` }); continue; }
    if (normalized.primaryTargetElementId !== "*" && !/^e[A-Za-z]+\.\d{2}$/.test(normalized.primaryTargetElementId)) {
      problems.push({ code: "target", sourceIdentity: assertion.identity, message: `Invalid primary target ${normalized.primaryTargetElementId}` }); continue;
    }
    const formatted = formatValidationSource(normalized.source);
    if (!formatted.formatted || formatted.diagnostics.length) {
      problems.push({ code: "normalization", sourceIdentity: assertion.identity,
        message: `Normalization for ${assertion.identity} is not valid domain source: ${formatted.diagnostics[0]?.message ?? "unknown error"}` }); continue;
    }
    const message = normalized.message?.trim() || assertion.displayMessage;
    const key = JSON.stringify([mappedSeverity, ["live", "sign"], normalized.primaryTargetElementId, message, formatted.formatted]);
    const sourceProvenance = provenance(assertion, release ?? "", build ?? "", sourceSha256);
    const duplicate = rules.get(key);
    if (duplicate) { duplicate.provenance.push(sourceProvenance); continue; }
    rules.set(key, { id: assertion.identity, name: normalized.name?.trim() || assertion.displayMessage, enabled: true,
      severity: mappedSeverity, executionTargets: ["live", "sign"], primaryTargetElementId: normalized.primaryTargetElementId,
      message, source: formatted.formatted, provenance: [sourceProvenance] });
  }
  for (const identity of Object.keys(normalizations)) if (!assertions.some((assertion) => assertion.identity === identity)) {
    problems.push({ code: "normalization", sourceIdentity: identity, message: `Normalization ${identity} has no source assertion` });
  }
  const report: NemsisCompatibilityReport = { compatible: problems.length === 0, ...(release ? { release } : {}), ...(build ? { build } : {}),
    assertionCount: assertions.length, controls: accounting, problems };
  if (problems.length) throw new NemsisSchematronCompatibilityError(report);
  return { standard: "NEMSIS", dataset: "EMS", release: release!, build: build!, sourceSha256,
    assertions, rules: [...rules.values()], controls: accounting, compatibility: report };
}

export interface NemsisFixtureOutcome { fixture: string; firingSourceIdentities: string[] }
export interface NemsisFixtureParityMismatch { fixture: string; expected: string[]; actual: string[] }

export function compareNemsisFixtureParity(official: readonly NemsisFixtureOutcome[], imported: readonly NemsisFixtureOutcome[]): NemsisFixtureParityMismatch[] {
  const actual = new Map(imported.map((outcome) => [outcome.fixture, [...new Set(outcome.firingSourceIdentities)].sort()]));
  const mismatches: NemsisFixtureParityMismatch[] = [];
  for (const fixture of official) {
    const expected = [...new Set(fixture.firingSourceIdentities)].sort();
    const observed = actual.get(fixture.fixture) ?? [];
    if (JSON.stringify(expected) !== JSON.stringify(observed)) mismatches.push({ fixture: fixture.fixture, expected, actual: observed });
  }
  for (const fixture of actual.keys()) if (!official.some((candidate) => candidate.fixture === fixture)) {
    mismatches.push({ fixture, expected: [], actual: actual.get(fixture)! });
  }
  return mismatches;
}

/** Conservative target hint for building a reviewed normalization table; never silently chooses an ambiguous target. */
export function nemsisTargetCandidates(assertion: NemsisAssertionSource): string[] {
  return [...new Set(sourceElements(`${assertion.targetExpression} ${assertion.subject ?? ""} ${assertion.context}`))];
}
