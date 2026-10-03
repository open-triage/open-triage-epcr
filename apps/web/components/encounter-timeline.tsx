import { activateListRow } from "./list-row-action";
import { mobileDisplayDefinition, mobileDisplayEvent } from "../app/mobile-localization";
import type { ClinicalFormConfiguration, ReportAudioNote, ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";
import React, { useId, useState } from "react";
import { displayDecimal, formatClinicalNumber, useRegionalFormat } from "../app/regional-format";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { DEMO_FALLBACK_DATE } from "../app/demo-provenance";
import { encounterEventDetail, encounterEventPresentation, type EncounterEvent } from "../app/standard-encounter";
import type { EncounterDefinition } from "../app/encounter-definition";
import { validateProcedure } from "../app/procedure";
import { formatAudioDuration } from "../app/report-audio-notes";
import { reportTextNoteExcerpt, type NativeAudioNoteTimelineItem, type NativePhotoNoteTimelineItem, type NativeTextNoteTimelineItem } from "../app/report-text-notes";
import { AuthorizedPhotoImage } from "./photo-note";
import { AuthorizedAudioButton } from "./audio-note";

export type EncounterTimelineItem = (EncounterEvent & { readonly sortTime: string }) | NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem;
export type EncounterTimelineFilter = "all" | "notes";


export function filterEncounterTimeline(events: ReadonlyArray<EncounterTimelineItem>, filter: EncounterTimelineFilter): ReadonlyArray<EncounterTimelineItem> {
  return filter === "notes" ? events.filter(({ kind }) => kind === "text-note" || kind === "photo-note" || kind === "audio-note") : events;
}

export function EncounterTimeline({ events, validationStatuses, definition: sourceDefinition, clinicalForm, headingId, language, className, readOnly = false, mediaContentPath, onOpenTextNote, onOpenPhoto, onOpenAudio, onOpenEvent }: {
  readonly events: ReadonlyArray<EncounterTimelineItem>;
  readonly validationStatuses: ReadonlyMap<string, "warning" | "error">;
  readonly definition: EncounterDefinition;
  readonly clinicalForm?: ClinicalFormConfiguration;
  readonly headingId: string;
  readonly language: AgencyLanguage;
  readonly className?: string;
  readonly readOnly?: boolean;
  readonly mediaContentPath?: (note: ReportPhotoNote | ReportAudioNote) => string;
  readonly onOpenTextNote: (note: ReportTextNote, trigger: HTMLElement) => void;
  readonly onOpenPhoto: (note: ReportPhotoNote, trigger: HTMLElement) => void;
  readonly onOpenAudio: (note: ReportAudioNote, trigger: HTMLElement) => void;
  readonly onOpenEvent: (event: EncounterEvent, trigger: HTMLElement) => void;
}) {
  const region = useRegionalFormat();
  const definition = mobileDisplayDefinition(sourceDefinition, language, clinicalForm);
  const [filter, setFilter] = useState<EncounterTimelineFilter>("all");
  const t = (key: string, parameters?: Record<string, string | number>, count?: number) => resolveMessage(language, key, parameters, count);
  const filterLabelId = useId();
  const visibleEvents = filterEncounterTimeline(events, filter);
  const procedureDefinition = definition.events.procedure;

  return <section className={`content-panel encounter-timeline${className ? ` ${className}` : ""}`} aria-labelledby={headingId}>
    <div className="section-heading timeline-heading">
      <div><p className="eyebrow">{t("mobile.timelineOrder")}</p><h1 id={headingId}>{t("mobile.timeline")}</h1></div>
      <span aria-live="polite">{t("mobile.eventCount", { count: formatClinicalNumber(visibleEvents.length, region) }, visibleEvents.length)}</span>
    </div>
    <div className="timeline-filters" role="group" aria-labelledby={filterLabelId}>
      <span className="visually-hidden" id={filterLabelId}>{t("mobile.filterTimeline")}</span>
      <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("mobile.all")}</button>
      <button type="button" aria-pressed={filter === "notes"} onClick={() => setFilter("notes")}>{t("mobile.notes")}</button>
    </div>
    {visibleEvents.length === 0 ? <p className="timeline-empty">{filter === "notes" ? t("mobile.noNotes") : t("mobile.noEvents")}</p> : <ol className="timeline-list">
      {visibleEvents.map((event) => {
        if (event.kind === "photo-note") {
          const photoState = event.note.persistenceState === "saved-on-device" ? t("mobile.savedOnDevice")
            : t(event.note.persistenceState === "failed" ? "mobile.failed" : event.note.persistenceState === "uploading" ? "mobile.uploading" : event.note.persistenceState === "processing" ? "mobile.processing" : "mobile.ready");
          return <li key={event.id} className="editable-event photo-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className={`event-dot validation-${event.note.persistenceState === "failed" ? "error" : "clear"}`} role="img" aria-label={t("mobile.photoState", { state: photoState })} />
            <div className="timeline-event-button photo-timeline-button" onClick={activateListRow}>
              <span className="photo-timeline-copy"><span className="event-title">{t("mobile.photoNote")}</span><span className="event-detail">{event.note.caption || t("mobile.noCaption")}</span>
                <small>{event.note.author.displayName} · {photoState}</small></span>
              <AuthorizedPhotoImage language={language} reportId={event.note.reportId} noteId={event.note.id} contentPath={mediaContentPath?.(event.note)} alt="" className="photo-thumbnail" />
              <button className="timeline-row-action" data-list-row-action type="button" aria-label={t("mobile.openPhoto", { time: event.time, author: event.note.author.displayName, caption: event.note.caption ?? t("mobile.noCaption") })}
                onClick={(clickEvent) => onOpenPhoto(event.note, clickEvent.currentTarget)}>{t("mobile.openPhotoShort")}</button>
            </div>
          </li>;
        }
        if (event.kind === "audio-note") {
          const duration = formatAudioDuration(event.note.durationMilliseconds);
          const audioState = event.note.persistenceState === "saved-on-device" ? t("mobile.savedOnDevice")
            : t(event.note.persistenceState === "failed" ? "mobile.failed" : event.note.persistenceState === "uploading" ? "mobile.uploading" : event.note.persistenceState === "processing" ? "mobile.processing" : "mobile.ready");
          return <li key={event.id} className="editable-event audio-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className={`event-dot validation-${event.note.persistenceState === "failed" ? "error" : "clear"}`} role="img" aria-label={t("mobile.audioState", { state: audioState })} />
            <div className="audio-timeline-content">
              <div className="timeline-event-button" onClick={activateListRow}>
                <span className="event-title">{t("mobile.audioNote")} · {duration}</span><span className="event-detail">{event.note.caption || t("mobile.noCaption")}</span>
                <small>{event.note.author.displayName} · {audioState}</small>
                <button className="timeline-row-action" data-list-row-action type="button" aria-label={t("mobile.openAudio", { time: event.time, author: event.note.author.displayName, duration, caption: event.note.caption ?? t("mobile.noCaption") })}
                  onClick={(clickEvent) => onOpenAudio(event.note, clickEvent.currentTarget)}>{t("mobile.openAudioShort")}</button>
              </div>
              <AuthorizedAudioButton language={language} reportId={event.note.reportId} noteId={event.note.id} contentPath={mediaContentPath?.(event.note)} label={t("mobile.playAudio", { duration })} className="timeline-audio-action" />
            </div>
          </li>;
        }
        if (event.kind === "text-note") {
          const excerpt = reportTextNoteExcerpt(event.note.content);
          return <li key={event.id} className="editable-event text-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className="event-dot validation-clear" role="img" aria-label={t("mobile.textReady")} />
            <div className="timeline-event-button" onClick={activateListRow}>
              <span className="event-title">{t("mobile.textNote")}</span><span className="event-detail">{excerpt}</span>
              <small>{event.note.author.displayName} · {t("mobile.ready")}</small>
              <button className="timeline-row-action" data-list-row-action type="button" aria-label={t("mobile.openText", { time: event.time, author: event.note.author.displayName, excerpt })}
                onClick={(clickEvent) => onOpenTextNote(event.note, clickEvent.currentTarget)}>{t("mobile.openNote")}</button>
            </div>
          </li>;
        }
        const validationStatus = validationStatuses.get(event.id) ?? "clear";
        const displayedEvent = mobileDisplayEvent(event, language, clinicalForm);
        const presentation = encounterEventPresentation(displayedEvent, definition);
        const title = event.medication?.dose ? presentation.title.replace(event.medication.dose, displayDecimal(event.medication.dose, region)) : presentation.title;
        const eventDetail = encounterEventDetail(displayedEvent, definition);
        return <li key={event.id} className={event.kind === "note" || event.kind === "medication" || event.kind === "procedure" ? "editable-event" : undefined}>
          <time dateTime={event.dateTime ?? `${event.date ?? DEMO_FALLBACK_DATE}T${event.time}:00`}>{event.time}</time>
          <span className={`event-dot validation-${validationStatus}`} role="img" aria-label={t("mobile.validationStatus", { status: t(validationStatus === "clear" ? "mobile.validationClear" : validationStatus === "error" ? "mobile.validationError" : "mobile.validationWarning") })} />
          {event.kind === "note" || event.kind === "procedure" || event.kind === "medication" || event.vitals ? (
            <div className="timeline-event-button" onClick={activateListRow}>
              <span className="event-title">{title}</span><span className="event-detail">{eventDetail}</span>
              <small>{presentation.reference}</small>
              {event.procedure && validateProcedure({ id: event.id, date: event.date ?? DEMO_FALLBACK_DATE, time: event.time,
                procedureCode: event.procedure.code, procedureLabel: event.procedure.label, attempts: String(event.procedure.attempts),
                success: event.procedure.success, outcome: event.procedure.outcome, complications: event.procedure.complications,
                warningAcknowledged: event.procedure.warningAcknowledged, isNew: false,
              }, procedureDefinition).warnings.length > 0 && !event.procedure.warningAcknowledged && <span className="warning-pill">{procedureDefinition.labels.warningPill}</span>}
              <button className="timeline-row-action" data-list-row-action type="button" aria-label={t(readOnly ? "mobile.viewEvent" : "mobile.editEvent", { title, time: event.time, detail: eventDetail })}
                onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}>{t(readOnly ? "admin.viewDetails" : "admin.edit")}</button>
            </div>
          ) : <div><h2>{title}</h2><p>{eventDetail}</p><small>{event.reference}</small></div>}
        </li>;
      })}
    </ol>}
  </section>;
}
