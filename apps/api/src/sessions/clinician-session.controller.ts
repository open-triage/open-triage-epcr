import { Body, Controller, Delete, Get, Headers, Post, UnauthorizedException } from "@nestjs/common";
import type { ClinicianSession, EndClinicianSessionResponse } from "@open-triage/contracts";
import { ClinicianSessionService } from "./clinician-session.service.js";
import { validateCreateClinicianSession } from "./clinician-session.validation.js";

export function bearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new UnauthorizedException("A clinician session is required");
  return match[1];
}

@Controller("sessions")
export class ClinicianSessionController {
  constructor(private readonly sessions: ClinicianSessionService) {}

  @Post()
  create(@Body() body: unknown): Promise<ClinicianSession> {
    return this.sessions.create(validateCreateClinicianSession(body));
  }

  @Get("current")
  current(@Headers("authorization") authorization?: string): ClinicianSession {
    return this.sessions.get(bearerToken(authorization));
  }

  @Delete("current")
  end(@Headers("authorization") authorization?: string): EndClinicianSessionResponse {
    this.sessions.end(bearerToken(authorization));
    return { ended: true };
  }
}
