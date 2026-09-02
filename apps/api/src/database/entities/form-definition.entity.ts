import type { FormDefinition } from "@open-triage/contracts";
import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { PatientCareReportEntity } from "./patient-care-report.entity.js";

@Entity({ name: "form_version", schema: "forms" })
export class FormDefinitionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "form_id", type: "uuid" })
  formId!: string;

  @Column({ name: "catalog_release_id", type: "uuid" })
  catalogReleaseId!: string;

  @Column({ type: "integer" })
  version!: number;

  @Column({ type: "text", default: "draft" })
  status!: "draft" | "published";

  @Column({ name: "canonical_definition", type: "jsonb" })
  canonicalDefinition!: FormDefinition;

  @Column({ name: "definition_sha256", type: "text" })
  definitionSha256!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => PatientCareReportEntity, (report) => report.formDefinition)
  reports!: PatientCareReportEntity[];
}
