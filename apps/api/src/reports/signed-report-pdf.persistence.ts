import { SIGNED_PDF_SIMULATOR_LIMITS } from "./signed-report-pdf-media.js";
import { SignedPdfError } from "./signed-report-pdf.js";
import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { CatalogDraftCustomElement } from "@open-triage/contracts";
import { clinicalFormConfiguration, catalogFieldsConfiguration } from "../forms/clinical-form-configuration.js";
import { releaseCustomDefinitions } from "../admin/custom-definition-version.js";
import { commandSha256 } from "./draft-report.validation.js";
import type { SignedNoteManifestEntry } from "./sign-report-notes.js";
import { effectiveSignedPdfOccurrences, type SignedGroup, type SignedOccurrence, type SignedPdfAmendment,
  type SignedReportPdfSource } from "./signed-report-pdf.js";

type Manifest = { schemaVersion: number; clinicalContentVersion?: number; report: { id: string; revision: number; formVersionId: string; catalogReleaseId: string; signer?: { id: string; displayName: string } };
  groups: SignedGroup[]; occurrences: SignedOccurrence[]; notes?: SignedNoteManifestEntry[] };

type StoredChange = { action: SignedPdfAmendment["changes"][number]["action"];
  targetElementOccurrenceId: string | null; targetPath: Record<string, unknown>;
  originalValue: SignedOccurrence | null; correctedValue: SignedOccurrence | null };
type AmendmentRow = { id: string; sequence: number; author_id: string; signed_at: Date | string;
  reason: string; attestation: unknown; canonical_sha256: string; changes: StoredChange[];
  audit_manifests: Array<{ amendmentId: string; amendmentSequence: number; canonicalSha256: string;
    reason: string; changes: StoredChange[] }> | null };

function verifiedAmendment(reportId: string, item: AmendmentRow): SignedPdfAmendment {
  const invalid = () => new UnprocessableEntityException({ code: "pdf.amendment-evidence-unavailable" });
  const evidence = item.audit_manifests?.length === 1 ? item.audit_manifests[0] : null;
  if (!evidence || evidence.amendmentId !== item.id || evidence.amendmentSequence !== Number(item.sequence) ||
      evidence.reason !== item.reason || evidence.canonicalSha256 !== item.canonical_sha256 ||
      !Array.isArray(evidence.changes) || !Array.isArray(item.changes)) throw invalid();
  const signedAt = new Date(item.signed_at).toISOString();
  // The immutable audit event preserves signing order; random change-row UUIDs do not.
  if (commandSha256({ schemaVersion: 1, reportId, amendmentId: item.id, sequence: Number(item.sequence),
    authorId: item.author_id, reason: item.reason, attestation: item.attestation, signedAt,
    changes: evidence.changes }) !== item.canonical_sha256) throw invalid();
  // Append-only rows can still receive an extra insert. Require the exact signed multiset,
  // including duplicates, targets and original values, before trusting any clinical content.
  const hashes = (changes: StoredChange[]) => changes.map((change) => commandSha256(change)).sort();
  if (JSON.stringify(hashes(evidence.changes)) !== JSON.stringify(hashes(item.changes))) throw invalid();
  return { id: item.id, sequence: Number(item.sequence), authorId: item.author_id, signedAt,
    reason: item.reason, canonicalSha256: item.canonical_sha256,
    changes: evidence.changes.map((change) => ({ action: change.action, targetId: change.targetElementOccurrenceId,
      original: change.originalValue, corrected: change.correctedValue })) };
}

/** Caller MUST authorize full identifying access first, in the same repeatable-read transaction.
 * No live draft, note, occurrence or mutable custom-definition data supplies clinical content.
 * On-demand bytes have no separate retention or guessed-artifact download route.
 */
