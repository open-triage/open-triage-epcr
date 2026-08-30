import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from "typeorm";
import { FormDefinitionEntity } from "./form-definition.entity.js";

export type PatientCareReportStatus = "draft" | "complete" | "locked";

@Entity({ name: "patient_care_reports", schema: "public" })
export class PatientCareReportEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "form_definition_id", type: "uuid" })
  formDefinitionId!: string;

  @ManyToOne(() => FormDefinitionEntity, (definition) => definition.reports, { nullable: false })
  @JoinColumn({ name: "form_definition_id" })
  formDefinition!: FormDefinitionEntity;

  @Column({ type: "text", default: "draft" })
  status!: PatientCareReportStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  data!: Record<string, unknown>;

  @Column({ name: "created_by", type: "uuid", nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
