import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { SchedulesController } from "./schedules.controller.js";
import { SchedulesService } from "./schedules.service.js";
@Module({ imports:[SessionsModule],controllers:[SchedulesController],providers:[SchedulesService],exports:[SchedulesService] })
export class SchedulesModule {}
