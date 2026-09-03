import { Module } from "@nestjs/common";
import { ClinicianSessionController } from "./clinician-session.controller.js";
import { ClinicianSessionService } from "./clinician-session.service.js";

@Module({
  controllers: [ClinicianSessionController],
  providers: [ClinicianSessionService],
  exports: [ClinicianSessionService]
})
export class SessionsModule {}
