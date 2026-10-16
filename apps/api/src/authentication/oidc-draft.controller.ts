import { Body, Controller, Get, Header, Headers, Post, Put, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { OidcDraftService } from "./oidc-draft.service.js";
@Controller("admin/authentication/oidc")
export class OidcDraftController {
  constructor(private readonly drafts: OidcDraftService) {}
  @Get() @Header("Cache-Control","no-store, private")
  get(@Req() request: {headers:{cookie?:string}},@Headers("authorization") authorization?:string) { return this.drafts.get(sessionToken(request,authorization)); }
  @Put() @Header("Cache-Control","no-store, private")
  save(@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string) { return this.drafts.save(sessionToken(request,authorization),body); }
  @Post("keys/rotate") @Header("Cache-Control","no-store, private")
  rotateKey(@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string) { return this.drafts.rotateKey(sessionToken(request,authorization),body); }
  @Post("activate") @Header("Cache-Control","no-store, private")
  activate(@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string) { return this.drafts.activate(sessionToken(request,authorization),body); }
  @Post("discovery") @Header("Cache-Control","no-store, private")
  inspect(@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string) { return this.drafts.inspect(sessionToken(request,authorization),body); }
}
