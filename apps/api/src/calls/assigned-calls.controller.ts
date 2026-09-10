import { Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import type { AssignedCallsResponse, OpenAssignmentResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Controller("calls")
export class AssignedCallsController {
  constructor(private readonly calls: AssignedCallsService) {}

  @Get("assigned")
  list(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<AssignedCallsResponse> {
    return this.calls.list(bearerToken(authorization, cookie));
  }

  @Post(":assignmentId/open")
  @HttpCode(200)
  open(
    @Param("assignmentId") assignmentId: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<OpenAssignmentResponse> {
    return this.calls.open(bearerToken(authorization, cookie), assignmentId);
  }
}
