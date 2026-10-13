import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Post } from "@nestjs/common";
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
  @Header("Cache-Control", "no-store, private")
  list(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<AssignedCallsResponse> {
    return this.calls.list(bearerToken(authorization, cookie));
  }

  @Get("synthetic-generation")
  @Header("Cache-Control", "no-store, private")
  syntheticGenerationContext(
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<SyntheticCallGenerationContext> {
    return this.calls.syntheticGenerationContext(bearerToken(authorization, cookie));
  }

  @Post("synthetic-generation")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
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

  @Delete("new-job-confirmations")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  cancelConfirmation(@Body() body: unknown, @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string"
      || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw new BadRequestException("Invalid confirmation token");
    return this.calls.cancelConfirmation(bearerToken(authorization, cookie), csrfToken, body.token);
  }

  @Post("new-job-confirmations")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  prepareConfirmation(@Body() body: unknown, @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    if (!body || typeof body !== "object" || !("target" in body) || typeof body.target !== "string"
      || !/^(assignment|command):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.target)) {
      throw new BadRequestException("Invalid new job target");
    }
    return this.calls.prepareConfirmation(bearerToken(authorization, cookie), csrfToken, body.target.toLowerCase());
  }

  @Post(":assignmentId/open")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  open(
    @Param("assignmentId") assignmentId: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
    @Headers("x-job-confirmation") confirmationToken?: string
  ): Promise<OpenAssignmentResponse> {
    return this.calls.open(bearerToken(authorization, cookie), assignmentId, confirmationToken);
  }
}
