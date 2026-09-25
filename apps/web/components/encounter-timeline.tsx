import type { ReportAudioNote, ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";
import { useId, useState } from "react";
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

export function EncounterTimeline({ events, validationStatuses, definition, headingId, className, onOpenTextNote, onOpenPhoto, onOpenAudio, onOpenEvent }: {
  readonly events: ReadonlyArray<EncounterTimelineItem>;
  readonly validationStatuses: ReadonlyMap<string, "warning" | "error">;
  readonly definition: EncounterDefinition;
  readonly headingId: string;
  readonly className?: string;
  readonly onOpenTextNote: (note: ReportTextNote, trigger: HTMLElement) => void;
  readonly onOpenPhoto: (note: ReportPhotoNote, trigger: HTMLElement) => void;
  readonly onOpenAudio: (note: ReportAudioNote, trigger: HTMLElement) => void;
  readonly onOpenEvent: (event: EncounterEvent, trigger: HTMLElement) => void;
}) {
  const [filter, setFilter] = useState<EncounterTimelineFilter>("all");
  const filterLabelId = useId();
  const visibleEvents = filterEncounterTimeline(events, filter);
  const procedureDefinition = definition.events.procedure;

  return <section className={`content-panel encounter-timeline${className ? ` ${className}` : ""}`} aria-labelledby={headingId}>
    <div className="section-heading timeline-heading">
      <div><p className="eyebrow">Newest first</p><h1 id={headingId}>Timeline</h1></div>
      <span aria-live="polite">{visibleEvents.length} {visibleEvents.length === 1 ? "event" : "events"}</span>
    </div>
    <div className="timeline-filters" role="group" aria-labelledby={filterLabelId}>
      <span className="visually-hidden" id={filterLabelId}>Filter timeline</span>
      <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      <button type="button" aria-pressed={filter === "notes"} onClick={() => setFilter("notes")}>Notes</button>
    </div>
    {visibleEvents.length === 0 ? <p className="timeline-empty">{filter === "notes" ? "No notes have been added." : "No timeline events are available."}</p> : <ol className="timeline-list">
      {visibleEvents.map((event) => {
        if (event.kind === "photo-note") {
          const photoState = event.note.persistenceState === "saved-on-device" ? "Saved on this device"
            : event.note.persistenceState[0]!.toUpperCase() + event.note.persistenceState.slice(1);
          return <li key={event.id} className="editable-event photo-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className={`event-dot validation-${event.note.persistenceState === "failed" ? "error" : "clear"}`} role="img" aria-label={`Photo note ${photoState}`} />
            <button aria-label={`Open photo note at ${event.time} by ${event.note.author.displayName}. ${event.note.caption ?? "No caption"}`} className="timeline-event-button photo-timeline-button" type="button" onClick={(clickEvent) => onOpenPhoto(event.note, clickEvent.currentTarget)}>
              <span className="photo-timeline-copy"><span className="event-title">Photo note</span><span className="event-detail">{event.note.caption || "No caption"}</span>
                <small>{event.note.author.displayName} · {photoState} · Open photo</small></span>
              <AuthorizedPhotoImage reportId={event.note.reportId} noteId={event.note.id} alt="" className="photo-thumbnail" />
            </button>
          </li>;
        }
        if (event.kind === "audio-note") {
          const duration = formatAudioDuration(event.note.durationMilliseconds);
          const audioState = event.note.persistenceState === "saved-on-device" ? "Saved on this device"
            : event.note.persistenceState[0]!.toUpperCase() + event.note.persistenceState.slice(1);
          return <li key={event.id} className="editable-event audio-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className={`event-dot validation-${event.note.persistenceState === "failed" ? "error" : "clear"}`} role="img" aria-label={`Audio note ${audioState}`} />
            <div className="audio-timeline-content">
              <button aria-label={`Open audio note at ${event.time} by ${event.note.author.displayName}. ${duration}. ${event.note.caption ?? "No caption"}`}
                className="timeline-event-button" type="button" onClick={(clickEvent) => onOpenAudio(event.note, clickEvent.currentTarget)}>
                <span className="event-title">Audio note · {duration}</span><span className="event-detail">{event.note.caption || "No caption"}</span>
                <small>{event.note.author.displayName} · {audioState} · Open audio</small>
              </button>
              <AuthorizedAudioButton reportId={event.note.reportId} noteId={event.note.id} label={`Play audio note, ${duration}`} className="timeline-audio-action" />
            </div>
          </li>;
        }
        if (event.kind === "text-note") {
          const excerpt = reportTextNoteExcerpt(event.note.content);
          return <li key={event.id} className="editable-event text-note-event">
            <time dateTime={event.note.capturedAt}>{event.time}</time>
            <span className="event-dot validation-clear" role="img" aria-label="Text note ready" />
            <button aria-label={`Open text note at ${event.time} by ${event.note.author.displayName}. ${excerpt}`} className="timeline-event-button" type="button" onClick={(clickEvent) => onOpenTextNote(event.note, clickEvent.currentTarget)}>
              <span className="event-title">Text note</span><span className="event-detail">{excerpt}</span>
              <small>{event.note.author.displayName} · Ready · Open note</small>
            </button>
          </li>;
        }
        const validationStatus = validationStatuses.get(event.id) ?? "clear";
        const presentation = encounterEventPresentation(event, definition);
        const eventDetail = encounterEventDetail(event, definition);
        return <li key={event.id} className={event.kind === "note" || event.kind === "medication" || event.kind === "procedure" ? "editable-event" : undefined}>
          <time dateTime={event.dateTime ?? `${event.date ?? DEMO_FALLBACK_DATE}T${event.time}:00`}>{event.time}</time>
          <span className={`event-dot validation-${validationStatus}`} role="img" aria-label={`Validation ${validationStatus}`} />
          {event.kind === "note" || event.kind === "procedure" || event.kind === "medication" || event.vitals ? (
            <button aria-label={`Edit ${presentation.title} at ${event.time}. ${eventDetail}`} className="timeline-event-button" type="button" onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}>
              <span className="event-title">{presentation.title}</span><span className="event-detail">{eventDetail}</span>
              <small>{presentation.reference} · Open entry</small>
              {event.procedure && validateProcedure({ id: event.id, date: event.date ?? DEMO_FALLBACK_DATE, time: event.time,
                procedureCode: event.procedure.code, procedureLabel: event.procedure.label, attempts: String(event.procedure.attempts),
                success: event.procedure.success, outcome: event.procedure.outcome, complications: event.procedure.complications,
                warningAcknowledged: event.procedure.warningAcknowledged, isNew: false,
              }, procedureDefinition).warnings.length > 0 && !event.procedure.warningAcknowledged && <span className="warning-pill">{procedureDefinition.labels.warningPill}</span>}
            </button>
          ) : <div><h2>{event.title}</h2><p>{event.detail}</p><small>{event.reference}</small></div>}
        </li>;
      })}
    </ol>}
  </section>;
}
