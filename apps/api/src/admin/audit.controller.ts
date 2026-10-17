import { Controller, Get, Header, Headers, Param, Query, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AuditService } from "./audit.service.js";

@Controller("admin/audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  list(@Query() query: Record<string, unknown>, @Req() request: { headers: { cookie?: string } },
    @Headers("authorization") authorization?: string) {
    return this.audit.list(sessionToken(request, authorization), query);
  }

  @Get("users")
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  users(@Query() query: Record<string, unknown>, @Req() request: { headers: { cookie?: string } },
    @Headers("authorization") authorization?: string) {
    return this.audit.users(sessionToken(request, authorization), query);
  }

  @Get("clinical-values/:source/:id")
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  clinicalValues(@Param("source") source: string, @Param("id") id: string,
    @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.audit.clinicalValues(sessionToken(request, authorization), source, id);
  }

  @Get("payload/:source/:id")
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  payload(@Param("source") source: string, @Param("id") id: string,
    @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.audit.payload(sessionToken(request, authorization), source, id);
  }
}
