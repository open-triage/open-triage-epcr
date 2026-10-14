import { Body,Controller,Get,Header,Headers,Param,Post,Query,Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { RegionalIdentityService } from "./regional-identity.service.js";
@Controller("admin/authentication/identities")
export class RegionalIdentityController {
 constructor(private readonly identities:RegionalIdentityService){}
 @Get() @Header("Cache-Control","no-store, private")
 list(@Query() query:Record<string,unknown>,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string){return this.identities.list(sessionToken(request,authorization),query);}
 @Post(":id/approve") @Header("Cache-Control","no-store, private")
 approve(@Param("id") id:string,@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string){return this.identities.approve(sessionToken(request,authorization),id,body);}
 @Post(":id/link") @Header("Cache-Control","no-store, private")
 link(@Param("id") id:string,@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string){return this.identities.link(sessionToken(request,authorization),id,body);}
 @Post(":id/deny") @Header("Cache-Control","no-store, private")
 deny(@Param("id") id:string,@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization?:string){return this.identities.deny(sessionToken(request,authorization),id,body);}
}
