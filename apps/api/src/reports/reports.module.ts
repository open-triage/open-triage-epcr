import {EpsImportService} from '../hospital/eps-import.service.js';
import { CosWorkerService } from '../hospital/cos-worker.service.js';
import { EpsController } from '../hospital/eps.controller.js';
import { EpsService } from '../hospital/eps.service.js';
import { Module } from "@nestjs/common";
import { DraftReportController } from "./draft-report.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import { SignReportService } from "./sign-report.service.js";
import { AmendReportService } from "./amend-report.service.js";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SchedulesModule } from "../schedules/schedules.module.js";
import { ProtectedReportKeyService } from "./protected-report-key.service.js";
import { ReviewValidationService } from "./review-validation.service.js";
import { ReportNoteService } from "./report-note.service.js";
import { ReportPhotoService } from "./report-photo.service.js";
import { ReportAudioService } from "./report-audio.service.js";
import { ReportAudioNormalizer } from "./report-audio-normalizer.service.js";

@Module({
  imports: [SessionsModule, SchedulesModule],
  controllers: [DraftReportController, EpsController],
  providers: [CosWorkerService, EpsImportService, EpsService, DraftReportService, SignReportService, AmendReportService, ProtectedReportKeyService,
    ReviewValidationService, ReportNoteService, ReportPhotoService, ReportAudioService, ReportAudioNormalizer]
})
export class ReportsModule {}
