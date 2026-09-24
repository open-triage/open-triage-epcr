import { Controller, Get } from "@nestjs/common";
import { type PublicInstallationConfiguration } from "@open-triage/contracts";
import { AgencySettingsService } from "../admin/agency-settings.service.js";

@Controller("installation")
export class InstallationController {
  constructor(private readonly agencySettings: AgencySettingsService) {}

  @Get()
  get(): Promise<PublicInstallationConfiguration> {
    return this.agencySettings.publicConfiguration();
  }
}
