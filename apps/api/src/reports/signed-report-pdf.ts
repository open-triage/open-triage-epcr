import { verifiedPdfPhotos, SIGNED_PDF_SIMULATOR_LIMITS } from "./signed-report-pdf-media.js";
import PDFDocument from "pdfkit";
import { openSync } from "fontkit";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import en from "./pdf-messages/en.json";
import sv from "./pdf-messages/sv.json";
import type { SignedNoteManifestEntry } from "./sign-report-notes.js";

export type PdfLanguage = "en" | "sv";
export type SignedOccurrence = Record<string, unknown> & { id: string; element_id: string; value_kind: string };
export type SignedGroup = { id: string; group_id: string; ordinal: number;
  parent_group_instance_id?: string | null; custom_group_definition_id?: string | null; documented_time?: string | null };
export type SignedPdfAmendment = { id: string; sequence: number; authorId: string; signedAt: string; reason: string;
  canonicalSha256: string; changes: Array<{ action: "add" | "replace" | "remove";
    targetId: string | null; original: SignedOccurrence | null; corrected: SignedOccurrence | null }> };
export type SignedReportPdfSource = {
  reportId: string; snapshotId: string; revision: number; amendmentSequence: number; synthetic: boolean;
  signerId: string; signerDisplayName?: string; signedAt: string; canonicalSha256: string; catalogReleaseId: string; formVersionId: string;
  groups: SignedGroup[]; occurrences: SignedOccurrence[]; notes: SignedNoteManifestEntry[];
  photoBytes?: Record<string, Buffer>;
  amendments: SignedPdfAmendment[]; configuration: ClinicalFormConfiguration;
};
export class SignedPdfError extends Error {
  constructor(public readonly code: "pdf.invalid-version" | "pdf.definitions-unavailable" | "pdf.unsupported-text" |
    "pdf.too-large" | "pdf.render-failed" | "pdf.media-unavailable" | "pdf.media-decode-failed" |
    "pdf.media-too-large" | "pdf.audio-metadata-unavailable", public readonly noteId?: string) { super(code); }
}
const assets = join(__dirname, "pdf-assets");
const regular = join(assets, "DejaVuSans.ttf");
const bold = join(assets, "DejaVuSans-Bold.ttf");
const font = openSync(regular);
const MAX_CHARACTERS = 2_000_000;
const MAX_PAGES = 500;

function localized(label: string, localization: { sv?: { label?: string; name?: string } } | undefined, language: PdfLanguage) {
  return language === "sv" ? localization?.sv?.label ?? localization?.sv?.name ?? label : label;
}
function definition(source: SignedReportPdfSource, value: SignedOccurrence, language: PdfLanguage) {
  const custom = source.configuration.customFields?.[String(value.element_identity_id)];
  const standard = source.configuration.catalogFields[value.element_id];
  if (!custom && !standard) throw new SignedPdfError("pdf.definitions-unavailable");
  return { custom, standard, label: custom ? localized(custom.title, custom.localization, language) :
    localized(standard!.name ?? value.element_id, standard!.localization, language) };
}
export function signedPdfValue(value: SignedOccurrence, source: SignedReportPdfSource, language: PdfLanguage): string {
  const t = language === "sv" ? sv : en;
  const { custom, standard } = definition(source, value, language);
  let result: string;
  if (value.value_kind === "coded") {
    const choice = custom?.datatype === "coded" ? custom.choices.find((item) => item.code === value.code) :
      standard?.codeChoices?.find((item) => item.code === value.code && item.codeSystem === value.code_system);
    result = `${choice ? localized(choice.label, choice.localization, language) : String(value.code_display ?? value.code ?? "")} [${value.code ?? ""}]`;
  } else if (["null", "absent", "pertinent-negative"].includes(value.value_kind)) {
    const key = value.value_kind === "pertinent-negative" ? "pertinentNegative" : value.value_kind as "null" | "absent";
    result = `${t[key]}${value.absence_code ? `: ${value.absence_display ?? ""} [${value.absence_code}]` : ""}`;
  } else {
    const columns: Record<string, string> = { text: "value_text", uri: "value_text", integer: "value_integer", numeric: "value_numeric",
      boolean: "value_boolean", date: "value_date", datetime: "value_datetime", time: "value_time", duration: "value_duration", binary: "value_binary" };
    const column = columns[value.value_kind];
    if (!column || value[column] === null || value[column] === undefined) throw new SignedPdfError("pdf.invalid-version");
    result = value.value_kind === "boolean" ? (value[column] ? t.yes : t.no) : String(value.value_lexical ?? value[column]);
    if (value.value_kind === "binary") result = `${t.binary}: ${result}`;
  }
  for (const [code, display, key] of [["not_value_code", "not_value_display", "notValue"],
    ["pertinent_negative_code", "pertinent_negative_display", "pertinentNegative"]] as const) {
    if (value[code] && value[code] !== value.absence_code) result += `\n${t[key]}: ${value[display] ?? ""} [${value[code]}]`;
  }
  return result;
}

