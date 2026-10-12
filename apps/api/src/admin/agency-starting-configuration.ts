import { UnprocessableEntityException } from "@nestjs/common";
import type { ClinicianSession, CreateAgencyCommand } from "@open-triage/contracts";
import { DataSource, type EntityManager } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { FormPublicationService } from "../forms/form-publication.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { ValidationAuthoringService } from "./validation-authoring.service.js";
import { CanonicalPackageService } from "./canonical-package.service.js";

/** Called only inside owner-authorized agency creation. All writes join its transaction. */
export async function installStartingConfiguration(database: DataSource, manager: EntityManager,
  actor: ClinicianSession, token: string, organization: { id: string; name: string }, command: CreateAgencyCommand) {
  if (!(actor.installationOwner || actor.installationSuperadmin)) throw new UnprocessableEntityException("Only the installation owner or a superadmin can copy starting configurations");
  const formId = command.startingFormVersionId;
  const validationId = command.startingValidationVersionId;
  if (!formId && !validationId) return {};
  if (!formId || !validationId) throw new UnprocessableEntityException("Choose both a starting form and validation rules");
  const [source] = await manager.query<Array<{ form_organization_id: string; validation_organization_id: string }>>(`
    select f.organization_id form_organization_id, vv.organization_id validation_organization_id
    from forms.form_version fv join forms.form f on f.id=fv.form_id
    join validation.version vv on vv.id=$2 and vv.catalog_release_id=fv.catalog_release_id
    where fv.id=$1 and fv.catalog_release_id=$3 and fv.status='published' and vv.status='published'`,
  [formId, validationId, command.catalogReleaseId]);
  if (!source) throw new UnprocessableEntityException("Starting form and validation must be published against the selected catalog");
  const scoped = Object.create(database) as DataSource;
  Object.defineProperties(scoped, {
    manager: { value: manager }, query: { value: manager.query.bind(manager) },
    transaction: { value: async (...args: unknown[]) => (args.at(-1) as (m: EntityManager) => unknown)(manager) },
  });
  // This private facade uses the already authenticated owner without changing the
  // browser session's active agency. It is never accepted from a request payload.
  const services = (id: string) => {
    const session = { ...actor, organization: { id, name: organization.name } };
    const sessions = { get: async () => session, requireCapability: async () => session } as unknown as ClinicianSessionService;
    const catalogs = new CatalogAuthoringService(scoped, sessions);
    const validations = new ValidationAuthoringService(scoped, sessions);
    const forms = new FormAuthoringService(scoped, sessions, new FormPublicationService(scoped), validations);
    return { packages: new CanonicalPackageService(scoped, sessions, catalogs, forms, validations), validations };
  };
  const formPackage = await services(source.form_organization_id).packages.export(token, "form", formId);
  const validationPackage = await services(source.validation_organization_id).packages.export(token, "validation", validationId);
  const target = services(organization.id);
  const form = await target.packages.importPublished(token, "form", formPackage, command.catalogReleaseId);
  const validation = await target.packages.importPublished(token, "validation", validationPackage, command.catalogReleaseId);
  await target.validations.activate(token, validation.id, { formVersionId: form.id,
    catalogReleaseId: command.catalogReleaseId, changeNote: "Starting configuration selected by installation owner" });
  return { startingFormVersionId: formId, startingValidationVersionId: validationId,
    destinationFormVersionId: form.id, destinationValidationVersionId: validation.id };
}
