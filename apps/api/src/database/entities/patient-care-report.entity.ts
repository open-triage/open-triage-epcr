import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn
} from "typeorm";
import { FormDefinitionEntity } from "./form-definition.entity.js";

export type PatientCareReportStatus = "draft" | "signed";

@Entity({ name: "report", schema: "clinical" })
export class PatientCareReportEntity {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @Column({ name: "incident_id", type: "uuid" })
  incidentId!: string;

  @Column({ name: "patient_id", type: "uuid" })
  patientId!: string;

  @Column({ name: "agency_demographic_version_id", type: "uuid" })
  agencyDemographicVersionId!: string;

  @Column({ name: "form_version_id", type: "uuid" })
  formDefinitionId!: string;

  @ManyToOne(() => FormDefinitionEntity, (definition) => definition.reports, { nullable: false })
  @JoinColumn({ name: "form_version_id" })
  formDefinition!: FormDefinitionEntity;

  @Column({ name: "catalog_release_id", type: "uuid" })
  catalogReleaseId!: string;

  @Column({ name: "documenting_user_id", type: "uuid" })
  documentingUserId!: string;

  @Column({ type: "text", default: "draft" })
  status!: PatientCareReportStatus;

  @Column({ type: "bigint", default: 0 })
  revision!: string;

  @Column({ name: "reporting_date", type: "date", nullable: true })
  reportingDate!: string | null;

  @Column({ name: "reporting_date_source", type: "text", nullable: true })
  reportingDateSource!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
