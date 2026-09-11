import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, type EntityManager } from "typeorm";
import type {
  CanonicalFormDefinition,
  CanonicalFormField,
  PublishedFormVersion,
  PublishFormVersionCommand
} from "./form-publication.types.js";
import {
  canonicalDefinitionSha256,
  FormPublicationValidationError,
  validateCanonicalFormDefinition,
  validatePublishCommand
} from "./form-publication.validation.js";

type FormVersionRow = {
  id: string;
  display_name: string | null;
  status: "draft" | "published";
  canonical_definition: unknown;
  definition_sha256: string;
  published_at: Date | string | null;
  organization_id: string;
  catalog_release_id: string;
};

type NemsisElementRow = {
  element_id: string;
  element_identity_id: string;
  analytical_location: "wide" | "repeatable";
  permitted_absence_states: string[];
};

type CustomElementRow = {
  id: string;
  organization_id: string;
  base_datatype: string;
  retired_at: Date | null;
};

type CustomGroupRow = {
  id: string;
  organization_id: string;
  temporal_kind: "clinical" | "non-temporal";
  clinical_time_element_id: string | null;
};

@Injectable()
export class FormPublicationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async publish(formVersionId: string, input: unknown, organizationId?: string): Promise<PublishedFormVersion> {
    let command: PublishFormVersionCommand;
    try {
      command = validatePublishCommand(input);
    } catch (error) {
      this.rethrowValidation(error);
    }

