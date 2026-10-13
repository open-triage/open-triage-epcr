import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { AuthenticatedSession, ClinicianSession, EndClinicianSessionResponse, ReauthenticationResult } from "@open-triage/contracts";
import { ClinicianSessionService } from "./clinician-session.service.js";
import { validateChangePassword, validateCreateClinicianSession, validateReauthenticate } from "./clinician-session.validation.js";

export const SESSION_COOKIE = "open_triage_session";
type RequestLike = {
  headers: { cookie?: string; "user-agent"?: string };
  ip?: string;
  socket?: { remoteAddress?: string };
};
export type SessionCookieResponse = { cookie(name: string, value: string, options: Record<string, unknown>): void; clearCookie(name: string, options: Record<string, unknown>): void };

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

export function requestNetworkSource(request: RequestLike): string | undefined {
  const address = request.ip ?? request.socket?.remoteAddress;
  return address?.startsWith("::ffff:") ? address.slice(7) : address;
}

export function cookieOptions(expiresAt?: string): Record<string, unknown> {
  return { httpOnly: true, secure: true, sameSite: "strict", path: "/api", ...(expiresAt ? { expires: new Date(expiresAt) } : {}) };
}

export function clearSessionCookie(response: Pick<SessionCookieResponse, "clearCookie">): void {
  response.clearCookie(SESSION_COOKIE, cookieOptions());
}

@Controller("sessions")
export class ClinicianSessionController {
  constructor(private readonly sessions: ClinicianSessionService) {}

  @Post()
  async create(@Req() request: RequestLike, @Body() body: unknown, @Res({ passthrough: true }) response: SessionCookieResponse,
    @Headers("user-agent") userAgent?: string): Promise<AuthenticatedSession> {
    const created = await this.sessions.create(validateCreateClinicianSession(body), new Date(), userAgent,
      requestNetworkSource(request));
    response.cookie(SESSION_COOKIE, created.sessionToken, cookieOptions(created.session.expiresAt));
    return created.session;
  }

  @Get("current")
  @Header("Cache-Control", "no-store, private")
  current(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<AuthenticatedSession> {
    return this.sessions.getAuthenticated(sessionToken(request, authorization), new Date(), true);
  }

  @Post("agency/:id")
  @HttpCode(200)
  switchAgency(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AuthenticatedSession> {
    return this.sessions.switchAgency(sessionToken(request, authorization), id);
  }

  @Post("password")
  @HttpCode(200)
  async changePassword(
    @Req() request: RequestLike, @Body() body: unknown,
    @Res({ passthrough: true }) response: SessionCookieResponse,
    @Headers("authorization") authorization?: string
  ): Promise<AuthenticatedSession> {
    const created = await this.sessions.changePassword(sessionToken(request, authorization), validateChangePassword(body),
      new Date(), request.headers["user-agent"], requestNetworkSource(request));
    response.cookie(SESSION_COOKIE, created.sessionToken, cookieOptions(created.session.expiresAt));
    return created.session;
  }

  // The common HTTP reauthentication endpoint is owned by AuthenticationModule,
  // which routes by the session's trusted source. This local helper remains local.
  reauthenticate(
    @Req() request: RequestLike, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken: string | undefined,
    @Headers("authorization") authorization?: string
  ): Promise<ReauthenticationResult> {
    const command = validateReauthenticate(body);
    return this.sessions.reauthenticate(sessionToken(request, authorization), csrfToken, command.currentPassword,
      new Date(), requestNetworkSource(request));
  }

  @Delete("current")
  async end(
    @Req() request: RequestLike, @Headers("x-csrf-token") csrfToken: string | undefined,
    @Res({ passthrough: true }) response: SessionCookieResponse,
    @Headers("authorization") authorization?: string
  ): Promise<EndClinicianSessionResponse> {
    await this.sessions.end(sessionToken(request, authorization), csrfToken);
    clearSessionCookie(response);
    return { ended: true };
  }
}
