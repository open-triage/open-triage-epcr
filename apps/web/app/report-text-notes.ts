import type { ReportAudioNote, ReportNote, ReportPhotoNote, ReportTextNote } from "@open-triage/contracts";

export const REPORT_TEXT_NOTE_MAX_CHARACTERS = 10_000;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export type ReportTextNoteValidation = {
  readonly content: string;
  readonly error: string | null;
  readonly characterCount: number;
};

export function validateReportTextNote(value: string): ReportTextNoteValidation {
  const content = value.normalize("NFC").trim();
  const characterCount = [...content].length;
  const error = !content
    ? "Enter a text note before saving."
    : UNSAFE_CONTROL_CHARACTER.test(content)
      ? "Text notes cannot contain control characters."
      : characterCount > REPORT_TEXT_NOTE_MAX_CHARACTERS
        ? `Text notes are limited to ${REPORT_TEXT_NOTE_MAX_CHARACTERS.toLocaleString()} characters.`
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

export function noteReadinessBlockers(notes: ReadonlyArray<ReportNote>): ReadonlyArray<NoteReadinessBlocker> {
  return notes.filter(({ persistenceState }) => persistenceState !== "ready").map((note) => {
    const kind = note.type === "audio" ? "Audio" : note.type === "photo" ? "Photo" : "Text";
    const state = note.persistenceState === "saved-on-device" ? "saved on this device" : note.persistenceState;
    return {
      note,
      title: `${kind} note is not ready`,
      message: `${kind} note is ${state}. It must be ready or deleted before signing.`,
      action: note.persistenceState === "failed" ? "Open to retry or delete →" : "Open note actions →",
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

function noteTimelineTime(capturedAt: string, agencyTimeZone?: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    ...(agencyTimeZone ? { timeZone: agencyTimeZone } : {}),
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(capturedAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}` };
}

export function completeReportTimeline<T extends { readonly id: string; readonly date?: string; readonly time: string; readonly dateTime?: string }>(
  structuredEvents: ReadonlyArray<T>,
  notes: ReadonlyArray<ReportNote>,
  agencyTimeZone?: string,
): ReadonlyArray<(T & { readonly sortTime: string }) | NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem> {
  const structured = structuredEvents.map((event) => ({
    ...event,
    sortTime: event.dateTime ?? `${event.date ?? "1970-01-01"}T${event.time}:00`,
  }));
  const nativeNotes = notes.map((note): NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem => ({
    id: note.id,
    kind: note.type === "text" ? "text-note" : note.type === "photo" ? "photo-note" : "audio-note",
    ...noteTimelineTime(note.capturedAt, agencyTimeZone),
    sortTime: note.capturedAt,
    note,
  } as NativeTextNoteTimelineItem | NativePhotoNoteTimelineItem | NativeAudioNoteTimelineItem));
  return [...structured, ...nativeNotes]
    .sort((a, b) => Date.parse(b.sortTime) - Date.parse(a.sortTime) || b.id.localeCompare(a.id));
}
