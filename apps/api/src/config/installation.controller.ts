import { Controller, Get, Header, Headers, Req, UnauthorizedException } from "@nestjs/common";
import { type PublicInstallationConfiguration } from "@open-triage/contracts";
import { AgencySettingsService } from "../admin/agency-settings.service.js";
import { AgencyDirectoryService } from "../sessions/agency-directory.service.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { sessionToken } from "../sessions/clinician-session.controller.js";

@Controller("installation")
export class InstallationController {
  constructor(private readonly agencySettings: AgencySettingsService,
    private readonly agencies: AgencyDirectoryService, private readonly sessions: ClinicianSessionService) {}

  @Get()
  @Header("Cache-Control", "no-store, private")
  async get(@Req() request: { headers: { cookie?: string } },
    @Headers("authorization") authorization?: string): Promise<PublicInstallationConfiguration> {
    const agency = await this.agencies.forLogin();
    let organizationId = agency?.id;
    try { organizationId = (await this.sessions.getAuthenticated(sessionToken(request, authorization), new Date(), true)).organization?.id; }
    catch (error) { if (!(error instanceof UnauthorizedException)) throw error; }
    return this.agencySettings.publicConfiguration(organizationId);
  }
}
