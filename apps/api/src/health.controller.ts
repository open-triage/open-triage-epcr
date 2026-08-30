import { Controller, Get } from "@nestjs/common";
import type { HealthResponse } from "@open-triage/contracts";

@Controller("health")
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: "ok", service: "open-triage-api" };
  }
}
