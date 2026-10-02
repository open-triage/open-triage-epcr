import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { AdminCapabilityCatalog, AdminContext, AdminRole, AdminRoleHistory, AdminRoleList, AdminRoleSummaryList, AdminSessionList, AdminUserPage, CatalogDefinitionView, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, OwnershipTransferState, PortableCustomRolePackage, PortableRoleImportPreview, PortableRoleImportResult, ProvisionedAdminUser, PublishedCatalog, PublishedStationaryForm, PublishedValidationVersion, PurgedAdminOfflineRecovery, ResetAdminCredentialResult, RevokedAdminSession, StationaryFormActivation, StationaryFormDraft, UpdatedAdminUser, UpdatedAdminUserRoles, ValidationActivation, ValidationDraft, ValidationDraftResult, ValidationHistoryEvent, ValidationRulePage } from "@open-triage/contracts";
import type { AgencyMediaSettings } from "@open-triage/contracts";
import { clearSessionCookie, sessionToken } from "../sessions/clinician-session.controller.js";
import { CanonicalPackageService } from "./canonical-package.service.js";
import { AdminService } from "./admin.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { RoleAuthoringService } from "./role-authoring.service.js";
import { RolePackageService } from "./role-package.service.js";
import { UserRoleReadService } from "./user-role-read.service.js";
import { UserProvisioningService } from "./user-provisioning.service.js";
import { validateProvisionAdminUser } from "./user-provisioning.validation.js";
import { UserLifecycleService } from "./user-lifecycle.service.js";
import { validateUpdateAdminUser } from "./user-lifecycle.validation.js";
import { UserRoleAssignmentService } from "./user-role-assignment.service.js";
import { validateReplaceAdminUserRoles } from "./user-role-assignment.validation.js";
import { SessionAdministrationService } from "./session-administration.service.js";
import { validateResetAdminCredential, validateRevokeAdminSession } from "./session-administration.validation.js";
import { OwnershipTransferService } from "./ownership-transfer.service.js";
import { ValidationAuthoringService } from "./validation-authoring.service.js";
import { validateCancelOwnershipTransfer, validateInitiateOwnershipTransfer } from "./ownership-transfer.validation.js";
import { AgencySettingsService } from "./agency-settings.service.js";
import { validateUpdateAgencyMediaSettings } from "./agency-settings.validation.js";

