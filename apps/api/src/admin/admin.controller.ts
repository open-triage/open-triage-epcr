import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import type { AdminContext, CatalogDraft, CatalogValidationResult, PublishedCatalog } from "@open-triage/contracts";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";

type RequestLike = { headers: { cookie?: string } };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly catalogs: CatalogAuthoringService) {}

  @Get("context")
  context(
    @Req() request: RequestLike,
    @Headers("authorization") authorization?: string
  ): Promise<AdminContext> {
    return this.admin.context(sessionToken(request, authorization));
  }

  @Get("catalog-draft")
  catalogDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft | null> {
    return this.catalogs.current(sessionToken(request, authorization));
  }

  @Post("catalog-drafts")
  cloneCatalog(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft> {
    return this.catalogs.cloneActive(sessionToken(request, authorization));
  }

  @Put("catalog-drafts/:id")
  saveCatalog(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft> {
    return this.catalogs.save(sessionToken(request, authorization), id, body);
  }

  @Post("catalog-drafts/:id/validate")
  validateCatalog(@Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogValidationResult> {
    return this.catalogs.validate(sessionToken(request, authorization), id);
  }

  @Post("catalog-drafts/:id/publish")
  publishCatalog(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<PublishedCatalog> {
    return this.catalogs.publish(sessionToken(request, authorization), id, body);
  }
}
