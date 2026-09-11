import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { FormsModule } from "../forms/forms.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { RoleAuthoringService } from "./role-authoring.service.js";
import { UserRoleReadService } from "./user-role-read.service.js";
import { UserProvisioningService } from "./user-provisioning.service.js";
import { UserLifecycleService } from "./user-lifecycle.service.js";

@Module({
  imports: [SessionsModule, FormsModule],
  controllers: [AdminController],
  providers: [AdminService, CatalogAuthoringService, FormAuthoringService, RoleAuthoringService,
    UserRoleReadService, UserProvisioningService, UserLifecycleService]
})
export class AdminModule {}
