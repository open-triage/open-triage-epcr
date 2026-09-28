import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";

export type PlatformError = { code: string; params: Record<string, string | number> };

// These identities describe platform failures. Clinical validation findings retain
// their own pinned rule messages in the original response body.
const knownMessages: Record<string, PlatformError> = {
  "The username or password is incorrect": { code: "auth.invalidCredentials", params: {} },
  "The current password is incorrect": { code: "auth.invalidPassword", params: {} },
  "The clinician session has ended": { code: "auth.sessionEnded", params: {} },
  "A password change is required": { code: "auth.passwordChangeRequired", params: {} },
  "A valid CSRF token is required": { code: "auth.csrfRequired", params: {} },
  "The requested capability is required": { code: "auth.capabilityRequired", params: {} },
  "The selected unit is no longer eligible": { code: "calls.unitUnavailable", params: {} },
  "The selected unit is not eligible for synthetic calls": { code: "calls.unitUnavailable", params: {} },
  "The assignment was canceled before it could be opened": { code: "calls.callUnavailable", params: {} },
  "The call-opening command conflicts with existing clinical data": { code: "calls.commandConflict", params: {} },
  "That username is already reserved": { code: "admin.usernameReserved", params: {} },
  "Role version is stale": { code: "admin.roleStale", params: {} },
  "This feedback retry does not match the original draft": { code: "feedback.retryConflict", params: {} },
  "Report is already signed": { code: "reports.alreadySigned", params: {} },
  "Only a clinician-owned synthetic draft can be deleted": { code: "reports.deleteDenied", params: {} },
  "The draft is not available to this clinician": { code: "reports.unavailable", params: {} },
  "This call can no longer be opened": { code: "calls.callUnavailable", params: {} },
};

function errorDomain(path: string): string {
  if (/^\/api\/sessions(?:\/|$)/.test(path)) return "auth";
  if (/^\/api\/admin(?:\/|$)/.test(path)) return "admin";
  if (/^\/api\/calls(?:\/|$)/.test(path)) return "calls";
  if (/^\/api\/reports(?:\/|$)/.test(path)) return "reports";
  if (/^\/api\/feedback(?:\/|$)/.test(path)) return "feedback";
  return "platform";
}

export function identifyPlatformError(status: number, path: string, body: Record<string, unknown>): PlatformError {
  if (typeof body.code === "string" && /^[a-z][a-zA-Z0-9.]{0,99}$/.test(body.code)) {
    const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? Object.fromEntries(Object.entries(body.params).filter((entry): entry is [string, string | number] =>
        /^[a-zA-Z][a-zA-Z0-9]*$/.test(entry[0]) && (typeof entry[1] === "string" || typeof entry[1] === "number"))) : {};
    return { code: body.code, params };
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (message === "You have sent feedback in the last minute. Please try again later.") {
    return { code: "feedback.rateLimited", params: typeof body.retryAfterSeconds === "number"
      ? { seconds: body.retryAfterSeconds } : {} };
  }
  if (message === "Draft revision is stale" || message === "Draft revision is ahead of the server") {
    return { code: "reports.revisionConflict", params: Object.fromEntries(
      ["expectedRevision", "currentRevision"].filter((key) => typeof body[key] === "number")
        .map((key) => [key, body[key] as number])) };
  }
  if (knownMessages[message]) return knownMessages[message];
  const media = {
    "The photo exceeds the agency's per-image limit": "media.photoTooLarge",
    "The photo exceeds the report's remaining media allowance": "media.allowanceExceeded",
    "The recording exceeds the report's remaining media allowance": "media.allowanceExceeded",
  }[message];
  if (media) return { code: media, params: Object.fromEntries(
    ["imageLimitBytes", "imageBytes", "allowanceBytes", "usedBytes", "remainingBytes"]
      .filter((key) => typeof body[key] === "number")
      .map((key) => [key, body[key] as number])) };
  const duration = /^Temporary password duration must match the configured (\d+) hours$/.exec(message);
  if (duration) return { code: "admin.temporaryPasswordDuration", params: { hours: Number(duration[1]) } };
  return { code: `${errorDomain(path)}.http${status}`, params: {} };
}

@Catch()
export class PlatformErrorFilter implements ExceptionFilter<unknown> {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<{ path: string }>();
    const response = http.getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const original = exception instanceof HttpException ? exception.getResponse() : { message: "Internal server error" };
    const body: Record<string, unknown> = typeof original === "string" ? { message: original } :
      original && typeof original === "object" ? { ...original as Record<string, unknown> } : {};
    const identity = identifyPlatformError(status, request.path, body);
    response.status(status).json({ ...body, statusCode: status, ...identity });
  }
}
