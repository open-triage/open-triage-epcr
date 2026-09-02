import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { FormsModule } from "./forms/forms.module.js";

@Module({
  imports: [DatabaseModule, FormsModule],
  controllers: [HealthController]
})
export class AppModule {}
