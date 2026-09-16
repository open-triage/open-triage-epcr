import type { CreateFeedbackCommand, CreateFeedbackResponse, FeedbackSubmissionType } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "./browser-api";

export const FEEDBACK_DESCRIPTION_MAX_LENGTH = 4000;

export function feedbackPrompt(type: FeedbackSubmissionType | null): string {
  if (type === "bug") return "What happened, and what did you expect to happen?";
  if (type === "feature") return "What would you like to do, and why would it help?";
  return "Choose Bug or Feature to see the description prompt.";
}

export function feedbackDescriptionError(description: string): string | null {
  if (!description.trim()) return "Enter a description before submitting.";
  if (description.length > FEEDBACK_DESCRIPTION_MAX_LENGTH) return "Description must be 4,000 characters or fewer.";
  return null;
}

export async function submitFeedback(csrfToken: string, command: CreateFeedbackCommand): Promise<CreateFeedbackResponse> {
  const url = apiRequestUrl("/api/feedback/v1/submissions");
  if (!url) throw new Error("Feedback is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify(command)
  }));
  if (!response.ok) throw new Error(response.status === 401
    ? "Your session ended. Sign in and try again."
    : "Feedback could not be submitted. Your description is still here; please try again.");
  return response.json() as Promise<CreateFeedbackResponse>;
}
