import { Controller, Get, Headers } from "@nestjs/common";
import type { AssignedCallsResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Controller("calls")
export class AssignedCallsController {
  constructor(private readonly calls: AssignedCallsService) {}

  @Get("assigned")
  list(@Headers("authorization") authorization?: string): Promise<AssignedCallsResponse> {
    return this.calls.list(bearerToken(authorization));
  }
}