type RequestLike = { headers: { cookie?: string } };
type ResponseLike = { clearCookie(name: string, options: Record<string, unknown>): void };

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly catalogs: CatalogAuthoringService,
    private readonly forms: FormAuthoringService, private readonly directory: UserRoleReadService,
    private readonly provisioning: UserProvisioningService,
    private readonly roleAuthoring: RoleAuthoringService, private readonly lifecycle: UserLifecycleService,
    private readonly roleAssignments: UserRoleAssignmentService,
    private readonly sessionAdministration: SessionAdministrationService,
    private readonly rolePackages: RolePackageService,
    private readonly ownershipTransfer: OwnershipTransferService,
    private readonly validations: ValidationAuthoringService,
    private readonly agencySettings: AgencySettingsService,
    private readonly canonical: CanonicalPackageService) {}

  @Get("canonical/:kind")
  canonicalFiles(@Param("kind") kind: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string) {
    return this.canonical.list(sessionToken(request, authorization), kind);
  }

  @Post("canonical/:kind/synchronize")
  synchronizeCanonical(@Param("kind") kind: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string) {
    return this.canonical.synchronize(sessionToken(request, authorization), kind);
  }

  @Post("canonical/:kind/import")
  importCanonical(@Param("kind") kind: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string) {
    return this.canonical.import(sessionToken(request, authorization), kind, body);
  }

  @Post("canonical/:kind/:id/export")
  async exportCanonical(@Param("kind") kind: string, @Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string) {
    const token = sessionToken(request, authorization);
    const content = await this.canonical.export(token, kind, id);
    await this.canonical.persist(token, content.kind, id);
    return content;
  }

  @Get("context")
  context(
    @Req() request: RequestLike,
    @Headers("authorization") authorization?: string
  ): Promise<AdminContext> {
    return this.admin.context(sessionToken(request, authorization));
  }

  @Get("agency-settings")
  settings(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AgencyMediaSettings> {
    return this.agencySettings.get(sessionToken(request, authorization));
  }

  @Put("agency-settings")
  updateSettings(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AgencyMediaSettings> {
    return this.agencySettings.update(sessionToken(request, authorization), validateUpdateAgencyMediaSettings(body));
  }

  @Get("users")
  users(@Query() query: Record<string, unknown>, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<AdminUserPage> {
    return this.directory.users(sessionToken(request, authorization), query);
  }

  @Get("ownership-transfer")
  ownershipTransferState(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<OwnershipTransferState> {
    return this.ownershipTransfer.state(sessionToken(request, authorization));
  }

  @Post("ownership-transfer")
  initiateOwnershipTransfer(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<OwnershipTransferState> {
    return this.ownershipTransfer.initiate(sessionToken(request, authorization), validateInitiateOwnershipTransfer(body));
  }

  @Post("ownership-transfer/accept")
  acceptOwnershipTransfer(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<OwnershipTransferState> {
    return this.ownershipTransfer.accept(sessionToken(request, authorization));
  }

  @Delete("ownership-transfer")
  cancelOwnershipTransfer(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<OwnershipTransferState> {
    return this.ownershipTransfer.cancel(sessionToken(request, authorization), validateCancelOwnershipTransfer(body));
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

  @Post("users/:id/offline-recovery/purge")
  purgeUserOfflineRecovery(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<PurgedAdminOfflineRecovery> {
    return this.sessionAdministration.purgeOfflineRecovery(sessionToken(request, authorization), id, body);
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

  @Get("role-packages/export")
  exportRolePackage(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<PortableCustomRolePackage> {
    return this.rolePackages.export(sessionToken(request, authorization));
  }

  @Post("role-packages/preview")
  previewRolePackage(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<PortableRoleImportPreview> {
    return this.rolePackages.preview(sessionToken(request, authorization), body);
  }

  @Post("role-packages/import")
  importRolePackage(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<PortableRoleImportResult> {
    return this.rolePackages.import(sessionToken(request, authorization), body);
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

  @Get("catalog-versions")
  catalogVersions(@Req() request: RequestLike, @Headers("authorization") authorization?: string) {
    return this.catalogs.versions(sessionToken(request, authorization));
  }

  @Get("catalog-versions/:id")
  catalogVersion(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<CatalogDefinitionView> {
    return this.catalogs.inspectVersion(sessionToken(request, authorization), id);
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

  @Delete("catalog-drafts/:id")
  deleteCatalog(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<void> {
    return this.catalogs.delete(sessionToken(request, authorization), id, body);
  }

  @Post("catalog-drafts/:id/validate")
  validateCatalog(@Param("id", new ParseUUIDPipe()) id: string,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<CatalogValidationResult> {
    return this.catalogs.validate(sessionToken(request, authorization), id);
  }

  @Post("catalog-drafts/:id/publish")
  async publishCatalog(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<PublishedCatalog> {
    const token = sessionToken(request, authorization);
    const published = await this.catalogs.publish(token, id, body);
    await this.canonical.persist(token, "catalog", published.id);
    return published;
  }

  @Get("form-draft")
  formDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<StationaryFormDraft | null> {
    return this.forms.current(sessionToken(request, authorization));
  }

  @Get("form-versions")
  formVersions(@Req() request: RequestLike, @Headers("authorization") authorization?: string) {
    return this.forms.versions(sessionToken(request, authorization));
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
  async publishForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<PublishedStationaryForm> {
    const token = sessionToken(request, authorization);
    const published = await this.forms.publish(token, id, body);
    await this.canonical.persist(token, "form", published.id);
    return published;
  }

  @Post("form-versions/:id/activate")
  activateForm(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<StationaryFormActivation> {
    return this.forms.activate(sessionToken(request, authorization), id, body);
  }

  @Get("validation-draft")
  validationDraft(@Req() request: RequestLike, @Headers("authorization") authorization?: string): Promise<ValidationDraft | null> {
    return this.validations.current(sessionToken(request, authorization));
  }

  @Get("validation-versions")
  validationVersions(@Req() request: RequestLike, @Headers("authorization") authorization?: string) {
    return this.validations.versions(sessionToken(request, authorization));
  }

  @Get("validation-rules")
  validationRules(@Query() query: Record<string, unknown>, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationRulePage> {
    return this.validations.library(sessionToken(request, authorization), query);
  }

  @Post("validation-drafts")
  createValidation(@Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.create(sessionToken(request, authorization), body);
  }

  @Post("validation-versions/:id/clone")
  cloneValidation(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.clone(sessionToken(request, authorization), id, body);
  }

  @Get("validation-history")
  validationHistory(@Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationHistoryEvent[]> {
    return this.validations.history(sessionToken(request, authorization));
  }

  @Put("validation-drafts/:id")
  saveValidation(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.save(sessionToken(request, authorization), id, body);
  }

  @Delete("validation-drafts/:id")
  deleteValidation(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<void> {
    return this.validations.delete(sessionToken(request, authorization), id, body);
  }

  @Post("validation-drafts/:id/rules")
  createValidationRule(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.createRule(sessionToken(request, authorization), id, body);
  }

  @Post("validation-drafts/:id/rules/:ruleId/disable")
  disableValidationRule(@Param("id", new ParseUUIDPipe()) id: string,
    @Param("ruleId", new ParseUUIDPipe()) ruleId: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.setRuleEnabled(sessionToken(request, authorization), id, ruleId, false, body);
  }

  @Post("validation-drafts/:id/rules/:ruleId/restore")
  restoreValidationRule(@Param("id", new ParseUUIDPipe()) id: string,
    @Param("ruleId", new ParseUUIDPipe()) ruleId: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraft> {
    return this.validations.setRuleEnabled(sessionToken(request, authorization), id, ruleId, true, body);
  }

  @Post("validation-drafts/:id/validate")
  validateValidation(@Param("id", new ParseUUIDPipe()) id: string, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationDraftResult> {
    return this.validations.validate(sessionToken(request, authorization), id);
  }

  @Post("validation-drafts/:id/publish")
  async publishValidation(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<PublishedValidationVersion> {
    const token = sessionToken(request, authorization);
    const published = await this.validations.publish(token, id, body);
    await this.canonical.persist(token, "validation", published.id);
    return published;
  }

  @Post("validation-versions/:id/activate")
  activateValidation(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown, @Req() request: RequestLike,
    @Headers("authorization") authorization?: string): Promise<ValidationActivation> {
    return this.validations.activate(sessionToken(request, authorization), id, body);
  }
}
