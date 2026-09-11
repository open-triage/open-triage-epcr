import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import type { AdminCapabilityCatalog, AdminContext, AdminRole, AdminRoleHistory, AdminRoleList, AdminRoleSummaryList, AdminUserPage, CatalogDefinitionView, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, ProvisionedAdminUser, PublishedCatalog, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft, UpdatedAdminUser } from "@open-triage/contracts";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { RoleAuthoringService } from "./role-authoring.service.js";
import { UserRoleReadService } from "./user-role-read.service.js";
import { UserProvisioningService } from "./user-provisioning.service.js";
import { validateProvisionAdminUser } from "./user-provisioning.validation.js";
import { UserLifecycleService } from "./user-lifecycle.service.js";
import { validateUpdateAdminUser } from "./user-lifecycle.validation.js";

type RequestLike = { headers: { cookie?: string } };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly catalogs: CatalogAuthoringService,
    private readonly forms: FormAuthoringService, private readonly directory: UserRoleReadService,
    private readonly provisioning: UserProvisioningService,
    private readonly roleAuthoring: RoleAuthoringService, private readonly lifecycle: UserLifecycleService) {}

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

  @Post("users")
  provisionUser(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ProvisionedAdminUser> {
    return this.provisioning.provision(sessionToken(request, authorization), validateProvisionAdminUser(body));
  }

  @Put("users/:id")
  updateUser(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<UpdatedAdminUser> {
    return this.lifecycle.update(sessionToken(request, authorization), id, validateUpdateAdminUser(body));
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

  @Get("role-capabilities")
  roleCapabilities(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminCapabilityCatalog> {
    return this.roleAuthoring.capabilities(sessionToken(request, authorization));
  }

  @Post("roles")
  createRole(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminRole> {
    return this.roleAuthoring.create(sessionToken(request, authorization), body);
  }

  @Put("roles/:id")
  updateRole(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<AdminRole> {
    return this.roleAuthoring.update(sessionToken(request, authorization), id, body);
  }

  @Post("roles/:id/deactivate")
  deactivateRole(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<AdminRole> {
    return this.roleAuthoring.deactivate(sessionToken(request, authorization), id, body);
  }

  @Post("roles/:id/reactivate")
  reactivateRole(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<AdminRole> {
    return this.roleAuthoring.reactivate(sessionToken(request, authorization), id, body);
  }

  @Get("roles/:id/history")
  roleHistory(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminRoleHistory> {
    return this.roleAuthoring.history(sessionToken(request, authorization), id);
  }

  @Get("catalog-draft")
  catalogDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogDraft | null> {
    return this.catalogs.current(sessionToken(request, authorization));
  }

  @Get("catalog-definition")
  catalogDefinition(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<CatalogDefinitionView | null> {
    return this.catalogs.inspectActive(sessionToken(request, authorization));
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

  @Delete("form-drafts/:id")
  deleteForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<void> {
    return this.forms.delete(sessionToken(request, authorization), id, body);
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