/** Pure clinical projection: reads only the supplied signed manifest and bounded signed amendments. */
export function effectiveSignedPdfOccurrences(source: SignedReportPdfSource): SignedOccurrence[] {
  const effective = new Map(source.occurrences.map((value) => [value.id, structuredClone(value)]));
  if (effective.size !== source.occurrences.length || source.amendments.length !== source.amendmentSequence)
    throw new SignedPdfError("pdf.invalid-version");
  source.amendments.forEach((amendment, index) => {
    if (amendment.sequence !== index + 1) throw new SignedPdfError("pdf.invalid-version");
    for (const change of amendment.changes) {
      if (change.action !== "add" && (!change.targetId || !effective.has(change.targetId)))
        throw new SignedPdfError("pdf.invalid-version");
      if (change.action === "remove") effective.delete(change.targetId!);
      else {
        if (!change.corrected?.id || (change.action === "add" && effective.has(change.corrected.id)))
          throw new SignedPdfError("pdf.invalid-version");
        if (change.action === "replace") effective.delete(change.targetId!);
        effective.set(change.corrected.id, structuredClone(change.corrected));
      }
    }
  });
  return [...effective.values()].sort((a, b) => a.element_id.localeCompare(b.element_id) ||
    Number(a.ordinal ?? 0) - Number(b.ordinal ?? 0) || a.id.localeCompare(b.id));
}

