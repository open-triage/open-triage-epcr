import { resolveMessage, type AgencyLanguage } from "./localization";
import type { CreateFeedbackCommand, CreateFeedbackResponse, FeedbackSubmissionType } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "./browser-api";

export const FEEDBACK_DESCRIPTION_MAX_LENGTH = 4000;

export function feedbackPrompt(type: FeedbackSubmissionType | null, language: AgencyLanguage = "en"): string {
  if (type === "bug") return resolveMessage(language, "noteUi.feedbackBugPrompt");
  if (type === "feature") return resolveMessage(language, "noteUi.feedbackFeaturePrompt");
  return resolveMessage(language, "noteUi.feedbackChoosePrompt");
}

export function feedbackDescriptionError(description: string, language: AgencyLanguage = "en"): string | null {
  if (!description.trim()) return resolveMessage(language, "noteUi.feedbackDescriptionRequired");
  if (description.length > FEEDBACK_DESCRIPTION_MAX_LENGTH) return resolveMessage(language, "noteUi.feedbackDescriptionLimit");
  return null;
}

export async function submitFeedback(csrfToken: string, command: CreateFeedbackCommand, language: AgencyLanguage = "en"): Promise<CreateFeedbackResponse> {
  const url = apiRequestUrl("/api/feedback/v1/submissions");
  if (!url) throw new Error(resolveMessage(language, "noteUi.feedbackStatic"));
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(command)
  }));
  if (!response.ok) throw new Error(response.status === 401
    ? resolveMessage(language, "noteUi.feedbackSession")
    : response.status === 429
      ? resolveMessage(language, "noteUi.feedbackRate")
    : resolveMessage(language, "noteUi.feedbackFailure"));
  return response.json() as Promise<CreateFeedbackResponse>;
}
