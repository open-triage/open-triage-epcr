import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { AdminCapabilityCatalog, AdminContext, AdminRole, AdminRoleHistory, AdminRoleList, AdminRoleSummaryList, AdminSessionList, AdminUserPage, CatalogDefinitionView, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, ProvisionedAdminUser, PublishedCatalog, PublishedStationaryForm, ResetAdminCredentialResult, RevokedAdminSession, StationaryFormActivation, StationaryFormDraft, UpdatedAdminUser, UpdatedAdminUserRoles } from "@open-triage/contracts";
import { clearSessionCookie, sessionToken } from "../sessions/clinician-session.controller.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { RoleAuthoringService } from "./role-authoring.service.js";
import { UserRoleReadService } from "./user-role-read.service.js";
import { UserProvisioningService } from "./user-provisioning.service.js";
import { validateProvisionAdminUser } from "./user-provisioning.validation.js";
import { UserLifecycleService } from "./user-lifecycle.service.js";
import { validateUpdateAdminUser } from "./user-lifecycle.validation.js";
import { UserRoleAssignmentService } from "./user-role-assignment.service.js";
import { validateReplaceAdminUserRoles } from "./user-role-assignment.validation.js";
import { SessionAdministrationService } from "./session-administration.service.js";
import { validateResetAdminCredential, validateRevokeAdminSession } from "./session-administration.validation.js";

type RequestLike = { headers: { cookie?: string } };
type ResponseLike = { clearCookie(name: string, options: Record<string, unknown>): void };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly catalogs: CatalogAuthoringService,
    private readonly forms: FormAuthoringService, private readonly directory: UserRoleReadService,
    private readonly provisioning: UserProvisioningService,
    private readonly roleAuthoring: RoleAuthoringService, private readonly lifecycle: UserLifecycleService,
    private readonly roleAssignments: UserRoleAssignmentService,
    private readonly sessionAdministration: SessionAdministrationService) {}

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

  @Put("users/:id/roles")
  replaceUserRoles(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<UpdatedAdminUserRoles> {
    return this.roleAssignments.replace(sessionToken(request, authorization), id, validateReplaceAdminUserRoles(body));
  }

  @Get("users/:id/sessions")
  userSessions(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminSessionList> {
    return this.sessionAdministration.list(sessionToken(request, authorization), id);
  }

  @Delete("users/:userId/sessions/:sessionId")
  async revokeUserSession(@Param("userId", new ParseUUIDPipe()) userId: string,
    @Param("sessionId", new ParseUUIDPipe()) sessionId: string, @Body() body: unknown,
    @Req() request: RequestLike, @Res({ passthrough: true }) response: ResponseLike,
    @Headers("authorization") authorization?: string): Promise<RevokedAdminSession> {
    const revoked = await this.sessionAdministration.revoke(sessionToken(request, authorization), userId, sessionId,
      validateRevokeAdminSession(body));
    if (revoked.currentSessionRevoked) clearSessionCookie(response);
    return revoked;
  }

  @Post("users/:id/credentials/reset")
  resetUserCredential(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<ResetAdminCredentialResult> {
    return this.sessionAdministration.resetCredential(sessionToken(request, authorization), id,
      validateResetAdminCredential(body));
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
