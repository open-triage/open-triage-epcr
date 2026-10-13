import { randomBytes } from "node:crypto";
import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res } from "@nestjs/common";
import { sessionToken, type SessionCookieResponse } from "../sessions/clinician-session.controller.js";
import { InstallationEnrollmentService } from "./installation-enrollment.service.js";
export const INSTALLATION_COOKIE="open_triage_installation";
export function installationCredential(cookie?: string): string | undefined {
 const part=cookie?.split(";").map(p=>p.trim()).find(p=>p.startsWith(`${INSTALLATION_COOKIE}=`));
 const value=part?.slice(INSTALLATION_COOKIE.length+1);
 return value && /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;
}
type RequestLike={headers:{cookie?:string}};
@Controller()
export class InstallationEnrollmentController {
 constructor(private readonly enrollment: InstallationEnrollmentService) {}
 @Post("admin/units/:id/enrollment")
 @Header("Cache-Control","no-store, private")
 issue(@Param("id",new ParseUUIDPipe()) id:string,@Req() req:RequestLike,@Headers("authorization") auth?:string) {
 return this.enrollment.issue(sessionToken(req,auth),id);
 }
 @Get("admin/units/:id/installations")
 @Header("Cache-Control","no-store, private")
 inventory(@Param("id",new ParseUUIDPipe()) id:string,@Req() req:RequestLike,@Query("cursor") cursor?:string,@Headers("authorization") auth?:string) {
 return this.enrollment.inventory(sessionToken(req,auth),id,cursor);
 }
 @Post("installations/preview")
 @Header("Cache-Control","no-store, private")
 preview(@Body() body:unknown) {return this.enrollment.preview(body);}
 @Post("installations/enroll")
 @Header("Cache-Control","no-store, private")
 async enroll(@Body() body:unknown,@Req() req:RequestLike,@Res({passthrough:true}) response:SessionCookieResponse) {
 const result=await this.enrollment.consume(body,installationCredential(req.headers.cookie));
 response.cookie(INSTALLATION_COOKIE,result.credential,{httpOnly:true,secure:true,sameSite:"strict",path:"/api",maxAge:365*24*60*60*1000});
 return result.installation;
 }
 @Get("installations/current")
 @Header("Cache-Control","no-store, private")
 async current(@Req() req:RequestLike,@Res({passthrough:true}) response:SessionCookieResponse) {
 await this.enrollment.requireOrigin();
 const credential=installationCredential(req.headers.cookie)??randomBytes(32).toString("base64url");
 if(!installationCredential(req.headers.cookie)) response.cookie(INSTALLATION_COOKIE,credential,{httpOnly:true,secure:true,sameSite:"strict",path:"/api",maxAge:365*24*60*60*1000});
 try {return {enrolled:true,installation:await this.enrollment.current(credential)};}
 catch(error) {if(error instanceof Error && "getStatus" in error && (error as {getStatus:()=>number}).getStatus()===401) return {enrolled:false};throw error;}
 }
}
