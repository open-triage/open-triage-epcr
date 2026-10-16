import { Body, Controller, Get, Header, Headers, Put, Query, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { ProductionWorkflowService } from "./production-workflow.service.js";
import { AuthenticationPolicyService } from "./authentication-policy.service.js";
@Controller("admin/authentication")
export class AuthenticationPolicyController {
  constructor(private readonly policies: AuthenticationPolicyService, private readonly workflow: ProductionWorkflowService) {}
  @Get()
  @Header("Cache-Control", "no-store, private")
  get(@Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.policies.get(sessionToken(request, authorization));
  }
  @Get("workflow")
  @Header("Cache-Control", "no-store, private")
  readiness(@Query("offset") offset: string | undefined, @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.workflow.get(sessionToken(request, authorization), offset === undefined ? 0 : Number(offset));
  }
  @Put("workflow") enable(@Body() body: unknown, @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.workflow.enable(sessionToken(request, authorization), body);
  }
  @Put() update(@Body() body: unknown, @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.policies.update(sessionToken(request, authorization), body);
  }
}
