import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AuthenticationPolicyController } from "./authentication-policy.controller.js";
import { AuthenticationPolicyService } from "./authentication-policy.service.js";
import { OidcDraftService } from "./oidc-draft.service.js";
import { OidcDraftController } from "./oidc-draft.controller.js";
@Module({ imports: [SessionsModule], controllers: [AuthenticationPolicyController, OidcDraftController], providers: [AuthenticationPolicyService, OidcDraftService] })
export class AuthenticationModule {}
