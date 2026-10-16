import {AgencyHandoffService} from "./agency-handoff.service.js";
import {AgencyHandoffController} from "./agency-handoff.controller.js";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CsrfGuard } from "./csrf.guard.js";
import { ClinicianSessionController } from "./clinician-session.controller.js";
import { ClinicianSessionService } from "./clinician-session.service.js";
import { AgencyDirectoryService } from "./agency-directory.service.js";

@Module({
  controllers: [ClinicianSessionController,AgencyHandoffController],
  providers: [AgencyHandoffService,ClinicianSessionService, AgencyDirectoryService, { provide: APP_GUARD, useClass: CsrfGuard }],
  exports: [ClinicianSessionService, AgencyDirectoryService]
})
export class SessionsModule {}
