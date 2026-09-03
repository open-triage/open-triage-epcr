import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AssignedCallsController } from "./assigned-calls.controller.js";
import { AssignedCallsService } from "./assigned-calls.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [AssignedCallsController],
  providers: [AssignedCallsService]
})
export class CallsModule {}