/** Entire buffer succeeds before delivery. Never stream a partial clinical artifact to the caller. */
export async function renderSignedReportPdf(source: SignedReportPdfSource, language: PdfLanguage): Promise<Buffer> {
  const t = language === "sv" ? sv : en;
  const effective = effectiveSignedPdfOccurrences(source);
  const photos = await verifiedPdfPhotos(source);
  const doc = new PDFDocument({ size: "A4", margins: { top: 66, bottom: 58, left: 44, right: 44 },
    bufferPages: true, info: { Title: t.title, Author: "OpenTriage", CreationDate: new Date(source.signedAt),
      ModDate: new Date(source.amendments.at(-1)?.signedAt ?? source.signedAt) } });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    let size = 0;
    doc.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > SIGNED_PDF_SIMULATOR_LIMITS.artifactBytes) {
        reject(new SignedPdfError("pdf.too-large"));
        (doc as unknown as Readable).destroy();
      } else chunks.push(chunk);
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  let characters = 0;
  let pages = 1;
  doc.on("pageAdded", () => { if (++pages > MAX_PAGES) throw new SignedPdfError("pdf.too-large"); });
  doc.registerFont("body", regular).registerFont("heading", bold).font("body").fontSize(10);
  const checked = (value: string): string => {
    characters += value.length;
    if (characters > MAX_CHARACTERS) throw new SignedPdfError("pdf.too-large");
    for (const character of value) {
      if (["\n", "\r", "\t"].includes(character)) continue;
      if (!("hasGlyphForCodePoint" in font) || !font.hasGlyphForCodePoint(character.codePointAt(0)!))
        throw new SignedPdfError("pdf.unsupported-text");
    }
    return value;
  };
  const width = doc.page.width - 88;
  const room = (height: number) => { if (doc.y + height > doc.page.height - 58) doc.addPage(); };
  const heading = (label: string) => { room(48); doc.moveDown(.5).font("heading").fontSize(12).text(checked(label), 44, doc.y, { width }); doc.font("body").fontSize(10).moveDown(.4); };
  const paragraph = (value: string) => { doc.font("body").fontSize(10).text(checked(value), 44, doc.y, { width, lineGap: 2 }).moveDown(.4); };
  const row = (label: string, value: string) => {
    checked(label); checked(value);
    doc.font("body").fontSize(10);
    const leftWidth = 174, gap = 16, rightWidth = width - leftWidth - gap;
    const labelHeight = doc.font("heading").heightOfString(label, { width: leftWidth });
    const valueHeight = doc.font("body").heightOfString(value, { width: rightWidth });
    const height = Math.max(labelHeight, valueHeight) + 14;
    // Long values flow normally across pages rather than being clipped inside a table cell.
    if (height > 520) { heading(label); paragraph(value); return; }
    room(height);
    const y = doc.y;
    doc.font("heading").text(label, 44, y + 5, { width: leftWidth });
    doc.font("body").text(value, 44 + leftWidth + gap, y + 5, { width: rightWidth });
    doc.moveTo(44, y + height).lineTo(44 + width, y + height).strokeColor("#d0d0d0").stroke();
    doc.x = 44; doc.y = y + height + 3;
  };
  try {
    doc.font("heading").fontSize(21).text(checked(t.title), { width }).moveDown(.6);
    doc.font("body").fontSize(10);
    if (source.synthetic) paragraph(t.synthetic);
    row(t.report, source.reportId);
    row(t.revision, `${source.revision} · ${t.sequence}: ${source.amendmentSequence}`);
    row(t.signer, source.signerDisplayName ? `${source.signerDisplayName}\n${source.signerId}` : source.signerId);
    row(t.signedAt, source.signedAt);
    heading(t.clinical);
    const grouped = new Map<string | null, SignedOccurrence[]>();
    for (const value of effective) {
      const key = value.group_instance_id ? String(value.group_instance_id) : null;
      if (key && !source.groups.some((group) => group.id === key)) throw new SignedPdfError("pdf.invalid-version");
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
    const renderValues = (values: SignedOccurrence[]) => values.forEach((value) => {
      const label = definition(source, value, language).label;
      row(`${label}\n${value.element_id}`, signedPdfValue(value, source, language));
    });
    if (grouped.has(null)) { heading(t.ungrouped); renderValues(grouped.get(null)!); }
    const groupById = new Map(source.groups.map((group) => [group.id, group]));
    const groupLabel = (group: SignedGroup): string => {
      const custom = source.configuration.customGroups?.[group.custom_group_definition_id ?? group.group_id];
      const standard = source.configuration.catalogGroups?.[group.group_id];
      if (!custom && !standard) throw new SignedPdfError("pdf.definitions-unavailable");
      return custom ? localized(custom.title, custom.localization, language) : localized(standard!.name, standard!.localization, language);
    };
    for (const group of source.groups) {
      if (!grouped.has(group.id)) continue;
      const ancestors: string[] = [];
      let parent = group.parent_group_instance_id;
      const seen = new Set([group.id]);
      while (parent) {
        if (seen.has(parent) || !groupById.has(parent)) throw new SignedPdfError("pdf.invalid-version");
        seen.add(parent);
        const item = groupById.get(parent)!;
        ancestors.unshift(`${groupLabel(item)} ${Number(item.ordinal) + 1}`);
        parent = item.parent_group_instance_id;
      }
      heading([...ancestors, `${groupLabel(group)} · ${t.entry} ${Number(group.ordinal) + 1}`].join(" / "));
      if (group.documented_time) paragraph(group.documented_time);
      renderValues(grouped.get(group.id)!);
    }
    heading(t.notes);
    const textNotes = source.notes.filter((note) => note.type === "text");
    if (!textNotes.length) paragraph(t.none);
    for (const note of textNotes) {
      row(t.author, `${note.author.displayName} (${note.author.id})`);
      row(t.capturedAt, `${note.capturedAt} · UTC${note.capturedUtcOffsetMinutes >= 0 ? "+" : ""}${note.capturedUtcOffsetMinutes / 60}`);
      if (typeof note.normalizedText !== "string") throw new SignedPdfError("pdf.invalid-version");
      paragraph(note.normalizedText);
    }
    const media = source.notes.filter((note) => note.type !== "text");
    if (media.length) {
      const firstPhoto = photos.get(media[0]!.id);
      room(firstPhoto ? Math.min(380, width * firstPhoto.height / firstPhoto.width) + 190 : 190);
      heading(t.media);
      for (const note of media) {
        const photo = photos.get(note.id);
        room(photo ? Math.min(380, width * photo.height / photo.width) + 140 : 140);
        row(t[note.type as "photo" | "audio"], `${note.id}\n${note.capturedAt}\n${note.author.displayName}`);
        if (note.normalizedCaption) paragraph(note.normalizedCaption);
        if (note.type === "audio") {
          row(t.duration, `${note.media!.durationMilliseconds! / 1000} ${t.seconds}`);
          paragraph(t.audioNotTransferred);
        } else {
          const height = Math.min(380, width * photo!.height / photo!.width);
          room(height + 12);
          doc.image(photo!.bytes, 44, doc.y, { fit: [width, height] });
          doc.y += height + 12;
        }
      }
    }
    heading(t.amendments);
    if (!source.amendments.length) paragraph(t.none);
    for (const amendment of source.amendments) {
      heading(`${t.sequence} ${amendment.sequence}`);
      row(t.signer, amendment.authorId); row(t.signedAt, amendment.signedAt); row(t.reason, amendment.reason);
      for (const change of amendment.changes) {
        const value = change.corrected ?? change.original;
        if (!value) throw new SignedPdfError("pdf.invalid-version");
        heading(`${t[change.action]}: ${definition(source, value, language).label}`);
        if (change.original) row(t.original, signedPdfValue(change.original, source, language));
        if (change.corrected) row(t.corrected, signedPdfValue(change.corrected, source, language));
      }
      row(t.checksum, amendment.canonicalSha256);
    }
    heading(t.source);
    row(t.snapshot, source.snapshotId); row(t.checksum, source.canonicalSha256);
    row(t.definitions, `${source.catalogReleaseId}\n${source.formVersionId}`);
    paragraph(t.end);
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(index);
      doc.save();
      doc.page.margins.bottom = 0;
      doc.font("body").fontSize(8).fillColor("#444444");
      doc.text(source.synthetic ? t.synthetic : t.title, 44, 26, { width, lineBreak: false });
      doc.text(`${source.reportId} · v${source.revision}/${source.amendmentSequence}`, 44, doc.page.height - 38, { width, lineBreak: false });
      doc.text(`${t.page} ${index + 1} ${t.of} ${range.count}`, 44, doc.page.height - 24, { width, align: "right", lineBreak: false });
      doc.restore();
    }
    doc.end();
    return await completed;
  } catch (error) {
    (doc as unknown as Readable).destroy();
    // Consume a stream error too; no partial bytes escape this method.
    void completed.catch(() => undefined);
    throw error instanceof SignedPdfError ? error : new SignedPdfError("pdf.render-failed");
  }
}
