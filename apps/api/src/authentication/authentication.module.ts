import { UserRoleAssignmentService } from "../admin/user-role-assignment.service.js";
import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AuthenticationPolicyController } from "./authentication-policy.controller.js";
import { AuthenticationPolicyService } from "./authentication-policy.service.js";
import { OidcDraftService } from "./oidc-draft.service.js";
import { OidcDraftController } from "./oidc-draft.controller.js";
import { OidcTestController } from "./oidc-test.controller.js";
import { OidcTestService } from "./oidc-test.service.js";
import { RegionalIdentityService } from "./regional-identity.service.js";
import { RegionalIdentityController } from "./regional-identity.controller.js";
@Module({ imports: [SessionsModule], controllers: [AuthenticationPolicyController, OidcDraftController, OidcTestController, RegionalIdentityController], providers: [UserRoleAssignmentService, AuthenticationPolicyService, OidcDraftService, OidcTestService, RegionalIdentityService] })
export class AuthenticationModule {}
