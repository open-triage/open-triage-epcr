export const COS_JOURNAL_INITIAL_DELAY_MS = 20_000;

/** SQL predicates share delivery alias d. No timers or retries can authorize a write.
 * Only an acknowledged note awaiting journal visibility qualifies, for five minutes
 * from its original durable send intent. Other unresolved clinical artifacts do not. */
export const cosJournalSettlingSql = `(d.state='uncertain' and exists(
 select 1 from clinical.cos_artifact_event latest_note
 where latest_note.id=(select max(id) from clinical.cos_artifact_event where delivery_id=d.id and artifact_key='note')
 and latest_note.state in ('accepted','uncertain')
 and latest_note.evidence->>'httpStatus' in ('200','201','202','204')
 and latest_note.evidence->>'reason' in ('journalProcessing','pdfJournalEmpty','pdfNoteNotFound')
 and not exists(select 1 from jsonb_array_elements(coalesce(latest_note.evidence->'responseEvidence'->'issues','[]'::jsonb)) issue where issue->>'severity' in ('error','fatal'))
 ) and exists(select 1 from clinical.cos_artifact_event sent where sent.delivery_id=d.id and sent.artifact_key='note' and sent.state='sending'
 and sent.created_at>clock_timestamp()-interval '5 minutes')
 and not exists(select 1 from clinical.cos_artifact a
 left join lateral(select state from clinical.cos_artifact_event where delivery_id=a.delivery_id and artifact_key=a.artifact_key order by id desc limit 1) e on true
 where a.delivery_id=d.id and a.kind not in ('context','note','pdf') and coalesce(e.state,'prepared')<>'verified'))`;

export const cosSigningCheckRequestedSql = `exists(select 1 from clinical.cos_delivery_event requested
 where requested.delivery_id=d.id and requested.evidence->>'action'='signing-check'
 and not exists(select 1 from clinical.cos_delivery_event done where done.delivery_id=d.id
 and done.evidence->>'action'='signing-checked' and done.created_at>=requested.created_at))`;

// The deadline is written with the successful receipt, not recomputed on each poll.
export const cosJournalDelayElapsedSql = `not exists(select 1 from clinical.cos_artifact_event note
 where note.id=(select max(id) from clinical.cos_artifact_event where delivery_id=d.id and artifact_key='note')
 and (note.evidence->>'journalVerificationNotBefore')::timestamptz>clock_timestamp())`;

export const cosSigningCheckDueSql = `(${cosJournalDelayElapsedSql} and (${cosSigningCheckRequestedSql} or
 (${cosJournalSettlingSql} and d.updated_at<=clock_timestamp()-interval '10 seconds')))`;

// Signed-report amendments need the same bounded settling checks, but never
// inherit the draft Sign command's authority to resume or replace a submission.
export const cosJournalCheckScopeSql = `((r.status='draft' and d.signing_submission_id is not null)
 or (r.status='signed' and d.snapshot_id is not null and ${cosJournalSettlingSql}))`;
