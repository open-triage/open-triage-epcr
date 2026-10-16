import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Put, Req, UnprocessableEntityException } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { SchedulesService } from "./schedules.service.js";
type RequestLike={headers:{cookie?:string}};
@Controller("admin")
export class SchedulesController {
  constructor(private readonly schedules:SchedulesService) {}
  @Get("schedules") @Header("Cache-Control","no-store, private")
  list(@Req() request:RequestLike,@Headers("authorization") authorization?:string) {return this.schedules.list(sessionToken(request,authorization));}
  private requirePreview(body:unknown){if(!body||typeof body!=="object"||typeof (body as {previewToken?:unknown}).previewToken!=="string")throw new UnprocessableEntityException("Preview the effective time before saving");}
  @Post("schedules/preview") @Header("Cache-Control","no-store, private")
  previewCreate(@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string){return this.schedules.previewSave(sessionToken(request,authorization),null,body);}
  @Post("schedules/:id/preview") @Header("Cache-Control","no-store, private")
  previewUpdate(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string){return this.schedules.previewSave(sessionToken(request,authorization),id,body);}
  @Post("units/:id/schedule/preview") @Header("Cache-Control","no-store, private")
  previewSelection(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string){return this.schedules.previewSelection(sessionToken(request,authorization),id,body);}
  @Post("schedules")
  create(@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {this.requirePreview(body);return this.schedules.save(sessionToken(request,authorization),null,body);}
  @Put("schedules/:id")
  update(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {this.requirePreview(body);return this.schedules.save(sessionToken(request,authorization),id,body);}
  @Get("units/:id/schedule") @Header("Cache-Control","no-store, private")
  preview(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Headers("authorization") authorization?:string) {return this.schedules.getPreview(sessionToken(request,authorization),id);}
  @Put("units/:id/schedule")
  select(@Param("id",new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers("authorization") authorization?:string) {this.requirePreview(body);return this.schedules.select(sessionToken(request,authorization),id,body);}
}
