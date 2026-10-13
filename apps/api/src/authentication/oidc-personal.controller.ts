import { Body, Controller, Get, Header, Headers, HttpCode, Post, Req, Res,UnauthorizedException,HttpException } from "@nestjs/common";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { sessionToken,clearSessionCookie, type SessionCookieResponse } from "../sessions/clinician-session.controller.js";
import { validateReauthenticate } from "../sessions/clinician-session.validation.js";
import { OidcPersonalService } from "./oidc-personal.service.js";
export const PERSONAL_COOKIE="open_triage_oidc_personal";
export const personalCookieOptions={httpOnly:true,secure:true,sameSite:"lax",path:"/api/sessions/oidc/callback",maxAge:300000};
type Request={headers:{cookie?:string;"user-agent"?:string};ip?:string;socket?:{remoteAddress?:string}};
@Controller("sessions")
export class OidcPersonalController {
 constructor(private readonly personal:OidcPersonalService,private readonly sessions:ClinicianSessionService){}
 @Get("authentication-options") @Header("Cache-Control","no-store, private")
 options(){return this.personal.options();}
 @Post("oidc/login") @HttpCode(200) @Header("Cache-Control","no-store, private")
 async begin(@Body() body:unknown,@Req() request:Request,@Headers("x-csrf-token") csrf:string|undefined,@Headers("x-personal-authentication") intent:string|undefined,
  @Res({passthrough:true}) response:SessionCookieResponse){
  if(intent!=='1')throw new UnauthorizedException({code:'login.identityUnavailable'});
  let token:string|undefined;try{token=sessionToken(request);}catch{ /* Login can start without an app session. */ }
  try{
   const result=await this.personal.begin(body,token,csrf,request.headers['user-agent']);
   if((body as {purpose?:unknown}).purpose!=='reauthenticate')clearSessionCookie(response);
   response.clearCookie("open_triage_oidc_test",personalCookieOptions);
   response.cookie(PERSONAL_COOKIE,result.correlation,personalCookieOptions);return {authorizationUrl:result.authorizationUrl};
  }catch(error){
   const result=error instanceof HttpException?error.getResponse():null;
   if(result&&typeof result==='object'&&'sessionEnded' in result&&result.sessionEnded===true)clearSessionCookie(response);
   throw error;
  }
 }
 @Post("reauthenticate") @HttpCode(200) @Header("Cache-Control","no-store, private")
 async reauthenticate(@Body() body:unknown,@Req() request:Request,@Headers("x-csrf-token") csrf:string|undefined,
  @Headers("authorization") authorization:string|undefined,@Res({passthrough:true}) response:SessionCookieResponse){
  const token=sessionToken(request,authorization);
  await this.sessions.assertCsrf(token,csrf);
  const session=await this.sessions.getAuthenticated(token,new Date(),true);
  const command=validateReauthenticate(body,(session.nextAuthenticationSource ?? session.authenticationSource)==='oidc');
  if((session.nextAuthenticationSource ?? session.authenticationSource)==='oidc'){
   if(!command.forcePersonalAuthentication)try{
    await this.sessions.requireRecentReauthentication(token);
    return {reauthenticatedUntil:new Date(Date.parse(session.personallyAuthenticatedAt!)+300000).toISOString()};
   }catch{ /* An explicit purpose-bound proof is needed for this session. */ }
   const result=await this.personal.begin({purpose:'reauthenticate'},token,csrf,request.headers['user-agent']);
   response.clearCookie("open_triage_oidc_test",personalCookieOptions);
   response.cookie(PERSONAL_COOKIE,result.correlation,personalCookieOptions);
   return {authorizationUrl:result.authorizationUrl};
  }
  return this.sessions.reauthenticate(token,csrf,command.currentPassword,undefined,request.ip??request.socket?.remoteAddress);
 }
}
