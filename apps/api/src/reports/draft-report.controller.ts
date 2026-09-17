import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { ActiveReportResource, DeleteDraftReportResponse, DispatchConflict, OpenCallsResponse, ProtectedReportKeyEnvelope, ReopenOpenCallResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import type { DraftReportResult, SaveDraftReportResult } from "./draft-report.types.js";
import { SignReportService } from "./sign-report.service.js";
import type { SignedReportResult } from "./sign-report.types.js";
import { ProtectedReportKeyService } from "./protected-report-key.service.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });
type ConditionalResponse = { setHeader(name: string, value: string): unknown; status(code: number): unknown };

@Controller("reports")
export class DraftReportController {
  constructor(
    private readonly reports: DraftReportService,
    private readonly signing: SignReportService,
    private readonly protectedKeys: ProtectedReportKeyService,
  ) {}

  @Post()
  create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<DraftReportResult> {
    return this.reports.create(bearerToken(authorization, cookie), body);
  }

  @Post(":id/protected-key-envelope")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  registerProtectedKey(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ProtectedReportKeyEnvelope> {
    return this.protectedKeys.register(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Get("open")
  listOpen(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<OpenCallsResponse> {
    return this.reports.listOpen(bearerToken(authorization, cookie));
  }

  @Post(":id/draft-changes")
  save(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<SaveDraftReportResult> {
    return this.reports.save(bearerToken(authorization, cookie), id, body, csrfToken);
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

  @Delete(":id")
  deleteDraft(
    @Param("id", uuidV4) id: string,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<DeleteDraftReportResponse> {
    return this.reports.deleteSyntheticDraft(bearerToken(authorization, cookie), id, csrfToken);
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

  @Get(":id")
  get(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<Record<string, unknown>> {
    return this.reports.get(bearerToken(authorization, cookie), id);
  }
}
