import { Controller, Get } from "@nestjs/common";
import { type PublicInstallationConfiguration } from "@open-triage/contracts";
import { selectedInstallationSettings } from "./installation-settings.js";

@Controller("installation")
export class InstallationController {
  @Get()
  get(): PublicInstallationConfiguration {
    return { settings: selectedInstallationSettings() };
  }
}
