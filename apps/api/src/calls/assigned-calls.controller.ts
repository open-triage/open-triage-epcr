import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post } from "@nestjs/common";
import type {
  AssignedCallsResponse,
  GenerateSyntheticCallResponse,
  OpenAssignmentResponse,
  SyntheticCallGenerationContext,
} from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Controller("calls")
export class AssignedCallsController {
  constructor(private readonly calls: AssignedCallsService) {}

  @Get("assigned")
  list(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<AssignedCallsResponse> {
    return this.calls.list(bearerToken(authorization, cookie));
  }

  @Get("synthetic-generation")
  syntheticGenerationContext(
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<SyntheticCallGenerationContext> {
    return this.calls.syntheticGenerationContext(bearerToken(authorization, cookie));
  }

  @Post("synthetic-generation")
  @HttpCode(200)
  generateSynthetic(
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<GenerateSyntheticCallResponse> {
    if (typeof body !== "object" || body === null || !("unitId" in body) ||
        typeof body.unitId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.unitId)) {
      throw new BadRequestException("unitId must be a UUID");
    }
    return this.calls.generateSynthetic(bearerToken(authorization, cookie), csrfToken, body.unitId);
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
