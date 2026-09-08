import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { SESSION_COOKIE, bearerToken } from "./clinician-session.controller.js";
import { ClinicianSessionService } from "./clinician-session.service.js";

type HttpRequest = { method: string; originalUrl?: string; url?: string; headers: Record<string, string | string[] | undefined> };

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly sessions: ClinicianSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase())) return true;
    const path = request.originalUrl ?? request.url ?? "";
    if (request.method.toUpperCase() === "POST" && /\/sessions\/?(?:\?.*)?$/.test(path)) return true;
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
    if (!cookie?.includes(`${SESSION_COOKIE}=`)) return true; // Legacy bearer clients are not vulnerable to cookie CSRF.
    const token = bearerToken(undefined, cookie);
    const csrf = request.headers["x-csrf-token"];
    await this.sessions.assertCsrf(token, typeof csrf === "string" ? csrf : undefined);
    return true;
  }
}
