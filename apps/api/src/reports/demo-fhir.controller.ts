import { Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, type OnApplicationBootstrap } from "@nestjs/common";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { prewarmDemoFhir } from "./demo-fhir-worker.js";
import { DraftReportService } from "./draft-report.service.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });

@Controller("reports")
export class DemoFhirController implements OnApplicationBootstrap {
  constructor(private readonly reports: DraftReportService) {}

  onApplicationBootstrap() {
    prewarmDemoFhir();
  }

  @Post(":id/demo/fhir-validation")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  validateDemoFhir(@Param("id", uuidV4) id: string, @Query("background") background: string | undefined, @Headers("x-csrf-token") csrf?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.reports.validateSyntheticFhir(bearerToken(authorization, cookie), id, csrf, background === "true");
  }

  @Get(":id/demo/fhir-validation/:jobId")
  @Header("Cache-Control", "no-store, private")
  demoFhirStatus(@Param("id", uuidV4) id: string, @Param("jobId", uuidV4) jobId: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.reports.syntheticFhirStatus(bearerToken(authorization, cookie), id, jobId);
  }
}
