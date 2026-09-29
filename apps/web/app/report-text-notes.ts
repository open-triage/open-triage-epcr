import { resolveMessage, type AgencyLanguage } from "./localization";
import type { ReportAudioNote, ReportNote, ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";
import { localStationaryDateTimeParts } from "./stationary-date-time";

export const REPORT_TEXT_NOTE_MAX_CHARACTERS = 10_000;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export type ReportTextNoteValidation = {
  readonly content: string;
  readonly error: string | null;
  readonly characterCount: number;
};

export function validateReportTextNote(value: string, language: AgencyLanguage = "en"): ReportTextNoteValidation {
  const content = value.normalize("NFC").trim();
  const characterCount = [...content].length;
  const error = !content
    ? resolveMessage(language, "noteUi.textRequired")
    : UNSAFE_CONTROL_CHARACTER.test(content)
      ? resolveMessage(language, "noteUi.textControls")
      : characterCount > REPORT_TEXT_NOTE_MAX_CHARACTERS
        ? resolveMessage(language, "noteUi.textLimit", { max: REPORT_TEXT_NOTE_MAX_CHARACTERS.toLocaleString() })
        : null;
  return { content, error, characterCount };
}

export function reportTextNoteExcerpt(content: string, maximum = 160): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  const characters = [...oneLine];
  return characters.length <= maximum ? oneLine : `${characters.slice(0, maximum - 1).join("")}…`;
}

export type NoteReadinessBlocker = {
  readonly note: ReportNote;
  readonly title: string;
  readonly message: string;
  readonly action: string;
};

export function noteReadinessBlockers(notes: ReadonlyArray<ReportNote>, language: AgencyLanguage = "en"): ReadonlyArray<NoteReadinessBlocker> {
  return notes.filter(({ persistenceState }) => persistenceState !== "ready").map((note) => {
    const kind = resolveMessage(language, `noteUi.kind.${note.type}`);
    const state = resolveMessage(language, `noteUi.state.${note.persistenceState}`);
    return {
      note,
      title: resolveMessage(language, "noteUi.readinessTitle", { kind }),
      message: resolveMessage(language, "noteUi.readinessMessage", { kind, state }),
      action: resolveMessage(language, note.persistenceState === "failed" ? "noteUi.readinessRetry" : "noteUi.readinessActions"),
    };
  });
}

export type NativeTextNoteTimelineItem = {
  readonly id: string;
  readonly kind: "text-note";
  readonly date: string;
  readonly time: string;
  readonly sortTime: string;
  readonly note: ReportTextNote;
};

export type NativePhotoNoteTimelineItem = {
  readonly id: string;
  readonly kind: "photo-note";
  readonly date: string;
  readonly time: string;
  readonly sortTime: string;
  readonly note: ReportPhotoNote;
};

export type NativeAudioNoteTimelineItem = {
  readonly id: string;
  readonly kind: "audio-note";
  readonly date: string;
  readonly time: string;
  readonly sortTime: string;
  readonly note: ReportAudioNote;
};

function noteTimelineTime(capturedAt: string, zone: string | null): { date: string; time: string } {
  const local = localStationaryDateTimeParts(capturedAt, zone);
  return local ? { date: local.date, time: local.time } : { date: "", time: "--:--" };
}

export function completeReportTimeline<T extends { readonly id: string; readonly date?: string; readonly time: string; readonly dateTime?: string }>(
  structuredEvents: ReadonlyArray<T>,
  notes: ReadonlyArray<ReportNote>,
  zone: string | null = null,
): ReadonlyArray<(T & { readonly sortTime: string }) | NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem> {
  const structured = structuredEvents.map((event) => ({
    ...event,
    sortTime: event.dateTime ?? `${event.date ?? "1970-01-01"}T${event.time}:00`,
  }));
  const nativeNotes = notes.map((note): NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem => ({
    id: note.id,
    kind: note.type === "text" ? "text-note" : note.type === "photo" ? "photo-note" : "audio-note",
    ...noteTimelineTime(note.capturedAt, zone),
    sortTime: note.capturedAt,
    note,
  } as NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem));
  return [...structured, ...nativeNotes]
    .sort((a, b) => Date.parse(b.sortTime) - Date.parse(a.sortTime) || b.id.localeCompare(a.id));
}
