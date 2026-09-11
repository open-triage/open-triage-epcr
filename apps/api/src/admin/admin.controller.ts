import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import type { AdminContext, AdminRoleList, AdminRoleSummaryList, AdminUserPage, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, PublishedCatalog, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { UserRoleReadService } from "./user-role-read.service.js";

type RequestLike = { headers: { cookie?: string } };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly catalogs: CatalogAuthoringService,
    private readonly forms: FormAuthoringService, private readonly directory: UserRoleReadService) {}

  @Get("context")
  context(
    @Req() request: RequestLike,
    @Headers("authorization") authorization?: string
  ): Promise<AdminContext> {
    return this.admin.context(sessionToken(request, authorization));
  }

  @Get("users")
  users(@Query() query: Record<string, unknown>, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminUserPage> {
    return this.directory.users(sessionToken(request, authorization), query);
  }

  @Get("user-role-options")
  userRoleOptions(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminRoleSummaryList> {
    return this.directory.userRoleOptions(sessionToken(request, authorization));
  }

  @Get("roles")
  roles(@Query() query: Record<string, unknown>, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminRoleList> {
    return this.directory.roles(sessionToken(request, authorization), query);
  }

  @Get("catalog-draft")
  catalogDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft | null> {
    return this.catalogs.current(sessionToken(request, authorization));
  }

  @Post("catalog-drafts")
  cloneCatalog(@Body() body: unknown, @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft> {
    return this.catalogs.cloneActive(sessionToken(request, authorization), body);
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

  @Get("form-draft")
  formDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<StationaryFormDraft | null> {
    return this.forms.current(sessionToken(request, authorization));
  }

  @Post("form-drafts")
  cloneForm(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<StationaryFormDraft> {
    return this.forms.clone(sessionToken(request, authorization), body);
  }

  @Get("form-drafts/:id/catalog-elements")
  formCatalogElements(@Param("id", new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<FormCatalogElementPage> {
    return this.forms.searchCatalog(sessionToken(request, authorization), id, query);
  }

  @Put("form-drafts/:id")
  saveForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<StationaryFormDraft> {
    return this.forms.save(sessionToken(request, authorization), id, body);
  }

  @Post("form-drafts/:id/publish")
  publishForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<PublishedStationaryForm> {
    return this.forms.publish(sessionToken(request, authorization), id, body);
  }

  @Post("form-versions/:id/activate")
  activateForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<StationaryFormActivation> {
    return this.forms.activate(sessionToken(request, authorization), id, body);
  }
}
