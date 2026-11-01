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
export type SignedReportClinicalSource = {
  draftPreview?: boolean;
  reportId: string; snapshotId: string; revision: number; amendmentSequence: number; synthetic: boolean;
  timeZone?: string; signerId: string; signerDisplayName?: string; signedAt: string; canonicalSha256: string; catalogReleaseId: string; formVersionId: string;
  groups: SignedGroup[]; occurrences: SignedOccurrence[]; notes: SignedNoteManifestEntry[];
  amendments: SignedPdfAmendment[]; configuration: ClinicalFormConfiguration;
};
/** A PDF renderer requires explicit media hydration; clinical metadata alone is insufficient. */
export type SignedReportPdfSource = SignedReportClinicalSource & { photoBytes: Record<string, Buffer> };
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
function definition(source: Pick<SignedReportClinicalSource, "configuration">, value: SignedOccurrence, language: PdfLanguage) {
  const custom = source.configuration.customFields?.[String(value.element_identity_id)];
  const standard = source.configuration.catalogFields[value.element_id];
  if (!custom && !standard) throw new SignedPdfError("pdf.definitions-unavailable");
  return { custom, standard, label: custom ? localized(custom.title, custom.localization, language) :
    localized(standard!.name ?? value.element_id, standard!.localization, language) };
}
export function signedPdfDateTime(value: string, language: PdfLanguage, timeZone = "UTC"): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new SignedPdfError("pdf.invalid-version");
  return new Intl.DateTimeFormat(language === "sv" ? "sv-SE" : "en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
  }).format(instant);
}

export function signedPdfValue(value: SignedOccurrence, source: Pick<SignedReportClinicalSource, "configuration" | "timeZone">, language: PdfLanguage): string {
  const t = language === "sv" ? sv : en;
  const { custom, standard } = definition(source, value, language);
  let result: string;
  if (value.value_kind === "coded") {
    const choice = custom?.datatype === "coded" ? custom.choices.find((item) => item.code === value.code) :
      standard?.codeChoices?.find((item) => item.code === value.code && (item.codeSystem ?? "") === (value.code_system ?? ""));
    result = `${choice ? localized(choice.label, choice.localization, language) : String(value.code_display ?? t.unlabelled)}`;
  } else if (["null", "absent", "pertinent-negative"].includes(value.value_kind)) {
    const key = value.value_kind === "pertinent-negative" ? "pertinentNegative" : value.value_kind as "null" | "absent";
    result = `${t[key]}${value.absence_code ? `: ${value.absence_display ?? t.unlabelled}` : ""}`;
  } else {
    const columns: Record<string, string> = { text: "value_text", uri: "value_text", integer: "value_integer", numeric: "value_numeric",
      boolean: "value_boolean", date: "value_date", datetime: "value_datetime", time: "value_time", duration: "value_duration", binary: "value_binary" };
    const column = columns[value.value_kind];
    if (!column || value[column] === null || value[column] === undefined) throw new SignedPdfError("pdf.invalid-version");
    result = value.value_kind === "boolean" ? (value[column] ? t.yes : t.no) : String(value.value_lexical ?? value[column]);
    if (value.value_kind === "datetime") result = signedPdfDateTime(String(value[column]), language, source.timeZone);
    if (value.value_kind === "binary") result = `${t.binary}: ${result}`;
  }
  for (const [code, display, key] of [["not_value_code", "not_value_display", "notValue"],
    ["pertinent_negative_code", "pertinent_negative_display", "pertinentNegative"]] as const) {
    if (value[code] && value[code] !== value.absence_code) result += `\n${t[key]}: ${value[display] ?? t.unlabelled}`;
  }
  return result;
}

