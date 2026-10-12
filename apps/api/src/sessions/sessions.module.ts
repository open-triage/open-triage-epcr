import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CsrfGuard } from "./csrf.guard.js";
import { ClinicianSessionController } from "./clinician-session.controller.js";
import { ClinicianSessionService } from "./clinician-session.service.js";
import { AgencyDirectoryService } from "./agency-directory.service.js";

@Module({
  controllers: [ClinicianSessionController],
  providers: [ClinicianSessionService, AgencyDirectoryService, { provide: APP_GUARD, useClass: CsrfGuard }],
  exports: [ClinicianSessionService, AgencyDirectoryService]
})
export class SessionsModule {}
