import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { FormsModule } from "./forms/forms.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";

@Module({
  imports: [DatabaseModule, FormsModule, ReportsModule, SessionsModule],
  controllers: [HealthController]
})
export class AppModule {}
