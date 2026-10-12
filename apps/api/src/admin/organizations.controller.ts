import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { validateCreateAgency, validateUpdateAgency } from "./organizations.validation.js";
type RequestLike = { headers: { cookie?: string } };

@Controller("super-admin/agencies")
export class OrganizationsController {
  constructor(private readonly agencies: OrganizationsService) {}
  @Get()
  @Header("Cache-Control", "no-store, private")
  list(@Req() request: RequestLike, @Headers("authorization") authorization?: string) {
    return this.agencies.list(sessionToken(request, authorization));
  }
  @Post()
  create(@Req() request: RequestLike, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.agencies.create(sessionToken(request, authorization), validateCreateAgency(body));
  }
  @Put(":id")
  update(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.agencies.update(sessionToken(request, authorization), id, validateUpdateAgency(body));
  }
}
