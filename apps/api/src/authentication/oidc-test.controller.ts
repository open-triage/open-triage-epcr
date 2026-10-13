import { Body,Controller,Get,Header,Headers,Post,Req,Res } from "@nestjs/common";
import { sessionToken,type SessionCookieResponse } from "../sessions/clinician-session.controller.js";
import { agencyRequest,browserOrigin } from "../sessions/agency-context.js";
import { OidcTestService } from "./oidc-test.service.js";
const cookie="open_triage_oidc_test";
const options={httpOnly:true,secure:true,sameSite:"lax",path:"/api/sessions/oidc/callback",maxAge:300000};
@Controller()
export class OidcTestController {
 constructor(private readonly tests:OidcTestService){}
 @Post("admin/authentication/oidc/test") @Header("Cache-Control","no-store, private")
 async begin(@Body() body:unknown,@Req() request:{headers:{cookie?:string}},@Headers("authorization") authorization:string|undefined,@Res({passthrough:true}) response:SessionCookieResponse){
  const result=await this.tests.begin(sessionToken(request,authorization),body);
  response.cookie(cookie,result.correlation,options);return {authorizationUrl:result.authorizationUrl};
 }
 @Get("sessions/oidc/callback") @Header("Cache-Control","no-store, private") @Header("Referrer-Policy","no-referrer")
 async callback(@Req() request:{headers:{cookie?:string;host?:string;origin?:string};protocol?:string;originalUrl:string},@Res() response:SessionCookieResponse & {redirect(code:number,url:string):void}){
  const value=request.headers.cookie?.split(";").map(part=>part.trim()).find(part=>part.startsWith(`${cookie}=`))?.slice(cookie.length+1) ?? "";
  try{if(browserOrigin({protocol:request.protocol,headers:{host:request.headers.host}})!==agencyRequest.getStore()?.origin)throw new Error("Callback origin mismatch");const destination=await this.tests.callback(new URL(request.originalUrl,agencyRequest.getStore()!.origin),value);response.clearCookie(cookie,options);response.redirect(303,destination);}
  catch(error){response.clearCookie(cookie,options);throw error;}
 }
}
