import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AuthenticationPolicyController } from "./authentication-policy.controller.js";
import { AuthenticationPolicyService } from "./authentication-policy.service.js";
@Module({ imports: [SessionsModule], controllers: [AuthenticationPolicyController], providers: [AuthenticationPolicyService] })
export class AuthenticationModule {}
