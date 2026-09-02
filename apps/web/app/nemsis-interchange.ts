import type { EncounterDocument, EncounterValue } from "@open-triage/contracts";
import { deserializeEncounterDocument, loadEncounterDocument, serializeEncounterDocument, type EncounterDocumentCompatibility, type EncounterDocumentDiagnostic } from "./encounter-document";
import { getNemsisDataElement, getNemsisGroup, NEMSIS_DATA_MODEL } from "./nemsis-data-model";

export const NEMSIS_XML_NAMESPACE = "http://www.nemsis.org";
export const NEMSIS_XSD = "./data/nemsis-3.5.1-sources/xsd/EMSDataSet_v3.xsd";
const metadataTarget = "open-triage-encounter";

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export type NemsisXmlDiagnostic = EncounterDocumentDiagnostic & { readonly line?: number; readonly column?: number };
export class NemsisXmlError extends Error {
  constructor(readonly diagnostics: ReadonlyArray<NemsisXmlDiagnostic>) {
    super(`Invalid NEMSIS XML:\n${diagnostics.map(({ path, message }) => `${path}: ${message}`).join("\n")}`);
    this.name = "NemsisXmlError";
  }
}

function escapeText(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function escapeAttribute(value: unknown): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function xmlName(id: string): string {
  return getNemsisGroup(id)?.name ?? id;
}
function valueText(value: EncounterValue): string {
  if (value.kind === "scalar") return String(value.value);
  if (value.kind === "coded" || value.kind === "pertinent-negative") return value.code;
  return "";
}
function valueAttributes(value: EncounterValue): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  if (value.kind === "null" && value.notValue) attributes.NV = value.notValue.code;
  if (value.kind === "pertinent-negative") attributes.PN = value.code;
  for (const [key, item] of Object.entries(value.attributes ?? {})) if (item !== null) attributes[key] = item;
  return attributes;
}
function renderElement(id: string, value: EncounterValue, indent: string): string {
  if (value.kind === "absent") return "";
  const attrs = Object.entries(valueAttributes(value)).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => ` ${key}="${escapeAttribute(item)}"`).join("");
  return `${indent}<${id}${attrs}>${escapeText(valueText(value))}</${id}>\n`;
}

/**
 * Emits standards-oriented NEMSIS XML in catalog/XSD order. A processing instruction
 * carries the versioned canonical JSON so stable occurrence ids and compatible
 * extensions survive exchange; XML schema validators intentionally ignore PIs.
 */
export function exportNemsisXml(candidate: EncounterDocument): string {
  const document = loadEncounterDocument(candidate);
  const canonical = encodeBase64(serializeEncounterDocument(document));
  const groupRank = new Map(NEMSIS_DATA_MODEL.groups.map((group, index) => [group.id, index]));
  const elementRank = new Map(NEMSIS_DATA_MODEL.elements.map((element, index) => [element.id, index]));
  const groups = [...document.groups].sort((a, b) => (groupRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (groupRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const sections = new Map<string, string[]>();
  const custom: string[] = [];
  for (const group of groups) {
    const structural = getNemsisGroup(group.id);
    if (!structural) {
      for (const instance of group.instances) for (const element of instance.elements) for (const value of element.values) {
        if (value.kind === "absent") continue;
        const attrs = valueAttributes(value);
        const renderedAttrs = Object.entries(attrs).map(([key, item]) => ` ${key}="${escapeAttribute(item)}"`).join("");
        custom.push(`        <eCustomResults.ResultsGroup CorrelationID="${escapeAttribute(instance.instanceId)}">\n          <eCustomResults.01${renderedAttrs}>${escapeText(valueText(value))}</eCustomResults.01>\n          <eCustomResults.02>${escapeText(element.id)}</eCustomResults.02>\n          <eCustomResults.03>${escapeText(group.id)}</eCustomResults.03>\n        </eCustomResults.ResultsGroup>\n`);
      }
      continue;
    }
    const path = structural.path;
    const sectionId = path[3] ?? structural.id;
    const section = sections.get(sectionId) ?? [];
    for (const instance of group.instances) {
      const content = [...instance.elements].sort((a, b) => (elementRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (elementRank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
        .flatMap((element) => element.values.map((value) => renderElement(element.id, value, structural.id === sectionId ? "        " : "          "))).join("");
      if (!content) continue;
      if (structural.id === sectionId) section.push(content);
      else section.push(`        <${xmlName(structural.id)}>\n${content}        </${xmlName(structural.id)}>\n`);
    }
    sections.set(sectionId, section);
  }
  const body = [...sections].sort(([a], [b]) => (groupRank.get(a) ?? 0) - (groupRank.get(b) ?? 0))
    .map(([id, content]) => `      <${xmlName(id)}>\n${content.join("")}      </${xmlName(id)}>\n`).join("");
  const customBody = custom.length ? `      <eCustomResults>\n${custom.join("")}      </eCustomResults>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<?${metadataTarget} encoding="base64-json" data="${canonical}"?>\n<EMSDataSet xmlns="${NEMSIS_XML_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NEMSIS_XML_NAMESPACE} ${NEMSIS_XSD}">\n  <Header>\n    <PatientCareReport UUID="${escapeAttribute(document.encounter.id)}">\n${body}${customBody}    </PatientCareReport>\n  </Header>\n</EMSDataSet>\n`;
}

/** Imports XML produced by OpenTriage without network or UI dependencies. */
export function importNemsisXml(xml: string, compatibility: EncounterDocumentCompatibility = {}): EncounterDocument {
  const diagnostics = validateNemsisXml(xml);
  if (diagnostics.length) throw new NemsisXmlError(diagnostics);
  const match = new RegExp(`<\\?${metadataTarget}\\s+encoding="base64-json"\\s+data="([A-Za-z0-9+/=]+)"\\s*\\?>`).exec(xml);
  if (!match) throw new NemsisXmlError([{ path: "$", message: "portable OpenTriage metadata is missing; this importer requires an OpenTriage NEMSIS export" }]);
  try { return deserializeEncounterDocument(decodeBase64(match[1]!), compatibility); }
  catch (error) { throw new NemsisXmlError([{ path: "$", message: error instanceof Error ? error.message : "embedded canonical document is invalid" }]); }
}

/** Fast offline diagnostics with canonical paths; full XSD validation can consume NEMSIS_XSD. */
export function validateNemsisXml(xml: string): ReadonlyArray<NemsisXmlDiagnostic> {
  const diagnostics: NemsisXmlDiagnostic[] = [];
  if (!xml.includes(`<EMSDataSet xmlns="${NEMSIS_XML_NAMESPACE}"`)) diagnostics.push({ path: "$", message: `root must be EMSDataSet in ${NEMSIS_XML_NAMESPACE}` });
  if (!/<Header(?:\s|>)/.test(xml)) diagnostics.push({ path: "$.Header", message: "NEMSIS EMSDataSet requires Header" });
  if (!/<PatientCareReport\s+UUID="[^"]+"/.test(xml)) diagnostics.push({ path: "$.Header.PatientCareReport", message: "PatientCareReport requires UUID" });
  const tagPattern = /<(e[A-Z][A-Za-z]+\.\d{2})(?:\s[^>]*)?>/g;
  for (const match of xml.matchAll(tagPattern)) if (!getNemsisDataElement(match[1]!)) diagnostics.push({ path: `$.${match[1]}`, message: `element is not in pinned NEMSIS ${NEMSIS_DATA_MODEL.release}` });
  return diagnostics;
}
