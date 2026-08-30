import type { FormDefinition } from "@open-triage/contracts";
import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { PatientCareReportEntity } from "./patient-care-report.entity.js";

@Entity({ name: "form_definitions", schema: "public" })
@Index(["slug", "version", "locale"], { unique: true })
export class FormDefinitionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  slug!: string;

  @Column({ type: "text" })
  version!: string;

  @Column({ type: "text", default: "en" })
  locale!: string;

  @Column({ type: "jsonb" })
  definition!: FormDefinition;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => PatientCareReportEntity, (report) => report.formDefinition)
  reports!: PatientCareReportEntity[];
}