export async function signedReportPdfSource(manager: EntityManager, reportId: string, snapshotId: string,
  sequence: number): Promise<SignedReportPdfSource> {
  const [snapshot] = await manager.query<Array<{ id: string; signed_revision: number; signer_id: string;
    signed_at: Date | string; canonical_sha256: string; integrity_manifest: Manifest;
    catalog_release_id: string; form_version_id: string; synthetic: boolean }>>(`
    select s.id,s.signed_revision,s.signer_id,s.signed_at,s.canonical_sha256,s.integrity_manifest,
      s.catalog_release_id,s.form_version_id,r.synthetic
    from clinical.signed_snapshot s join clinical.report r on r.id=s.report_id
    where s.report_id=$1 and s.id=$2 and r.status='signed'`, [reportId, snapshotId]);
  if (!snapshot) throw new NotFoundException("Signed report version was not found");
  const manifest = snapshot.integrity_manifest;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.report?.id !== reportId ||
      manifest.report.formVersionId !== snapshot.form_version_id || manifest.report.catalogReleaseId !== snapshot.catalog_release_id ||
      manifest.report.revision !== Number(snapshot.signed_revision) || !Array.isArray(manifest.groups) ||
      !Array.isArray(manifest.occurrences) || commandSha256(manifest) !== snapshot.canonical_sha256)
    throw new UnprocessableEntityException({ code: "pdf.invalid-version" });
  // Older manifests are eligible when their content itself proves completeness (including
  // a notes-only report). Missing supplemental columns are ambiguous: scalar values can
  // carry NOT/pertinent-negative qualifiers too, so value_kind alone cannot prove absence.
  if (!manifest.occurrences.every((value) => ["not_value_code", "not_value_display",
    "pertinent_negative_code", "pertinent_negative_display"].every((key) => Object.hasOwn(value, key))))
    throw new UnprocessableEntityException({ code: "pdf.invalid-version" });
  // A pre-note-manifest snapshot cannot prove note completeness; fail rather than read today's notes.
  if (!Array.isArray(manifest.notes)) throw new UnprocessableEntityException({ code: "pdf.invalid-version" });
  const amendments = await manager.query<AmendmentRow[]>(`
    select a.id,a.sequence,a.author_id,a.signed_at,a.reason,a.attestation,a.canonical_sha256,
      jsonb_agg(jsonb_build_object('action',ac.action,'targetElementOccurrenceId',ac.target_element_occurrence_id,
        'targetPath',ac.target_path,'originalValue',ac.original_value,'correctedValue',ac.corrected_value)
        order by ac.id) as changes,
      (select jsonb_agg(e.new_value) from clinical_audit.event e where e.report_id=a.report_id
        and e.action='amend' and e.target_type='amendment' and e.target_id=a.id::text) as audit_manifests
    from clinical.amendment a join clinical.amendment_change ac on ac.amendment_id=a.id
    where a.report_id=$1 and a.sequence <= $2
    group by a.id order by a.sequence`, [reportId, sequence]);
  if (amendments.length !== sequence) throw new NotFoundException("Signed amendment sequence was not found");
  const configuration = await clinicalFormConfiguration(manager, snapshot.form_version_id, snapshot.catalog_release_id);
  const source: SignedReportPdfSource = { reportId, snapshotId, revision: Number(snapshot.signed_revision),
    amendmentSequence: sequence, synthetic: snapshot.synthetic, signerId: snapshot.signer_id,
    ...(manifest.report.signer?.id === snapshot.signer_id ? { signerDisplayName: manifest.report.signer.displayName } : {}),
    signedAt: new Date(snapshot.signed_at).toISOString(), canonicalSha256: snapshot.canonical_sha256,
    catalogReleaseId: snapshot.catalog_release_id, formVersionId: snapshot.form_version_id,
    groups: manifest.groups, occurrences: manifest.occurrences, notes: manifest.notes,
    amendments: amendments.map((item) => verifiedAmendment(reportId, item)), configuration };
  const allValues = [...manifest.occurrences, ...effectiveSignedPdfOccurrences(source),
    ...source.amendments.flatMap((item) => item.changes.flatMap((change) => [change.original, change.corrected]
      .filter((value): value is SignedOccurrence => value !== null)))];
  // Fields omitted from the current form layout still belong in the signed clinical artifact.
  const standardIds = [...new Set(allValues.filter((value) => /^e[A-Z]/.test(value.element_id)).map((value) => value.element_id))];
  configuration.catalogFields = { ...configuration.catalogFields,
    ...await catalogFieldsConfiguration(manager, snapshot.catalog_release_id, standardIds, true) };
  const custom = await releaseCustomDefinitions(manager, snapshot.catalog_release_id);
  const customById = new Map((custom ?? []).map((item) => [item.id, item]));
  // Keep empty configured custom destinations available using sealed release evidence only.
  configuration.customFields = Object.fromEntries(configuration.definition.sections.flatMap(section=>section.fields)
    .flatMap(field=>field.source.kind === "custom" && customById.has(field.source.elementDefinitionId)
      ? [[field.source.elementDefinitionId,customById.get(field.source.elementDefinitionId)!]] : []));
  for (const value of allValues) {
    if (configuration.catalogFields[value.element_id]) continue;
    const pinned = customById.get(String(value.element_identity_id));
    if (!pinned) throw new UnprocessableEntityException({ code: "pdf.definitions-unavailable" });
    configuration.customFields[pinned.id] = pinned as CatalogDraftCustomElement;
  }
  // Caller has authorized the report and identifying media access in this transaction.
  // Fetch only signed photo IDs from this report; never current captions or unsigned notes.
  source.photoBytes = {};
  let total = 0;
  for (const note of source.notes.filter((item) => item.type === "photo")) {
    if (!note.media || !Number.isSafeInteger(note.media.byteSize) || note.media.byteSize < 1)
      throw new SignedPdfError("pdf.media-unavailable", note.id);
    total += note.media.byteSize;
    if (total > SIGNED_PDF_SIMULATOR_LIMITS.photoBytes) throw new SignedPdfError("pdf.media-too-large", note.id);
    const [blob] = await manager.query<Array<{ canonical_bytes: Buffer }>>(`
      select b.canonical_bytes from clinical.report_photo_blob b
      join clinical.report r on r.id=b.report_id and r.organization_id=b.organization_id
      where b.report_id=$1 and b.note_id=$2 and octet_length(b.canonical_bytes)=$3`,
    [reportId, note.id, note.media.byteSize]);
    if (!blob) throw new SignedPdfError("pdf.media-unavailable", note.id);
    source.photoBytes[note.id] = blob.canonical_bytes;
  }
  return source;
}
