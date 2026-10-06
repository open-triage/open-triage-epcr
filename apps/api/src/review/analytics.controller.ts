import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { AnalyticsCatalogCountsRequest, AnalyticsDefinition, AnalyticsSaveVisualizationCommand } from "@open-triage/contracts";
import { AnalyticsService } from "./analytics.service.js";
import { bearerToken } from "../sessions/clinician-session.controller.js";
@Controller("review/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}
  @Get("saved")
  @Header("Cache-Control", "no-store, private")
  saved(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.saved(bearerToken(authorization, cookie));
  }
  @Get("saved/:id")
  @Header("Cache-Control", "no-store, private")
  openSaved(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.openSaved(bearerToken(authorization, cookie), id);
  }
  @Post("saved")
  @Header("Cache-Control", "no-store, private")
  save(@Body() command: AnalyticsSaveVisualizationCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string) {
    return this.analytics.save(bearerToken(authorization, cookie), undefined, command, csrfToken);
  }
  @Post("saved/:id")
  @Header("Cache-Control", "no-store, private")
  updateSaved(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() command: AnalyticsSaveVisualizationCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string) {
    return this.analytics.save(bearerToken(authorization, cookie), id, command, csrfToken);
  }
  @Get("elements")
  @Header("Cache-Control", "no-store, private")
  elements(@Query("search") search?: string, @Query("page") page?: string, @Query("purpose") purpose?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.elements(bearerToken(authorization, cookie), search, page, purpose);
  }
  @Get("values")
  @Header("Cache-Control", "no-store, private")
  values(@Query("element") element: string, @Query("search") search?: string, @Query("page") page?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.values(bearerToken(authorization, cookie), element, search, page);
  }
  @Post("query")
  @Header("Cache-Control", "no-store, private")
  query(@Body() definition: AnalyticsDefinition, @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.query(bearerToken(authorization, cookie), definition);
  }
  @Post("counts")
  @Header("Cache-Control", "no-store, private")
  counts(@Body() input: AnalyticsCatalogCountsRequest, @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.analytics.counts(bearerToken(authorization, cookie), input);
  }
  @Post("export")
  @Header("Cache-Control", "no-store, private")
  async export(@Body() command: { definition: AnalyticsDefinition; expectedRevision: string; kind: "aggregate" | "records" },
    @Res() response: { setHeader(name: string, value: string): void; send(body: string): unknown },
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    const data = await this.analytics.export(bearerToken(authorization, cookie), command);
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="analytics-${command.kind}.csv"`);
    response.setHeader("Content-Length", String(Buffer.byteLength(data, "utf8")));
    response.setHeader("Cache-Control", "no-store, private"); response.setHeader("Pragma", "no-cache");
    return response.send(data);
  }
}
