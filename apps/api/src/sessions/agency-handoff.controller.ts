import {Body,Controller,Header,Headers,Post,Req,Res} from '@nestjs/common';
import {AgencyHandoffService} from './agency-handoff.service.js';
import {sessionToken,bearerToken,SESSION_COOKIE,cookieOptions,clearSessionCookie,type SessionCookieResponse} from './clinician-session.controller.js';
export const AGENCY_HANDOFF_COOKIE='open_triage_agency_handoff';
export const agencyHandoffCookieOptions={httpOnly:true,secure:true,sameSite:'strict',path:'/api/sessions/agency-handoff',maxAge:90000};
type Request={headers:{cookie?:string}};
const optionalToken=(request:Request)=>{try{return bearerToken(undefined,request.headers.cookie);}catch{return undefined;}};
@Controller('sessions/agency-handoff')
export class AgencyHandoffController {
 constructor(private readonly handoffs:AgencyHandoffService){}
 @Post('start') @Header('Cache-Control','no-store, private')
 start(@Body()body:unknown,@Req()request:Request,@Headers('authorization')authorization?:string){return this.handoffs.start(sessionToken(request,authorization),body);}
 @Post('challenge') @Header('Cache-Control','no-store, private')
 async challenge(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:SessionCookieResponse){
  const {correlation,...result}=await this.handoffs.challenge(body,optionalToken(request));response.cookie(AGENCY_HANDOFF_COOKIE,correlation,agencyHandoffCookieOptions);return result;
 }
 @Post('issue') @Header('Cache-Control','no-store, private')
 async issue(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:SessionCookieResponse,@Headers('authorization')authorization?:string){
  const result=await this.handoffs.issue(sessionToken(request,authorization),body);clearSessionCookie(response);return result;
 }
 @Post('consume') @Header('Cache-Control','no-store, private')
 async consume(@Body()body:unknown,@Req()request:Request,@Res({passthrough:true})response:SessionCookieResponse){
  const correlation=request.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${AGENCY_HANDOFF_COOKIE}=`))?.slice(AGENCY_HANDOFF_COOKIE.length+1)??'';
  try{const created=await this.handoffs.consume(body,correlation,optionalToken(request));response.cookie(SESSION_COOKIE,created.sessionToken,cookieOptions(created.session.expiresAt));return created.session;}
  finally{response.clearCookie(AGENCY_HANDOFF_COOKIE,agencyHandoffCookieOptions);}
 }
}
