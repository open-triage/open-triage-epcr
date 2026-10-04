import { readValidationDefinition, serializeValidationDefinition } from "@open-triage/contracts";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Injectable, ConflictException, UnprocessableEntityException, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { FormPublicationService } from "../forms/form-publication.service.js";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { CatalogAuthoringService } from "./catalog-authoring.service.js";
import { FormAuthoringService } from "./form-authoring.service.js";
import { ValidationAuthoringService } from "./validation-authoring.service.js";
import { catalogFingerprint, contentDigest, localDefinitionsRoot, discoverPackages, makePackage, parsePackage, writePackage, type DefinitionKind } from "./canonical-package.js";

@Injectable()
export class CanonicalPackageService {
  constructor(@InjectDataSource() private readonly db: DataSource, private readonly sessions: ClinicianSessionService,
    private readonly catalogs: CatalogAuthoringService, private readonly forms: FormAuthoringService,
    private readonly validations: ValidationAuthoringService) {}

  private kind(value: string): DefinitionKind {
    if (value !== "catalog" && value !== "form" && value !== "validation") throw new UnprocessableEntityException("Unknown definition kind");
    return value;
  }
  private async fingerprint(token: string, id: string) {
    const view = await this.catalogs.inspectVersion(token, id);
    return catalogFingerprint(view.definition as unknown as Record<string, unknown>);
  }
  async list(token: string, value: string) {
    const kind = this.kind(value);
    await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:read`);
    const files = await discoverPackages(kind);
    return Promise.all(files.map(async (entry) => {
      try {
        if (entry.error) throw new UnprocessableEntityException(entry.error);
        if (kind === "catalog" && !entry.package) {
          const bundle = await this.baseBundle(entry.raw);
          return { file: entry.file, package: { name: `NEMSIS ${bundle.catalog.release}` }, compatible: true };
        }
        const normalized = await this.normalize(token, kind, entry.package ?? entry.raw);
        return { file: entry.file, package: normalized, compatible: true };
      } catch (error) {
        return { file: entry.file, compatible: false, error: error instanceof Error ? error.message : "Invalid canonical definition" };
      }
    }));
  }

  /** Read and import only the file explicitly selected by the administrator. */
  async importFile(token: string, value: string, input: unknown) {
    const kind = this.kind(value);
    await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:publish`);
    const file = (input as { file?: unknown } | null)?.file;
    if (typeof file !== "string") throw new UnprocessableEntityException("Select a definition file");
    const entry = (await discoverPackages(kind)).find((entry) => entry.file === file);
    if (!entry) throw new UnprocessableEntityException("The selected definition file is unavailable");
    if (entry.error) throw new UnprocessableEntityException(entry.error);
    return this.import(token, kind, entry.package ?? entry.raw, (input as { catalogReleaseId?: unknown }).catalogReleaseId);
  }

  private async baseBundle(input: unknown) {
    const raw = input as Record<string, unknown> | undefined;
    if (!raw || raw.schemaVersion !== "1.0.0" || typeof raw.release !== "string" || !/^[0-9.]+$/.test(raw.release))
      throw new UnprocessableEntityException("Unsupported base catalog format");
    const catalogText = await readFile(path.join(localDefinitionsRoot(), "catalog", `catalog_nemsis-${raw.release}.json`), "utf8");
    if (contentDigest(raw) !== contentDigest(JSON.parse(catalogText)))
      throw new UnprocessableEntityException("Base catalog differs from the supported definition file");
    const { prepareBaseCatalog } = await import("../../../../packages/database/scripts/lib/base-catalog.mjs");
    return prepareBaseCatalog(catalogText, path.join(localDefinitionsRoot(), "localization", "localization_sv.json"));
  }

  private async normalize(token: string, kind: DefinitionKind, input: unknown, targetCatalogId?: unknown) {
    const raw = input as Record<string, unknown> | undefined;
    const portable = raw?.format === "opentriage-definition" ? parsePackage(raw, kind, { ignoreVersion: true }) : null;
    if (!portable && (!raw || !(raw.schemaVersion === 1 || kind === "validation" && raw.schemaVersion === 2)))
      throw new UnprocessableEntityException("Unsupported canonical schema version");
    const available = await this.catalogs.versions(token);
    if (!available.length) throw new UnprocessableEntityException("Import a catalog before importing forms or validation rules");
    if (targetCatalogId !== undefined && (typeof targetCatalogId !== "string" || !available.some(({ id }) => id === targetCatalogId)))
      throw new UnprocessableEntityException("The selected catalog is unavailable to this agency");
    let selected = available.find(({ id }) => id === targetCatalogId);
    if (!selected && portable) {
      for (const catalog of available) {
        if (await this.fingerprint(token, catalog.id) === portable.catalog.sha256) { selected = catalog; break; }
      }
    }
    if (!portable) {
      const key = raw!.catalogKey;
      if (typeof key !== "string" || !/^[a-z0-9.-]+$/.test(key)) throw new UnprocessableEntityException("Invalid catalog key");
      const separator = key.indexOf("-");
      const rows = await this.db.query<Array<{ id: string }>>(`select id from catalog.release where sealed and id=any($1::uuid[])
        and standard=$2 and (coalesce(provenance->>'dataModelVersion',version)=$3 or version like $3 || '-agency-%')`,
      [available.map(({ id }) => id), key.slice(0, separator).toUpperCase(), key.slice(separator + 1)]);
      const compatible = new Set(rows.map(({ id }) => id));
      if (selected && !compatible.has(selected.id)) throw new UnprocessableEntityException("The selected catalog uses a different clinical data model");
      selected ??= available.find(({ id, status }) => compatible.has(id) && status === "active")
        ?? available.find(({ id }) => compatible.has(id));
      if (!selected) throw new UnprocessableEntityException("Import a catalog for this clinical data model first");
    }
    selected ??= available.find(({ status }) => status === "active") ?? available[0]!;
    const name = portable?.name ?? raw!.name;
    if (typeof name !== "string" || !name.trim()) throw new UnprocessableEntityException("Canonical name is required");
    let definition = portable?.definition;
    if (!portable) {
      if (kind === "form") definition = { schemaVersion: 1, ...(raw!.definition as object) };
      else {
        try {
          const imported = readValidationDefinition(structuredClone(raw!.schemaVersion === 2 ? raw : raw!.rules));
          const { applyFormValidationLocalization } = await import("../../../../packages/database/scripts/lib/form-validation-localization.mjs");
          await applyFormValidationLocalization(localDefinitionsRoot(), { key: raw!.key ?? name }, imported,
            { missingOnly: true, allowUnmatched: true });
          definition = serializeValidationDefinition(imported.rules, imported.metrics);
        } catch { throw new UnprocessableEntityException("Unsupported Validation definition"); }
      }
    }
    return makePackage({ kind, name, version: "", catalog: { sha256: await this.fingerprint(token, selected.id) },
      definition });
  }

  async export(token: string, value: string, id: string) {
    const kind = this.kind(value);
    const session = await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:read`);
    let name: string, version: string, catalogId: string, definition: unknown;
    if (kind === "catalog") {
      const view = await this.catalogs.inspectVersion(token, id);
      const rows = await this.db.query(`select source_release_id,canonical_definition from catalog.authoring_draft
        where published_release_id=$1 and organization_id=$2`, [id, session.organization.id]);
      name = view.displayName; version = String(view.version); catalogId = rows[0]?.source_release_id ?? id;
      const { sourceReleaseId: _id, ...portable } = rows[0]?.canonical_definition ?? view.definition;
      definition = portable;
    } else {
      const rows = kind === "form" ? await this.db.query(`select coalesce(fv.display_name, f.name) as display_name,fv.version,fv.catalog_release_id,fv.canonical_definition as definition
        from forms.form_version fv join forms.form f on f.id=fv.form_id
        where fv.id=$1 and f.organization_id=$2 and fv.status='published'`, [id, session.organization.id])
        : await this.db.query(`select display_name,version,catalog_release_id,source_rule as definition
          from validation.version where id=$1 and organization_id=$2 and status='published'`, [id, session.organization.id]);
      if (!rows[0]) throw new UnprocessableEntityException("Published definition is unavailable");
      name = rows[0].display_name; version = String(rows[0].version); catalogId = rows[0].catalog_release_id;
      definition = rows[0].definition;
      if (kind === "validation" && !Array.isArray(definition) && (definition as { schemaVersion?: number }).schemaVersion !== 2) definition = [definition];
    }
    return makePackage({ kind, name, version, catalog: { sha256: await this.fingerprint(token, catalogId) }, definition });
  }
  async persist(token: string, kind: DefinitionKind, id: string) {
    try { await writePackage(await this.export(token, kind, id)); }
    catch { throw new ServiceUnavailableException({ message: "Publication succeeded, but canonical file export failed. Export this published version after restoring writable local storage.", publishedId: id }); }
  }
  async import(token: string, value: string, input: unknown, targetCatalogId?: unknown) {
    const kind = this.kind(value);
    const session = await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:publish`);
    const base = kind === "catalog" && (input as { format?: unknown } | null)?.format !== "opentriage-definition"
      ? await this.baseBundle(input) : null;
    const p = base ? null : await this.normalize(token, kind, input, targetCatalogId);
    const published = await this.db.transaction("SERIALIZABLE", async (manager) => {
      // Reuse authoring validation, audit, and publication in one transaction. Nested
      // authoring transactions join this manager, so a failed import leaves no draft.
      const scoped = Object.create(this.db) as DataSource;
      Object.defineProperties(scoped, {
        manager: { value: manager },
        query: { value: manager.query.bind(manager) },
        transaction: { value: async (...args: unknown[]) => (args.at(-1) as (m: typeof manager) => unknown)(manager) }
      });
      await manager.query("select pg_advisory_xact_lock(hashtext($1))", [`canonical-import:${session.organization.id}:${kind}`]);
      const catalogs = new CatalogAuthoringService(scoped, this.sessions);
      const validations = new ValidationAuthoringService(scoped, this.sessions);
      const forms = new FormAuthoringService(scoped, this.sessions, new FormPublicationService(scoped), validations);
      const importer = new CanonicalPackageService(scoped, this.sessions, catalogs, forms, validations);
      if (base) return catalogs.importBase(token, base, `Imported base catalog ${contentDigest(input)}`);
      return importer.importPublished(token, kind, p!, targetCatalogId as string | undefined);
    });
    await this.persist(token, kind, published.id);
    return published;
  }

  private async importPublished(token: string, value: string, input: unknown, targetCatalogId?: string) {
    const kind = this.kind(value);
    const session = await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:publish`);
    const p = parsePackage(input, kind);
    const available = await this.catalogs.versions(token);
    let catalogReleaseId: string | undefined;
    for (const catalog of available.filter(({ id }) => !targetCatalogId || id === targetCatalogId)) if (await this.fingerprint(token, catalog.id) === p.catalog.sha256) { catalogReleaseId = catalog.id; break; }
    if (!catalogReleaseId) throw new UnprocessableEntityException("Install the exact compatible published catalog first. Matching names or version numbers are insufficient.");
    const draftLock = kind === "catalog" ? `catalog-draft:${session.organization.id}:${session.user.id}`
      : kind === "form" ? `form-draft:${session.organization.id}` : `validation-draft:${session.organization.id}:${session.user.id}`;
    await this.db.query("select pg_advisory_xact_lock(hashtext($1))", [draftLock]);
    // Never overwrite an existing editor draft, including a draft returned by clone/create.
    const current = kind === "catalog" ? await this.catalogs.current(token) : kind === "form" ? await this.forms.current(token) : await this.validations.current(token);
    if (current) throw new ConflictException("Publish or discard the existing draft before importing");
    let published: { id: string };
    const changeNote = `Imported canonical ${p.sha256}`;
    if (kind === "catalog") {
      const draft = await this.catalogs.cloneActive(token, { sourceVersionId: catalogReleaseId, displayName: p.name });
      const saved = await this.catalogs.save(token, draft.id, { expectedRevision: draft.revision, displayName: p.name,
        definition: { ...(p.definition as object), sourceReleaseId: catalogReleaseId } });
      published = await this.catalogs.publish(token, saved.id, { expectedRevision: saved.revision, definitionSha256: saved.definitionSha256, displayName: p.name, changeNote });
    } else if (kind === "form") {
      const draft = await this.forms.clone(token, { catalogReleaseId, displayName: p.name });
      const saved = await this.forms.save(token, draft.id, { expectedRevision: draft.revision, displayName: p.name, definition: p.definition });
      published = await this.forms.publish(token, saved.id, { expectedRevision: saved.revision, definitionSha256: saved.definitionSha256, displayName: p.name, changeNote });
    } else {
      let imported;
      try { imported = readValidationDefinition(p.definition); } catch { throw new UnprocessableEntityException("Unsupported Validation definition"); }
      // Portable rule IDs belong to the source agency. Allocate destination identities
      // inside the import transaction without changing provenance or rule content.
      const rules = imported.rules.map((rule) => ({ ...rule, id: randomUUID() }));
      const draft = await this.validations.create(token, { catalogReleaseId, displayName: p.name }, { importedRules: rules, importedMetrics: imported.metrics });
      const saved = await this.validations.save(token, draft.id, { expectedRevision: draft.revision, displayName: p.name, rules: draft.rules, metrics: draft.metrics });
      published = await this.validations.publish(token, saved.id, { expectedRevision: saved.revision, displayName: p.name, changeNote });
    }
    return published;
  }
}
