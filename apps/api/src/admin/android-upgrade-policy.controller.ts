import { Body, Controller, Get, Header, Headers, HttpCode, Post, Put, Query, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { installationCredential } from "../sessions/installation-session.js";
import { AndroidUpgradePolicyService } from "./android-upgrade-policy.service.js";
type RequestLike = { headers: { cookie?: string } };
@Controller()
export class AndroidUpgradePolicyController {
  constructor(private readonly policy: AndroidUpgradePolicyService) {}
  @Get("super-admin/android/upgrade-policy")
  @Header("Cache-Control", "no-store, private")
  read(@Req() req: RequestLike, @Headers("authorization") auth?: string) { return this.policy.read(sessionToken(req, auth)); }
  @Post("super-admin/android/upgrade-policy/preview")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  preview(@Req() req: RequestLike, @Body() body: unknown, @Headers("authorization") auth?: string) { return this.policy.preview(sessionToken(req, auth), body); }
  @Put("super-admin/android/upgrade-policy")
  @Header("Cache-Control", "no-store, private")
  update(@Req() req: RequestLike, @Body() body: unknown, @Headers("authorization") auth?: string) { return this.policy.update(sessionToken(req, auth), body); }
  @Get("android/compatibility")
  @Header("Cache-Control", "no-store, private")
  client(@Req() req: RequestLike, @Query("versionCode") version: unknown, @Headers("authorization") auth?: string) {
    const versionCode = typeof version === "string" && /^[1-9][0-9]{0,9}$/.test(version) ? Number(version) : NaN;
    const credential = installationCredential(req.headers.cookie);
    return this.policy.client(credential ? "" : sessionToken(req, auth), credential, versionCode);
  }
}
