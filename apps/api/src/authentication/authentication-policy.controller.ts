import { Body, Controller, Get, Header, Headers, Put, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AuthenticationPolicyService } from "./authentication-policy.service.js";
@Controller("admin/authentication")
export class AuthenticationPolicyController {
  constructor(private readonly policies: AuthenticationPolicyService) {}
  @Get()
  @Header("Cache-Control", "no-store, private")
  get(@Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.policies.get(sessionToken(request, authorization));
  }
  @Put() update(@Body() body: unknown, @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.policies.update(sessionToken(request, authorization), body);
  }
}