/** Pure clinical projection: reads only the supplied signed manifest and bounded signed amendments. */
export function effectiveSignedPdfOccurrences(source: Pick<SignedReportClinicalSource, "occurrences" | "amendments" | "amendmentSequence">): SignedOccurrence[] {
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
    bufferPages: true, info: { Title: source.draftPreview ? t.draftTitle : t.title, Author: "OpenTriage", CreationDate: new Date(source.signedAt),
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
    const height = Math.max(labelHeight, valueHeight) + 8;
    // Long values flow normally across pages rather than being clipped inside a table cell.
    if (height > 520) { heading(label); paragraph(value); return; }
    room(height);
    const y = doc.y;
    doc.font("heading").text(label, 44, y + 5, { width: leftWidth });
    doc.font("body").text(value, 44 + leftWidth + gap, y + 5, { width: rightWidth });
    doc.moveTo(44, y + height).lineTo(44 + width, y + height).strokeColor("#d0d0d0").stroke();
    doc.x = 44; doc.y = y + height + 1;
  };
  try {
    doc.font("heading").fontSize(21).text(checked(source.draftPreview ? t.draftTitle : t.title), { width }).moveDown(.6);
    doc.font("body").fontSize(10);
    if (source.synthetic) paragraph(t.synthetic);
    row(t.report, source.reportId);
    row(t.revision, `${source.revision} · ${t.sequence}: ${source.amendmentSequence}`);
    if (!source.draftPreview) {
    row(t.signer, source.signerDisplayName ? source.signerDisplayName : source.signerId);
    row(t.signedAt, signedPdfDateTime(source.signedAt, language, source.timeZone));
    }
    heading(t.clinical);
    const grouped = new Map<string | null, SignedOccurrence[]>();
    for (const value of effective) {
      const key = value.group_instance_id ? String(value.group_instance_id) : null;
      if (key && !source.groups.some((group) => group.id === key)) throw new SignedPdfError("pdf.invalid-version");
      grouped.set(key, [...(grouped.get(key) ?? []), value]);
    }
    const renderValues = (values: SignedOccurrence[]) => values.forEach((value) => {
      const label = definition(source, value, language).label;
      row(label, signedPdfValue(value, source, language));
    });
    const groupById = new Map(source.groups.map((group) => [group.id, group]));
    // Flatten structural groups while giving repeated values their own columns.
    const renderGroups = (grouped: Map<string | null, SignedOccurrence[]>) => {
      const siblings = source.groups.filter(group => !group.parent_group_instance_id);
      const families = new Map<string, SignedGroup[]>();
      for (const group of siblings) {
        const key = group.custom_group_definition_id ?? group.group_id;
        families.set(key, [...(families.get(key) ?? []), group]);
      }
      for (const family of families.values()) {
        const populated = family.filter(group => grouped.has(group.id)).flatMap(group => {
          const fields = new Map<string, SignedOccurrence[]>();
          for (const value of grouped.get(group.id)!) {
            const key = String(value.element_identity_id ?? value.element_id);
            fields.set(key, [...(fields.get(key) ?? []), value]);
          }
          const count = Math.max(...[...fields.values()].map(values => values.length));
          return Array.from({ length: count }, (_, index) => ({
            group, entry: `${group.ordinal + 1}${count > 1 ? `.${index + 1}` : ""}`,
            values: [...fields.values()].flatMap(values => values[index] ? [values[index]!] : []),
          }));
        });
        if (populated.length) {
          for (let offset = 0; offset < populated.length; offset += 3) {
            const batch = populated.slice(offset, offset + 3);
            const keys = [...new Set(batch.flatMap(column => column.values.map(value =>
              String(value.element_identity_id ?? value.element_id))))];
            const labels = batch.map(({ group, entry }) => `${t.entry} ${entry}${group.documented_time ? `\n${signedPdfDateTime(group.documented_time, language, source.timeZone)}` : ""}`);
            const widths = [174, ...batch.map(() => (width - 174) / batch.length)];
            const tableRow = (cells: string[], header = false): void => {
              cells.forEach(checked);
              doc.fontSize(9);
              const lines = cells.map((cell, index) => {
                doc.font(header || index === 0 ? "heading" : "body");
                // Split long cells at word boundaries so every table row can flow
                // across pages without truncating clinical text.
                const result: string[] = [];
                for (const paragraph of cell.split("\n")) {
                  let line = "";
                  for (const word of paragraph.split(/\s+/)) {
                    const candidate = line ? `${line} ${word}` : word;
                    if (doc.widthOfString(candidate) <= widths[index]! - 12) { line = candidate; continue; }
                    if (line) { result.push(line); line = ""; }
                    for (const character of word) {
                      if (line && doc.widthOfString(line + character) > widths[index]! - 12) {
                        result.push(line); line = "";
                      }
                      line += character;
                    }
                  }
                  result.push(line);
                }
                return result;
              });
              const count = Math.max(...lines.map(cell => cell.length));
              for (let start = 0; start < count;) {
                if (doc.y + 22 > doc.page.height - 58) {
                  doc.addPage();
                  if (!header) tableRow([t.field, ...labels], true);
                }
                doc.fontSize(9);
                const capacity = Math.max(1, Math.floor((doc.page.height - 58 - doc.y - 8) / 13));
                const take = Math.min(count - start, capacity);
                const y = doc.y, height = take * 13 + 8;
                let x = 44;
                for (let index = 0; index < cells.length; index++) {
                  if (header) doc.rect(x, y, widths[index]!, height).fill("#eeeeee");
                  doc.fillColor("#000000").font(header || index === 0 ? "heading" : "body");
                  for (let line = 0; line < take; line++) {
                    doc.text(lines[index]![start + line] ?? "", x + 6, y + 4 + line * 13,
                      { width: widths[index]! - 12, lineBreak: false });
                  }
                  doc.rect(x, y, widths[index]!, height).strokeColor("#d0d0d0").stroke();
                  x += widths[index]!;
                }
                doc.x = 44; doc.y = y + height; start += take;
                if (start < count) {
                  doc.addPage();
                  if (!header) tableRow([t.field, ...labels], true);
                  doc.fontSize(9);
                }
              }
              doc.font("body").fontSize(10);
            };
            tableRow([t.field, ...labels], true);
            for (const key of keys) {
              const values = batch.map(column => column.values.find(value => String(value.element_identity_id ?? value.element_id) === key));
              const first = values.find(value => value !== undefined)!;
              tableRow([definition(source, first, language).label,
                ...values.map(value => value ? signedPdfValue(value, source, language) : "")]);
            }
          }
        }
      }
    };
    // Validate even disconnected or empty groups before traversing the tree.
    for (const group of source.groups) {
      const seen = new Set([group.id]);
      let parent = group.parent_group_instance_id;
      while (parent) {
        if (seen.has(parent) || !groupById.has(parent)) throw new SignedPdfError("pdf.invalid-version");
        seen.add(parent); parent = groupById.get(parent)!.parent_group_instance_id;
      }
    }
    for (const group of source.groups) {
      if (!group.parent_group_instance_id || !grouped.has(group.id)) continue;
      let root = group;
      while (root.parent_group_instance_id) root = groupById.get(root.parent_group_instance_id)!;
      grouped.set(root.id, [...(grouped.get(root.id) ?? []), ...(grouped.get(group.id) ?? [])]);
    }
    // Section membership comes from the pinned form, independently of observation
    // groups. A table may contain fields from more than one clinical section.
    const remaining = new Set(effective.map(value => value.id));
    const renderSection = (label: string, matches: (value: SignedOccurrence) => boolean) => {
      const sectionValues = new Map<string | null, SignedOccurrence[]>();
      for (const [key, values] of grouped) {
        if (key && groupById.get(key)?.parent_group_instance_id) continue;
        const selected = values.filter(value => remaining.has(value.id) && matches(value));
        if (selected.length) sectionValues.set(key, selected);
      }
      if (!sectionValues.size) return;
      heading(label);
      if (sectionValues.has(null)) renderValues(sectionValues.get(null)!);
      renderGroups(sectionValues);
      for (const values of sectionValues.values()) for (const value of values) remaining.delete(value.id);
    };
    for (const section of source.configuration.definition.sections) {
      const catalog = source.configuration.catalogGroups?.[section.key];
      const label = section.name ?? (catalog ? localized(catalog.name, catalog.localization, language) : section.key);
      renderSection(label, value => section.fields.some(({ source: field }) => field.kind === "nemsis"
        ? field.elementId === value.element_id : field.elementDefinitionId === value.element_identity_id));
    }
    // Older forms may not list every signed field. Keep those values, using the
    // catalog's top-level section wording when it is available.
    for (const value of effective) {
      if (!remaining.has(value.id)) continue;
      if (!/^e[A-Z][A-Za-z]+\.\d+$/.test(value.element_id)) continue;
      const key = value.element_id.split(".")[0]!;
      const catalog = source.configuration.catalogGroups?.[key];
      if (catalog) renderSection(localized(catalog.name, catalog.localization, language), item => item.element_id.split(".")[0] === key);
    }
    renderSection(t.ungrouped, () => true);
    heading(t.notes);
    const textNotes = source.notes.filter((note) => note.type === "text");
    if (!textNotes.length) paragraph(t.none);
    for (const note of textNotes) {
      row(t.author, note.author.displayName);
      row(t.capturedAt, signedPdfDateTime(note.capturedAt, language, source.timeZone));
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
      row(t.signer, amendment.authorId); row(t.signedAt, signedPdfDateTime(amendment.signedAt, language, source.timeZone)); row(t.reason, amendment.reason);
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
    paragraph(source.draftPreview ? t.draftEnd : t.end);
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(index);
      doc.save();
      doc.page.margins.bottom = 0;
      doc.font("body").fontSize(8).fillColor("#444444");
      doc.text(source.draftPreview ? t.draftTitle : source.synthetic ? t.synthetic : t.title, 44, 26, { width, lineBreak: false });
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
