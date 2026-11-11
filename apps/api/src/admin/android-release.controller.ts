import { Controller, Get, Header, Headers, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AndroidReleaseService } from "./android-release.service.js";

@Controller("admin/android")
export class AndroidReleaseController {
  constructor(private readonly releases: AndroidReleaseService) {}
  @Get("release")
  @Header("Cache-Control", "no-store, private")
  read(@Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string) {
    return this.releases.read(sessionToken(request, authorization));
  }
}
