import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { FormsModule } from "./forms/forms.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { CallsModule } from "./calls/calls.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { InstallationController } from "./config/installation.controller.js";

@Module({
  imports: [DatabaseModule, FormsModule, ReportsModule, SessionsModule, CallsModule, AdminModule],
  controllers: [HealthController, InstallationController]
})
export class AppModule {}
