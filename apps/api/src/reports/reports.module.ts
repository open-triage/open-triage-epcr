import { Module } from "@nestjs/common";
import { DraftReportController } from "./draft-report.controller.js";
import { DraftReportService } from "./draft-report.service.js";

@Module({
  controllers: [DraftReportController],
  providers: [DraftReportService]
})
export class ReportsModule {}
