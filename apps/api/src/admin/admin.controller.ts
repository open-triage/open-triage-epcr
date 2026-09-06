import { Controller, Get, Headers, Req } from "@nestjs/common";
import type { AdminContext } from "@open-triage/contracts";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AdminService } from "./admin.service.js";

type RequestLike = { headers: { cookie?: string } };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("context")
  context(
    @Req() request: RequestLike,
    @Headers("authorization") authorization?: string
  ): Promise<AdminContext> {
    return this.admin.context(sessionToken(request, authorization));
  }
}