    try {
      return await this.dataSource.transaction("SERIALIZABLE", async (manager) => {
        const rows = await manager.query<FormVersionRow[]>(`
          select fv.id, fv.display_name, fv.status, fv.canonical_definition, fv.definition_sha256,
                 fv.published_at, fv.catalog_release_id, f.organization_id
          from forms.form_version fv
          join forms.form f on f.id = fv.form_id
          where fv.id = $1
          for update
        `, [formVersionId]);
        const version = rows[0];
        if (!version || organizationId && version.organization_id !== organizationId) {
          throw new NotFoundException(`Form version ${formVersionId} was not found`);
        }

        const digest = canonicalDefinitionSha256(version.canonical_definition);
        if (version.status === "published") {
          if (command.definitionSha256 !== version.definition_sha256 || digest !== version.definition_sha256) {
            throw new ConflictException("The published form version has different canonical content");
          }
          return this.publishedResult(manager, version.id, version.definition_sha256, version.published_at);
        }
        if (command.definitionSha256 !== digest || version.definition_sha256 !== digest) {
          throw new ConflictException("The draft content does not match its expected canonical SHA-256 digest");
        }

        let definition: CanonicalFormDefinition;
        try {
          definition = validateCanonicalFormDefinition(version.canonical_definition);
        } catch (error) {
          this.rethrowValidation(error);
        }

        const publisher = await manager.query<Array<{ id: string }>>(`
          select id from app_identity.app_user
          where id = $1 and organization_id = $2 and active
        `, [command.publishedBy, version.organization_id]);
        if (!publisher[0]) {
          throw new UnprocessableEntityException("publishedBy must be an active user in the form organization");
        }

        const metadata = await this.resolveMetadata(manager, version, definition);
        await manager.query("delete from forms.publication_validation where form_version_id = $1", [version.id]);
        await manager.query("delete from forms.form_rule where form_version_id = $1", [version.id]);
        await manager.query("delete from forms.form_field where form_version_id = $1", [version.id]);
        await manager.query("delete from forms.form_section where form_version_id = $1", [version.id]);
        await manager.query("delete from forms.form_locale where form_version_id = $1", [version.id]);

        const fieldIds = new Map<string, string>();
        for (const [sectionPosition, section] of definition.sections.entries()) {
          const sectionId = randomUUID();
          await manager.query(`
            insert into forms.form_section
              (id, form_version_id, stable_key, position, presentation)
            values ($1, $2, $3, $4, $5::jsonb)
          `, [sectionId, version.id, section.key, sectionPosition, JSON.stringify(section.presentation ?? {})]);

          for (const [fieldPosition, field] of section.fields.entries()) {
            const fieldId = randomUUID();
            fieldIds.set(field.key, fieldId);
            const resolved = metadata.get(field.key)!;
            await manager.query(`
              insert into forms.form_field
                (id, form_version_id, section_id, stable_key, position, source_kind,
                 catalog_element_identity_id, custom_element_definition_id, custom_group_definition_id,
                 required, analytical_repeatable, allowed_absence_states, configuration)
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::jsonb)
            `, [
              fieldId, version.id, sectionId, field.key, fieldPosition, field.source.kind,
              resolved.catalogElementIdentityId, resolved.customElementDefinitionId,
              resolved.customGroupDefinitionId, field.required ?? false, resolved.analyticalRepeatable,
              field.allowedAbsenceStates ?? [], JSON.stringify(field.configuration ?? {})
            ]);
          }
        }

        for (const field of definition.sections.flatMap((section) => section.fields)) {
          for (const [position, rule] of (field.rules ?? []).entries()) {
            await manager.query(`
              insert into forms.form_rule
                (form_version_id, target_field_id, rule_kind, expression, position)
              values ($1, $2, $3, $4::jsonb, $5)
            `, [version.id, fieldIds.get(field.key), rule.kind, JSON.stringify(rule.expression), position]);
          }
        }

        for (const locale of definition.locales ?? []) {
          await manager.query(`
            insert into forms.form_locale (form_version_id, locale, translations)
            values ($1, $2, $3::jsonb)
          `, [version.id, locale.locale, JSON.stringify(locale.translations)]);
        }

        const published = await manager.query<Array<{ published_at: Date | string }>>(`
          with updated as (
            update forms.form_version
            set status = 'published', change_note = $2, published_by = $3, published_at = now(),
                publication_acknowledgements = $4::jsonb, display_name = coalesce($5, display_name)
            where id = $1 and status = 'draft'
            returning published_at
          )
          select published_at from updated
        `, [version.id, command.changeNote.trim(), command.publishedBy,
          JSON.stringify(command.warningAcknowledgements ?? {}), command.displayName?.trim() ?? null]);
        if (!published[0]) throw new ConflictException("Form version is no longer a draft");
        const counts = await this.projectionCounts(manager, version.id);
        await manager.query(`
          insert into app_identity.configuration_event
            (organization_id, actor_id, action, result, form_version_id, catalog_release_id,
             change_note, content_sha256, details)
          values ($1,$2,'form.publish','succeeded',$3,$4,$5,$6,$7::jsonb)
        `, [version.organization_id, command.publishedBy, version.id, version.catalog_release_id,
          command.changeNote.trim(), digest, JSON.stringify({ structuralSummary: counts })]);
        return this.publishedResult(manager, version.id, digest, published[0].published_at);
      });
    } catch (error) {
      this.rethrowDatabaseConflict(error);
    }
  }

  private async resolveMetadata(
    manager: EntityManager,
    version: FormVersionRow,
    definition: CanonicalFormDefinition
  ): Promise<Map<string, {
    catalogElementIdentityId: string | null;
    customElementDefinitionId: string | null;
    customGroupDefinitionId: string | null;
    analyticalRepeatable: boolean;
  }>> {
    const fields = definition.sections.flatMap((section) => section.fields);
    const nemsisIds = [...new Set(fields.flatMap((field) =>
      field.source.kind === "nemsis" ? [field.source.elementId] : []))];
    const customIds = [...new Set(fields.flatMap((field) =>
      field.source.kind === "custom" ? [field.source.elementDefinitionId] : []))];
    const groupIds = [...new Set(fields.flatMap((field) =>
      field.source.kind === "custom" && field.source.groupDefinitionId ? [field.source.groupDefinitionId] : []))];

    const nemsis = await manager.query<NemsisElementRow[]>(`
      select e.element_id, e.element_identity_id, m.analytical_location,
             array(select o.code from catalog.element_option o
                   where o.release_id = e.release_id and o.element_id = e.element_id
                     and o.source_kind in ('not-value', 'pertinent-negative')) as permitted_absence_states
      from catalog.element_definition e
      join catalog.analytics_element_mapping m
        on m.release_id = e.release_id and m.element_id = e.element_id
      where e.release_id = $1 and e.element_id = any($2::text[])
    `, [version.catalog_release_id, nemsisIds]);
    const custom = customIds.length ? await manager.query<CustomElementRow[]>(`
      select id, organization_id, base_datatype, retired_at
      from forms.custom_element_definition where id = any($1::uuid[])
    `, [customIds]) : [];
    const groups = groupIds.length ? await manager.query<CustomGroupRow[]>(`
      select id, organization_id, temporal_kind, clinical_time_element_id
      from forms.custom_group_definition where id = any($1::uuid[])
    `, [groupIds]) : [];
    const nemsisById = new Map(nemsis.map((row) => [row.element_id, row]));
    const customById = new Map(custom.map((row) => [row.id, row]));
    const groupById = new Map(groups.map((row) => [row.id, row]));
    const findings: string[] = [];
    const result = new Map<string, {
      catalogElementIdentityId: string | null;
      customElementDefinitionId: string | null;
      customGroupDefinitionId: string | null;
      analyticalRepeatable: boolean;
    }>();

    for (const field of fields) {
      if (field.source.kind === "nemsis") {
        const element = nemsisById.get(field.source.elementId);
        if (!element) {
          findings.push(`field ${field.key} references unknown catalog element ${field.source.elementId}`);
          continue;
        }
        const invalidAbsence = (field.allowedAbsenceStates ?? [])
          .filter((code) => !element.permitted_absence_states.includes(code));
        if (invalidAbsence.length) {
          findings.push(`field ${field.key} uses unsupported absence states: ${invalidAbsence.join(", ")}`);
        }
        result.set(field.key, {
          catalogElementIdentityId: element.element_identity_id,
          customElementDefinitionId: null,
          customGroupDefinitionId: null,
          analyticalRepeatable: element.analytical_location === "repeatable"
        });
      } else {
        const element = customById.get(field.source.elementDefinitionId);
        const group = field.source.groupDefinitionId ? groupById.get(field.source.groupDefinitionId) : undefined;
        if (!element || element.organization_id !== version.organization_id || element.retired_at) {
          findings.push(`field ${field.key} references an unknown or unavailable custom element`);
          continue;
        }
        if (field.source.groupDefinitionId && (!group || group.organization_id !== version.organization_id)) {
          findings.push(`field ${field.key} references an unknown custom group`);
          continue;
        }
        result.set(field.key, {
          catalogElementIdentityId: null,
          customElementDefinitionId: element.id,
          customGroupDefinitionId: group?.id ?? null,
          analyticalRepeatable: Boolean(group)
        });
      }
    }

    for (const group of groups.filter((candidate) => candidate.temporal_kind === "clinical")) {
      const groupFields = fields.filter((field): field is CanonicalFormField & {
        source: { kind: "custom"; elementDefinitionId: string; groupDefinitionId: string }
      } => field.source.kind === "custom" && field.source.groupDefinitionId === group.id);
      const dateTimeFields = groupFields.filter((field) =>
        customById.get(field.source.elementDefinitionId)?.base_datatype === "dateTime");
      if (dateTimeFields.length !== 1 ||
          dateTimeFields[0]?.source.elementDefinitionId !== group.clinical_time_element_id) {
        findings.push(`custom clinical group ${group.id} must contain exactly its declared clinical date-time element`);
      }
    }
    if (findings.length) throw new UnprocessableEntityException({ message: "Form publication failed", findings });
    return result;
  }

  private async publishedResult(
    manager: EntityManager,
    id: string,
    definitionSha256: string,
    publishedAt: Date | string | null
  ): Promise<PublishedFormVersion> {
    const counts = await this.projectionCounts(manager, id);
    const names = await manager.query<Array<{ display_name: string | null }>>(
      "select display_name from forms.form_version where id = $1", [id]);
    return {
      id,
      ...(names[0]?.display_name ? { displayName: names[0].display_name } : {}),
      status: "published",
      definitionSha256,
      publishedAt: new Date(publishedAt!).toISOString(),
      projections: counts
    };
  }

  private async projectionCounts(
    manager: EntityManager,
    id: string
  ): Promise<{ sections: number; fields: number; rules: number; locales: number }> {
    const counts = await manager.query<Array<{ sections: number; fields: number; rules: number; locales: number }>>(`
      select
        (select count(*)::integer from forms.form_section where form_version_id = $1) as sections,
        (select count(*)::integer from forms.form_field where form_version_id = $1) as fields,
        (select count(*)::integer from forms.form_rule where form_version_id = $1) as rules,
        (select count(*)::integer from forms.form_locale where form_version_id = $1) as locales
    `, [id]);
    return counts[0]!;
  }

  private rethrowValidation(error: unknown): never {
    if (error instanceof FormPublicationValidationError) {
      throw new UnprocessableEntityException({ message: error.message, findings: error.findings });
    }
    throw error;
  }

  private rethrowDatabaseConflict(error: unknown): never {
    if (error instanceof ConflictException || error instanceof NotFoundException || error instanceof UnprocessableEntityException) throw error;
    if (typeof error === "object" && error !== null && "code" in error &&
        ["23503", "23505", "23514", "23P01", "40001", "40P01"].includes(String(error.code))) {
      throw new ConflictException("The form publication command conflicts with existing form data");
    }
    throw error;
  }
}
