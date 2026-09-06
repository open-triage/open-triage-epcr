import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { ActiveReportResource, DispatchConflict, OpenCallsResponse, ReopenOpenCallResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import type { DraftReportResult, SaveDraftReportResult } from "./draft-report.types.js";
import { SignReportService } from "./sign-report.service.js";
import type { SignedReportResult } from "./sign-report.types.js";
import { AmendReportService } from "./amend-report.service.js";
import type { AmendedReportResult } from "./amend-report.types.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });
type ConditionalResponse = { setHeader(name: string, value: string): unknown; status(code: number): unknown };

@Controller("reports")
export class DraftReportController {
  constructor(
    private readonly reports: DraftReportService,
    private readonly signing: SignReportService,
    private readonly amendments: AmendReportService
  ) {}

  @Post()
  create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<DraftReportResult> {
    return this.reports.create(bearerToken(authorization, cookie), body);
  }

  @Get("open")
  listOpen(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<OpenCallsResponse> {
    return this.reports.listOpen(bearerToken(authorization, cookie));
  }

  @Post(":id/draft-changes")
  save(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<SaveDraftReportResult> {
    return this.reports.save(bearerToken(authorization, cookie), id, body);
  }

  @Post(":id/reopen")
  @HttpCode(200)
  reopen(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<ReopenOpenCallResponse> {
    return this.reports.reopen(bearerToken(authorization, cookie), id);
  }

  @Get(":id/active")
  async active(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: ConditionalResponse,
    @Headers("cookie") cookie?: string,
  ): Promise<ActiveReportResource | undefined> {
    const result = await this.reports.active(bearerToken(authorization, cookie), id, ifNoneMatch);
    response.setHeader("ETag", result.etag);
    if (!result.resource) {
      response.status(304);
      return undefined;
    }
    return result.resource;
  }

  @Post(":id/dispatch-conflicts/:conflictId")
  resolveDispatchConflict(
    @Param("id", uuidV4) id: string,
    @Param("conflictId", uuidV4) conflictId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<DispatchConflict> {
    return this.reports.resolveDispatchConflict(bearerToken(authorization, cookie), id, conflictId, body);
  }

  @Post(":id/sign")
  sign(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<SignedReportResult> {
    return this.signing.sign(bearerToken(authorization, cookie), id, body);
  }

  @Post(":id/amendments")
  amend(@Param("id", uuidV4) id: string, @Body() body: unknown): Promise<AmendedReportResult> {
    return this.amendments.amend(id, body);
  }

  @Get(":id")
  get(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<Record<string, unknown>> {
    return this.reports.get(bearerToken(authorization, cookie), id);
  }
}
