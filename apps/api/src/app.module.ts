import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { FormsModule } from "./forms/forms.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { SessionsModule } from "./sessions/sessions.module.js";
import { CallsModule } from "./calls/calls.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { InstallationController } from "./config/installation.controller.js";
import { FeedbackModule } from "./feedback/feedback.module.js";
import { ReviewModule } from "./review/review.module.js";

@Module({
  imports: [DatabaseModule, FormsModule, ReportsModule, SessionsModule, CallsModule, AdminModule, FeedbackModule, ReviewModule],
  controllers: [HealthController, InstallationController]
})
export class AppModule {}
