import { Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import type { AssignedCallsResponse, OpenAssignmentResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Controller("calls")
export class AssignedCallsController {
  constructor(private readonly calls: AssignedCallsService) {}

  @Get("assigned")
  list(@Headers("authorization") authorization?: string): Promise<AssignedCallsResponse> {
    return this.calls.list(bearerToken(authorization));
  }

  @Post(":assignmentId/open")
  @HttpCode(200)
  open(
    @Param("assignmentId") assignmentId: string,
    @Headers("authorization") authorization?: string
  ): Promise<OpenAssignmentResponse> {
    return this.calls.open(bearerToken(authorization), assignmentId);
  }
}
