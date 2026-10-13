import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { SchedulesService } from "./schedules.service.js";
type RequestLike={headers:{cookie?:string}};
@Controller("admin")
export class SchedulesController {
  constructor(private readonly schedules:SchedulesService) {}
  @Get("schedules") @Header("Cache-Control","no-store, private")
  list(@Req() request:RequestLike,@Headers("authorization") authorization?:string) {return this.schedules.list(sessionToken(request,authorization));}
  @Post("schedules")
  create(@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {return this.schedules.save(sessionToken(request,authorization),null,body);}
  @Put("schedules/:id")
  update(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {return this.schedules.save(sessionToken(request,authorization),id,body);}
  @Get("units/:id/schedule") @Header("Cache-Control","no-store, private")
  preview(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Headers("authorization") authorization?:string) {return this.schedules.getPreview(sessionToken(request,authorization),id);}
  @Put("units/:id/schedule")
  select(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {return this.schedules.select(sessionToken(request,authorization),id,body);}
}
