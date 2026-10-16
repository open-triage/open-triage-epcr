import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
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
    // Fresh login also works with an expired cookie. The non-simple header and
    // registered-origin middleware protect it; switch/reauth verify CSRF in service.
    if(request.method.toUpperCase()==="POST" && path==="/api/sessions/oidc/login" && request.headers['x-personal-authentication']==='1')return true;
    // Target-host handoff bootstrap has its own browser challenge and one-use
    // exchange; the source start/issue endpoints retain normal session CSRF.
    if(request.method.toUpperCase()==="POST"&&/^\/api\/sessions\/agency-handoff\/(challenge|consume)\/?(?:\?.*)?$/.test(path)){
      if(request.headers['x-agency-handoff']!=='1')throw new UnauthorizedException({code:'auth.agencyHandoffInvalid'});
      return true;
    }
    // Independent bearer enrollment requires a non-simple header, forcing origin/CORS validation.
    // Exact bootstrap routes never depend on a clinician cookie (including expired cookies).
    if (request.method.toUpperCase() === "POST" && /^\/api\/installations\/(preview|enroll)\/?$/.test(path) &&
      request.headers["x-installation-enrollment"] === "1") return true;
    const cookie = typeof request.headers.cookie === "string" ? request.headers.cookie : undefined;
    if (!cookie?.includes(`${SESSION_COOKIE}=`)) return true; // Legacy bearer clients are not vulnerable to cookie CSRF.
    const token = bearerToken(undefined, cookie);
    const csrf = request.headers["x-csrf-token"];
    await this.sessions.assertCsrf(token, typeof csrf === "string" ? csrf : undefined);
    return true;
  }
}
