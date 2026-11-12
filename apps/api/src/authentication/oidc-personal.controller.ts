import { Body, Controller, Get, Query, Header, Headers, HttpCode, Post, Req, Res,UnauthorizedException,HttpException } from "@nestjs/common";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { sessionToken,SESSION_COOKIE,cookieOptions,clearSessionCookie, type SessionCookieResponse } from "../sessions/clinician-session.controller.js";
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
 @Post("oidc/native/login") @HttpCode(200) @Header("Cache-Control","no-store, private")
 async nativeBegin(@Body() body:unknown,@Req() request:Request,@Headers("x-csrf-token") csrf:string|undefined,@Headers("x-personal-authentication") intent:string|undefined,
  @Res({passthrough:true}) response:SessionCookieResponse){
  if(intent!=='1')throw new UnauthorizedException({code:'login.identityUnavailable'});
  let token:string|undefined;try{token=sessionToken(request);}catch{ /* Initial login. */ }
  try{
   const native=body as {purpose?:unknown;returnScheme?:unknown};
   if(!native||typeof native!=='object'||Array.isArray(native)||Object.keys(native).some(key=>!['purpose','returnScheme'].includes(key))||typeof native.returnScheme!=='string')throw new UnauthorizedException({code:'login.identityUnavailable'});
   const result=await this.personal.begin({purpose:native.purpose},token,csrf,request.headers['user-agent'],true,native.returnScheme);
   clearSessionCookie(response);
   return {authorizationUrl:result.authorizationUrl,nativeSecret:result.nativeSecret};
  }catch(error){
   const result=error instanceof HttpException?error.getResponse():null;
   if(result&&typeof result==='object'&&'sessionEnded' in result&&result.sessionEnded===true)clearSessionCookie(response);
   throw error;
  }
 }
 @Get("oidc/native/start") @Header("Cache-Control","no-store, private") @Header("Referrer-Policy","no-referrer")
 async nativeStart(@Query('ticket') ticket:string,@Res() response:SessionCookieResponse & {redirect(code:number,url:string):void}){
  const result=await this.personal.nativeStart(ticket);
  response.clearCookie('open_triage_oidc_test',personalCookieOptions);
  response.cookie(PERSONAL_COOKIE,result.correlation,personalCookieOptions);
  response.redirect(303,result.authorizationUrl);
 }
 @Post("oidc/native/finish") @HttpCode(200) @Header("Cache-Control","no-store, private")
 async nativeFinish(@Body() body:unknown,@Req() request:Request,@Headers("x-personal-authentication") intent:string|undefined,@Res({passthrough:true}) response:SessionCookieResponse){
  if(intent!=='1')throw new UnauthorizedException({code:'login.identityUnavailable'});
  let token:string|undefined;try{token=sessionToken(request);}catch{ /* First delivery has no issued session yet. */ }
  const result=await this.personal.nativeFinish(body,token);
  if(result.created)response.cookie(SESSION_COOKIE,result.created.sessionToken,cookieOptions(result.created.session.expiresAt));
  return {outcome:result.outcome};
 }
 @Post("reauthenticate") @HttpCode(200) @Header("Cache-Control","no-store, private")
 async reauthenticate(@Body() body:unknown,@Req() request:Request,@Headers("x-csrf-token") csrf:string|undefined,
  @Headers("authorization") authorization:string|undefined,@Res({passthrough:true}) response:SessionCookieResponse){
  const token=sessionToken(request,authorization);
  await this.sessions.assertCsrf(token,csrf);
  const session=await this.sessions.getAuthenticated(token,new Date(),true);
  const command=validateReauthenticate(body,(session.nextAuthenticationSource ?? session.authenticationSource)==='oidc');
  if((session.nextAuthenticationSource ?? session.authenticationSource)==='oidc'){
   // Compatibility requests reuse current login authority without inventing
   // personal-proof freshness or extending the persisted session expiry.
   if(!command.forcePersonalAuthentication)return {reauthenticatedUntil:session.expiresAt};
   const result=await this.personal.begin({purpose:'reauthenticate'},token,csrf,request.headers['user-agent']);
   response.clearCookie("open_triage_oidc_test",personalCookieOptions);
   response.cookie(PERSONAL_COOKIE,result.correlation,personalCookieOptions);
   return {authorizationUrl:result.authorizationUrl};
  }
  return this.sessions.reauthenticate(token,csrf,command.currentPassword,undefined,request.ip??request.socket?.remoteAddress);
 }
}
