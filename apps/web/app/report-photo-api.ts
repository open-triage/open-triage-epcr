import { platformRequestError } from "./platform-errors";
import type {
  CreateReportPhotoNoteCommand,
  DeleteReportPhotoNoteResponse,
  ReportPhotoNoteMutationResponse,
  UpdateReportPhotoCaptionCommand,
} from "@open-triage/contracts";
import { browserRequestConfiguration, browserRequestInit, browserRouteUrl } from "./browser-api";
import { DraftSaveRejectedError } from "./draft-report";

async function mutate<T>(csrfToken: string, path: string, method: "POST" | "DELETE", body: unknown): Promise<T> {
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    throw new Error("Photo notes require the database-backed application.");
  }
  let response: Response;
  try {
    response = await fetch(browserRouteUrl(path, configuration), browserRequestInit({
      method,
      headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  } catch {
    throw new Error("The photo could not be saved. Check your connection and try again.");
  }
  if (response.status === 409) {
    const detail = await response.clone().json().catch(() => null) as { code?: string } | null;
    if (detail?.code === "media.allowanceExceeded" || detail?.code === "media.photoTooLarge") throw await platformRequestError(response);
    throw new DraftSaveRejectedError("server-conflict");
  }
  if (response.status === 422 || response.status === 413) throw new DraftSaveRejectedError("validation-rejected");
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<T>;
}

export function createReportPhotoNote(csrfToken: string, reportId: string, command: CreateReportPhotoNoteCommand) {
  return mutate<ReportPhotoNoteMutationResponse>(csrfToken, `/api/reports/${reportId}/photos`, "POST", command);
}

export function updateReportPhotoCaption(csrfToken: string, reportId: string, noteId: string, command: UpdateReportPhotoCaptionCommand) {
  return mutate<ReportPhotoNoteMutationResponse>(csrfToken, `/api/reports/${reportId}/photos/${noteId}`, "POST", command);
}

export function deleteReportPhotoNote(csrfToken: string, reportId: string, noteId: string, command: { commandId: string; expectedRevision: number }) {
  return mutate<DeleteReportPhotoNoteResponse>(csrfToken, `/api/reports/${reportId}/photos/${noteId}`, "DELETE", command);
}

export async function fetchReportPhoto(reportId: string, noteId: string, contentPath?: string): Promise<Blob> {
  const response = await fetch(browserRouteUrl(contentPath ?? `/api/reports/${reportId}/photos/${noteId}/image`), browserRequestInit());
  if (!response.ok) throw await platformRequestError(response);
  if (response.headers.get("content-type") !== "image/jpeg") throw new Error("The photo response was not a canonical JPEG.");
  return response.blob();
}
