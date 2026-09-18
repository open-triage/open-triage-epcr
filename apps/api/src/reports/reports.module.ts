import { Module } from "@nestjs/common";
import { DraftReportController } from "./draft-report.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import { SignReportService } from "./sign-report.service.js";
import { AmendReportService } from "./amend-report.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ProtectedReportKeyService } from "./protected-report-key.service.js";
import { ReviewValidationService } from "./review-validation.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [DraftReportController],
  providers: [DraftReportService, SignReportService, AmendReportService, ProtectedReportKeyService,
    ReviewValidationService]
})
export class ReportsModule {}
