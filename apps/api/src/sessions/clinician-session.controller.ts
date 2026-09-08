import { Body, Controller, Delete, Get, Headers, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { ChangePasswordCommand, ClinicianSession, EndClinicianSessionResponse } from "@open-triage/contracts";
import { ClinicianSessionService } from "./clinician-session.service.js";
import { validateChangePassword, validateCreateClinicianSession } from "./clinician-session.validation.js";

export const SESSION_COOKIE = "open_triage_session";
type RequestLike = { headers: { cookie?: string } };
type ResponseLike = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void };

export function bearerToken(authorization: string | undefined, cookie?: string): string {
  const encoded = cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (encoded) return decodeURIComponent(encoded.slice(SESSION_COOKIE.length + 1));
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new UnauthorizedException("A clinician session is required");
  return match[1];
}

export function sessionToken(request: RequestLike, authorization?: string): string {
  return bearerToken(authorization, request.headers.cookie);
}

function cookieOptions(expiresAt?: string): Record<string, unknown> {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/api", ...(expiresAt ? { expires: new Date(expiresAt) } : {}) };
}

@Controller("sessions")
export class ClinicianSessionController {
  constructor(private readonly sessions: ClinicianSessionService) {}

  @Post()
  async create(@Body() body: unknown, @Res({ passthrough: true }) response: ResponseLike): Promise<ClinicianSession> {
    const created = await this.sessions.create(validateCreateClinicianSession(body));
    response.cookie(SESSION_COOKIE, created.sessionToken, cookieOptions(created.session.expiresAt));
    return created.session;
  }

  @Get("current")
  current(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<ClinicianSession> {
    return this.sessions.get(sessionToken(request, authorization), new Date(), true);
  }

  @Post("password")
  @HttpCode(200)
  async changePassword(
    @Req() request: RequestLike, @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
    @Headers("authorization") authorization?: string
  ): Promise<ClinicianSession> {
    const created = await this.sessions.changePassword(sessionToken(request, authorization), validateChangePassword(body));
    response.cookie(SESSION_COOKIE, created.sessionToken, cookieOptions(created.session.expiresAt));
    return created.session;
  }

  @Delete("current")
  async end(
    @Req() request: RequestLike, @Headers("x-csrf-token") csrfToken: string | undefined,
    @Res({ passthrough: true }) response: ResponseLike,
    @Headers("authorization") authorization?: string
  ): Promise<EndClinicianSessionResponse> {
    await this.sessions.end(sessionToken(request, authorization), csrfToken);
    response.clearCookie(SESSION_COOKIE, cookieOptions());
    return { ended: true };
  }
}
