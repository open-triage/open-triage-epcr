import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CsrfGuard } from "./csrf.guard.js";
import { ClinicianSessionController } from "./clinician-session.controller.js";
import { ClinicianSessionService } from "./clinician-session.service.js";

@Module({
  controllers: [ClinicianSessionController],
  providers: [ClinicianSessionService, { provide: APP_GUARD, useClass: CsrfGuard }],
  exports: [ClinicianSessionService]
})
export class SessionsModule {}
