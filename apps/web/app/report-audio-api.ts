import type { CreateReportAudioNoteCommand, DeleteReportAudioNoteResponse, ReportAudioNoteMutationResponse, UpdateReportAudioCaptionCommand } from "@open-triage/contracts";
import { browserRequestConfiguration, browserRequestInit, browserRouteUrl } from "./browser-api";
import { DraftSaveRejectedError } from "./draft-report";

async function mutate<T>(csrfToken: string, path: string, method: "POST" | "DELETE", body: unknown): Promise<T> {
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) throw new Error("Audio notes require the database-backed application.");
  let response: Response;
  try {
    response = await fetch(browserRouteUrl(path, configuration), browserRequestInit({ method,
      headers: { "x-csrf-token": csrfToken, "content-type": "application/json" }, body: JSON.stringify(body) }));
  } catch { throw new Error("The recording could not be saved. Check your connection and try again."); }
  if (response.status === 409) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    if (detail?.message?.includes("allowance")) throw new Error(detail.message);
    throw new DraftSaveRejectedError("server-conflict");
  }
  if (response.status === 422 || response.status === 413) throw new DraftSaveRejectedError("validation-rejected");
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "The recording could not be saved.");
  return response.json() as Promise<T>;
}

export function createReportAudioNote(csrfToken: string, reportId: string, command: CreateReportAudioNoteCommand) {
  return mutate<ReportAudioNoteMutationResponse>(csrfToken, `/api/reports/${reportId}/audio`, "POST", command);
}

export function updateReportAudioCaption(csrfToken: string, reportId: string, noteId: string, command: UpdateReportAudioCaptionCommand) {
  return mutate<ReportAudioNoteMutationResponse>(csrfToken, `/api/reports/${reportId}/audio/${noteId}`, "POST", command);
}

export function deleteReportAudioNote(csrfToken: string, reportId: string, noteId: string, command: { commandId: string; expectedRevision: number }) {
  return mutate<DeleteReportAudioNoteResponse>(csrfToken, `/api/reports/${reportId}/audio/${noteId}`, "DELETE", command);
}

export async function fetchReportAudio(reportId: string, noteId: string): Promise<Blob> {
  const response = await fetch(browserRouteUrl(`/api/reports/${reportId}/audio/${noteId}/content`), browserRequestInit());
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "The recording could not be opened.");
  if (response.headers.get("content-type") !== "audio/mp4") throw new Error("The recording response was not canonical M4A audio.");
  return response.blob();
}
