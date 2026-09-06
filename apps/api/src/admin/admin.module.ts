import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [AdminController],
  providers: [AdminService, CatalogAuthoringService]
})
export class AdminModule {}
