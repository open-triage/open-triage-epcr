import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { UnitsService } from "./units.service.js";
type RequestLike = { headers: { cookie?: string } };
@Controller("admin/units")
export class UnitsController {
  constructor(private readonly units: UnitsService) {}
  @Get()
  @Header("Cache-Control", "no-store, private")
  list(@Req() request: RequestLike, @Query("cursor") cursor?: string, @Headers("authorization") authorization?: string) {
    return this.units.list(sessionToken(request, authorization), cursor);
  }
  @Post()
  create(@Req() request: RequestLike, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.units.save(sessionToken(request, authorization), null, body);
  }
  @Put(":id")
  update(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike, @Body() body: unknown,
    @Headers("authorization") authorization?: string) {
    return this.units.save(sessionToken(request, authorization), id, body);
  }
}
