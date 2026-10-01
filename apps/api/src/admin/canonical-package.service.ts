import { createHash } from "node:crypto";
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
    const available = await this.catalogs.versions(token);
    const fingerprints = new Set(await Promise.all(available.map((catalog) => this.fingerprint(token, catalog.id))));
    return Promise.all(files.map(async (entry) => {
      try {
        const normalized = entry.package ?? await this.normalize(token, kind, entry.raw);
        if ("installedId" in normalized) return { file: entry.file, package: entry.raw, compatible: true, installed: true };
        return { file: entry.file, package: normalized, compatible: fingerprints.has(normalized.catalog.sha256) };
      } catch (error) {
        return { file: entry.file, compatible: false, error: error instanceof Error ? error.message : "Invalid canonical definition" };
      }
    }));
  }

  private async normalize(token: string, kind: DefinitionKind, input: unknown) {
    const raw = input as Record<string, unknown> | undefined;
    if (raw?.format === "opentriage-definition") return parsePackage(raw, kind);
    if (!raw || (kind === "catalog" ? raw.schemaVersion !== "1.0.0" : raw.schemaVersion !== 1))
      throw new UnprocessableEntityException("Unsupported canonical schema version");
    const key = kind === "catalog" ? `nemsis-${raw.release}` : raw.catalogKey;
    if (typeof key !== "string" || !/^[a-z0-9.-]+$/.test(key)) throw new UnprocessableEntityException("Invalid catalog key");
    // Legacy installation files pin the checked-in base catalog bytes, not just its name.
    const catalogText = await readFile(path.join(localDefinitionsRoot(), "catalog", `catalog_${key}.json`), "utf8");
    if (kind === "catalog" && contentDigest(raw) !== contentDigest(JSON.parse(catalogText)))
      throw new UnprocessableEntityException("Base catalog differs from the installed canonical catalog");
    const sourceHash = createHash("sha256").update(catalogText.replace(
      /"\$schema": "(?:\.\/schema_nemsis-3\.5\.1\.json|\.\.\/\.\.\/packages\/contracts\/catalog\.schema-1\.0\.0\.json)"/,
      '"$schema": "./nemsis-data-model.schema-1.0.0.json"')).digest("hex");
    const available = await this.catalogs.versions(token);
    const rows = await this.db.query(`select id from catalog.release where sealed and
      (provenance->>'catalogSourceSha256'=$1 or artifact_sha256=$1) and id=any($2::uuid[])`,
      [sourceHash, available.map(({ id }) => id)]);
    if (!rows[0]) throw new UnprocessableEntityException("Install the exact base catalog before importing this definition");
    if (kind === "catalog") return { installedId: rows[0].id as string };
    if (typeof raw.name !== "string") throw new UnprocessableEntityException("Canonical name is required");
    return makePackage({ kind, name: raw.name, version: "1", catalog: { sha256: await this.fingerprint(token, rows[0].id) },
      definition: kind === "form" ? { schemaVersion: 1, ...(raw.definition as object) } : raw.rules });
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
      if (kind === "validation" && !Array.isArray(definition)) definition = [definition];
    }
    return makePackage({ kind, name, version, catalog: { sha256: await this.fingerprint(token, catalogId) }, definition });
  }
  async persist(token: string, kind: DefinitionKind, id: string) {
    try { await writePackage(await this.export(token, kind, id)); }
    catch { throw new ServiceUnavailableException({ message: "Publication succeeded, but canonical file export failed. Export this published version again after restoring writable local storage.", publishedId: id }); }
  }
  async import(token: string, value: string, input: unknown) {
    const kind = this.kind(value);
    const session = await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:publish`);
    const normalized = await this.normalize(token, kind, input);
    if ("installedId" in normalized) return { id: normalized.installedId };
    const p = normalized;
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
      const note = `Imported canonical ${p.sha256}, source version ${p.version}`;
      const prior = kind === "catalog" ? await manager.query(`select cr.id from catalog.release cr
        join catalog.authoring_draft d on d.published_release_id=cr.id
        where d.organization_id=$1 and cr.provenance->>'changeNote'=$2`, [session.organization.id, note])
        : kind === "form" ? await manager.query(`select fv.id from forms.form_version fv join forms.form f on f.id=fv.form_id
          where f.organization_id=$1 and fv.status='published' and fv.change_note=$2`, [session.organization.id, note])
        : await manager.query(`select id from validation.version where organization_id=$1 and status='published' and change_note=$2`, [session.organization.id, note]);
      if (prior[0]) return { id: prior[0].id };
      const catalogs = new CatalogAuthoringService(scoped, this.sessions);
      const validations = new ValidationAuthoringService(scoped, this.sessions);
      const forms = new FormAuthoringService(scoped, this.sessions, new FormPublicationService(scoped), validations);
      const importer = new CanonicalPackageService(scoped, this.sessions, catalogs, forms, validations);
      const versions = kind === "catalog" ? await catalogs.versions(token) : kind === "form" ? await forms.versions(token) : await validations.versions(token);
      for (const candidate of versions) {
        // A file written by this very installation already has a published version.
        if (String(candidate.version) !== p.version) continue;
        try { if ((await importer.export(token, kind, candidate.id)).sha256 === p.sha256) return { id: candidate.id }; }
        catch (error) { if (!(error instanceof UnprocessableEntityException)) throw error; }
      }
      return importer.importPublished(token, kind, p);
    });
    await this.persist(token, kind, published.id);
    return published;
  }

  private async importPublished(token: string, value: string, input: unknown) {
    const kind = this.kind(value);
    const session = await this.sessions.requireCapability(token, `${kind === "form" ? "forms" : kind}:publish`);
    const p = parsePackage(input, kind);
    const available = await this.catalogs.versions(token);
    let catalogReleaseId: string | undefined;
    for (const catalog of available) if (await this.fingerprint(token, catalog.id) === p.catalog.sha256) { catalogReleaseId = catalog.id; break; }
    if (!catalogReleaseId) throw new UnprocessableEntityException("Install the exact compatible published catalog first. Matching names or version numbers are insufficient.");
    const draftLock = kind === "catalog" ? `catalog-draft:${session.organization.id}:${session.user.id}`
      : kind === "form" ? `form-draft:${session.organization.id}` : `validation-draft:${session.organization.id}:${session.user.id}`;
    await this.db.query("select pg_advisory_xact_lock(hashtext($1))", [draftLock]);
    // Never overwrite an existing editor draft, including a draft returned by clone/create.
    const current = kind === "catalog" ? await this.catalogs.current(token) : kind === "form" ? await this.forms.current(token) : await this.validations.current(token);
    if (current) throw new ConflictException("Publish or discard the existing draft before importing");
    let published: { id: string };
    const changeNote = `Imported canonical ${p.sha256}, source version ${p.version}`;
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
      const draft = await this.validations.create(token, { catalogReleaseId, displayName: p.name });
      const saved = await this.validations.save(token, draft.id, { expectedRevision: draft.revision, rules: p.definition });
      published = await this.validations.publish(token, saved.id, { expectedRevision: saved.revision, displayName: p.name, changeNote });
    }
    return published;
  }
}
