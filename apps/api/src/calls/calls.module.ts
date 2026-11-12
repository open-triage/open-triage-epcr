import { AdminModule } from "../admin/admin.module.js";
import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SchedulesModule } from "../schedules/schedules.module.js";
import { AssignedCallsController } from "./assigned-calls.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Module({
  imports: [SessionsModule, SchedulesModule, AdminModule],
  controllers: [AssignedCallsController],
  providers: [AssignedCallsService]
})
export class CallsModule {}
