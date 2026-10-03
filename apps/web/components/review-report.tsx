"use client";

import type { ReportAudioNote, ReportNote, ReportPhotoNote, ReviewOverdueDraft, ReviewSignedReport } from "@open-triage/contracts";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useAgencyTimeZone } from "../app/agency-time-zone";
import { encounterEvents } from "../app/canonical-events";
import { documentTimeline } from "../app/incident-document";
import { resolveMessage, type AgencyLanguage } from "../app/localization";
import { mobileDisplayDefinition, mobileDisplayEvent } from "../app/mobile-localization";
import { completeReportTimeline } from "../app/report-text-notes";
import { bundledEncounterDefinition, encounterEventDetail, encounterEventPresentation, type EncounterEvent } from "../app/standard-encounter";
import { AuthorizedAudioButton } from "./audio-note";
import { EncounterTimeline } from "./encounter-timeline";
import { AuthorizedPhotoImage } from "./photo-note";
import { StationaryRecord } from "./stationary-record";
import { WorkspaceSidebar } from "./workspace-sidebar";

export function ReviewReport({ report, full = false, dataset, language, toolbarRef, findingsOpen, onToggleFindings, onClose }: {
  report: ReviewSignedReport | ReviewOverdueDraft;
  full?: boolean;
  dataset: "real" | "synthetic";
  language: AgencyLanguage;
  toolbarRef?: RefObject<HTMLElement | null>;
  findingsOpen?: boolean;
  onToggleFindings?: () => void;
  onClose?: () => void;
}) {
  const t = (key: string) => resolveMessage(language, key);
  const zone = useAgencyTimeZone();
  const timelineId = useId();
  const [timelineOpen, setTimelineOpen] = useState(false);
  const timelineToggle = useRef<HTMLButtonElement>(null);
  const ownToolbar = useRef<HTMLElement>(null);
  const toolbar = toolbarRef ?? ownToolbar;
  const [selection, setSelection] = useState<{ note: ReportNote } | { event: EncounterEvent } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const timeline = useMemo(() => completeReportTimeline(report.document ? [
    ...documentTimeline(report.document, zone),
    ...encounterEvents(report.document, bundledEncounterDefinition, zone),
  ] : [], report.notes, zone), [report.document, report.notes, zone]);
  const mediaContentPath = (note: ReportPhotoNote | ReportAudioNote) =>
    `/api/review/reports/${report.id}/${note.type}/${note.id}/content?dataset=${dataset}`;

  useEffect(() => { if (selection && !dialog.current?.open) dialog.current?.showModal(); }, [selection]);
  const openNote = (note: ReportNote, element: HTMLElement) => { trigger.current = element; setSelection({ note }); };
  const displayedEvent = selection && "event" in selection ? mobileDisplayEvent(selection.event, language, report.clinicalForm) : null;
  const definition = mobileDisplayDefinition(bundledEncounterDefinition, language, report.clinicalForm);
  const title = displayedEvent ? encounterEventPresentation(displayedEvent, definition).title :
    selection && "note" in selection ? t(`noteUi.kind.${selection.note.type}`) : "";

  const closeTimeline = () => { setTimelineOpen(false); timelineToggle.current?.focus(); };
  const timelinePanel = <EncounterTimeline events={timeline} validationStatuses={new Map()} definition={bundledEncounterDefinition}
    clinicalForm={report.clinicalForm} headingId={`${timelineId}-heading`} language={language} readOnly
    mediaContentPath={mediaContentPath} onOpenTextNote={openNote} onOpenPhoto={openNote} onOpenAudio={openNote}
    onOpenEvent={(event, element) => { trigger.current = element; setSelection({ event }); }} />;

  return <div className={`review-report${full ? " review-report-full" : ""}${full && timelineOpen ? " has-timeline" : ""}`}
    style={{ "--review-sidebar-offset": findingsOpen ? "360px" : "0px" } as CSSProperties}>
    <header ref={toolbar} className="review-report-toolbar">
    <button ref={timelineToggle} type="button" aria-expanded={timelineOpen} aria-controls={timelineId} onClick={() => setTimelineOpen(!timelineOpen)}>
      {t("mobile.timeline")} <span aria-hidden="true">· {timeline.length}</span>
    </button>
    {full && onToggleFindings && <button id="review-findings-toggle" type="button" aria-expanded={findingsOpen} aria-controls="review-inspector"
      onClick={onToggleFindings}>{t("review.workspace.findings")}</button>}
    {full && onClose && <button type="button" className="review-report-close" aria-label={t("review.workspace.closeReport")}
      title={t("review.workspace.closeReport")} onClick={onClose}>×</button>}
    </header>
    {timelineOpen && (full ? <WorkspaceSidebar id={timelineId} className="review-timeline-sidebar" label={t("mobile.encounterTimeline")}
      anchor={toolbar} onEscape={closeTimeline}>{timelinePanel}</WorkspaceSidebar> :
      <div id={timelineId} className="review-report-timeline">{timelinePanel}</div>)}
    <div className="review-report-body">
    {full && "amendmentSequence" in report && report.amendmentSequence > 0 && <p className="review-report-amendments">{resolveMessage(language, "review.amendments", { count: report.amendmentSequence })}</p>}
    {full && report.document ? <StationaryRecord readOnly
      document={report.document} formDefinition={report.clinicalForm?.definition}
      catalogFields={report.clinicalForm?.catalogFields} customFields={report.clinicalForm?.customFields}
      customGroups={report.clinicalForm?.customGroups} catalogGroups={report.clinicalForm?.catalogGroups}
      validation={report.clinicalForm?.validation} language={language} onDocumentChange={() => {}} /> : <>
      {report.groups.filter((group) => report.values.some((value) => value.groupInstanceId === group.id)).map((group) => <section key={group.id}>
        <h3>{group.parentGroupInstanceId ? `${report.groups.find((item) => item.id === group.parentGroupInstanceId)?.label ?? ""} / ` : ""}
          {group.label} {group.ordinal > 0 ? `#${group.ordinal + 1}` : ""}</h3>
        <ReviewValues values={report.values.filter((value) => value.groupInstanceId === group.id)} />
      </section>)}
      <ReviewValues values={report.values.filter((value) => !value.groupInstanceId)} />
    </>}
    {(!full || !report.document) && report.notes.length > 0 && <section><h3>{t("review.notes")}</h3>
      {report.notes.map((note) => <article key={note.id} className="review-report-note">
        <time dateTime={note.capturedAt}>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(note.capturedAt))}</time>
        {note.type === "text" ? <p>{note.content}</p> : <>
          {note.caption && <p>{note.caption}</p>}
          <button type="button" onClick={(event) => openNote(note, event.currentTarget)}>{t(note.type === "photo" ? "review.openPhoto" : "review.playAudio")}</button>
        </>}
      </article>)}
    </section>}
    </div>
    <dialog ref={dialog} className="review-note-dialog" aria-labelledby={`${timelineId}-entry-heading`}
      onClose={() => { setSelection(null); trigger.current?.focus(); }}>
      <header><h2 id={`${timelineId}-entry-heading`}>{title}</h2>
        <button type="button" aria-label={t("stationary.closeDialog")} onClick={() => dialog.current?.close()}>{t("review.close")}</button></header>
      {displayedEvent && <><p>{displayedEvent.time}</p><p>{encounterEventDetail(displayedEvent, definition)}</p><small>{displayedEvent.reference}</small></>}
      {selection && "note" in selection && <>
        <p>{new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(selection.note.capturedAt))}</p>
        {selection.note.type === "text" ? <p className="review-note-text">{selection.note.content}</p> : <>
          {selection.note.caption && <p>{selection.note.caption}</p>}
          {selection.note.type === "photo" ? <AuthorizedPhotoImage key={selection.note.id} reportId={report.id} noteId={selection.note.id}
            contentPath={mediaContentPath(selection.note)} language={language} alt={selection.note.caption ?? t("review.photo")} /> :
            <AuthorizedAudioButton key={selection.note.id} reportId={report.id} noteId={selection.note.id}
              contentPath={mediaContentPath(selection.note)} language={language} />}
        </>}
      </>}
    </dialog>
  </div>;
}

function ReviewValues({ values }: { values: ReviewSignedReport["values"] }) {
  return values.length > 0 && <dl>{values.map((value) => <div key={value.id}>
    <dt>{value.label}{value.ordinal > 0 ? ` #${value.ordinal + 1}` : ""}</dt>
    <dd>{value.codeDisplay ?? value.absenceDisplay ?? String(value.value ?? "—")}</dd>
  </div>)}</dl>;
}
