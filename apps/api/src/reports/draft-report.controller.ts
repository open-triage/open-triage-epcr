import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { DraftReportService } from "./draft-report.service.js";
import type { DraftReportResult } from "./draft-report.types.js";
import { SignReportService } from "./sign-report.service.js";
import type { SignedReportResult } from "./sign-report.types.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });

@Controller("reports")
export class DraftReportController {
  constructor(
    private readonly reports: DraftReportService,
    private readonly signing: SignReportService
  ) {}

  @Post()
  create(@Body() body: unknown): Promise<DraftReportResult> {
    return this.reports.create(body);
  }

  @Post(":id/draft-changes")
  save(@Param("id", uuidV4) id: string, @Body() body: unknown): Promise<DraftReportResult> {
    return this.reports.save(id, body);
  }

  @Post(":id/sign")
  sign(@Param("id", uuidV4) id: string, @Body() body: unknown): Promise<SignedReportResult> {
    return this.signing.sign(id, body);
  }

  @Get(":id")
  get(@Param("id", uuidV4) id: string): Promise<Record<string, unknown>> {
    return this.reports.get(id);
  }
}
