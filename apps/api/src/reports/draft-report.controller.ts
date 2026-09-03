import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import type { OpenCallsResponse, ReopenOpenCallResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import type { DraftReportResult } from "./draft-report.types.js";
import { SignReportService } from "./sign-report.service.js";
import type { SignedReportResult } from "./sign-report.types.js";
import { AmendReportService } from "./amend-report.service.js";
import type { AmendedReportResult } from "./amend-report.types.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });

@Controller("reports")
export class DraftReportController {
  constructor(
    private readonly reports: DraftReportService,
    private readonly signing: SignReportService,
    private readonly amendments: AmendReportService
  ) {}

  @Post()
  create(@Body() body: unknown, @Headers("authorization") authorization?: string): Promise<DraftReportResult> {
    return this.reports.create(bearerToken(authorization), body);
  }

  @Get("open")
  listOpen(@Headers("authorization") authorization?: string): Promise<OpenCallsResponse> {
    return this.reports.listOpen(bearerToken(authorization));
  }

  @Post(":id/draft-changes")
  save(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string
  ): Promise<DraftReportResult> {
    return this.reports.save(bearerToken(authorization), id, body);
  }

  @Post(":id/reopen")
  @HttpCode(200)
  reopen(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string
  ): Promise<ReopenOpenCallResponse> {
    return this.reports.reopen(bearerToken(authorization), id);
  }

  @Post(":id/sign")
  sign(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string
  ): Promise<SignedReportResult> {
    return this.signing.sign(bearerToken(authorization), id, body);
  }

  @Post(":id/amendments")
  amend(@Param("id", uuidV4) id: string, @Body() body: unknown): Promise<AmendedReportResult> {
    return this.amendments.amend(id, body);
  }

  @Get(":id")
  get(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string
  ): Promise<Record<string, unknown>> {
    return this.reports.get(bearerToken(authorization), id);
  }
}
