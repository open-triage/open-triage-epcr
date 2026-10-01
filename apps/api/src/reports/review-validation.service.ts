import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import {
  compiledValidationBundleSha256,
  evaluateValidationBundleSafely,
  type CompiledValidationBundle,
  type ValidationFinding,
  type ValidationReviewEvaluation,
  type ValidationReviewFailure,
} from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { encounterDocument } from "./encounter-document.persistence.js";

type ReportRow = {
  id: string;
  organization_id: string;
  catalog_release_id: string;
  revision: string | number;
};

type VersionRow = {
  id: string;
  compiled_bundle: CompiledValidationBundle;
  compiled_sha256: string;
};

type EvaluationRow = {
  id: string;
  report_id: string;
  report_revision: string | number;
  validation_version_id: string;
  validation_compiled_sha256: string;
  evaluated_by: string;
  outcome: ValidationReviewEvaluation["outcome"];
  findings: ValidationFinding[];
  failures: ValidationReviewFailure[];
  evaluated_at: Date | string;
};

function selectedVersion(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UnprocessableEntityException("Request body must be an object");
  }
  const value = (input as Record<string, unknown>).validationVersionId;
  if (typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new UnprocessableEntityException("validationVersionId must be a UUIDv4");
  }
  return value;
}

function evaluation(row: EvaluationRow): ValidationReviewEvaluation {
  return {
    id: row.id,
    reportId: row.report_id,
    reportRevision: Number(row.report_revision),
    validationVersionId: row.validation_version_id,
    validationCompiledSha256: row.validation_compiled_sha256,
    evaluatedBy: row.evaluated_by,
    outcome: row.outcome,
    findings: row.findings,
    failures: row.failures,
    evaluatedAt: new Date(row.evaluated_at).toISOString(),
  };
}

@Injectable()
export class ReviewValidationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ClinicianSessionService,
  ) {}

  async evaluate(accessToken: string, reportId: string, input: unknown): Promise<ValidationReviewEvaluation> {
    const session = await this.sessions.requireCapability(accessToken, "validation:read");
    const validationVersionId = selectedVersion(input);
    const evaluatedAt = new Date().toISOString();

    return this.dataSource.transaction("REPEATABLE READ", async (manager) => {
      const reports = await manager.query<ReportRow[]>(`
        select id,organization_id,catalog_release_id,revision from clinical.report
        where id=$1 and organization_id=$2 and (status='signed' or documenting_user_id=$3)
      `, [reportId, session.organization.id, session.user.id]);
      const report = reports[0];
      if (!report) throw new NotFoundException(`Report ${reportId} was not found`);

      const versions = await manager.query<VersionRow[]>(`
        select id,compiled_bundle,compiled_sha256 from validation.version
        where id=$1 and organization_id=$2 and catalog_release_id=$3 and status='published'
      `, [validationVersionId, session.organization.id, report.catalog_release_id]);
      const version = versions[0];
      if (!version) {
        throw new NotFoundException("The selected published Validation version is unavailable for this report");
      }

      let findings: ValidationFinding[] = [];
      let failures: ValidationReviewFailure[] = [];
      if (compiledValidationBundleSha256(version.compiled_bundle) !== version.compiled_sha256) {
        failures = [{ validationVersionId, ruleId: "bundle", executionTarget: "review", code: "integrity",
          message: "The selected validation bundle failed its integrity check" }];
      } else {
        try {
          const document = await encounterDocument(manager, report.id);
          const settings = await manager.query<Array<{ language: string }>>(`
            select language from app_identity.agency_settings where organization_id=$1
          `, [report.organization_id]);
          const result = evaluateValidationBundleSafely(version.compiled_bundle, document, "review",
            { timestamp: evaluatedAt, language: settings[0]?.language ?? "en" });
          findings = result.findings;
          failures = result.failures.map((failure) => ({ ...failure, executionTarget: "review" }));
        } catch {
          failures = [{ validationVersionId, ruleId: "bundle", executionTarget: "review", code: "runtime",
            message: "The report could not be evaluated" }];
        }
      }

      const outcome: ValidationReviewEvaluation["outcome"] = failures.length
        ? "failed" : findings.length ? "findings" : "passed";
      const inserted = mutationRows<EvaluationRow>(await manager.query(`
        insert into clinical.validation_review_evaluation
          (organization_id,report_id,report_revision,validation_version_id,
           validation_compiled_sha256,evaluated_by,outcome,findings,failures,evaluated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
        returning id,report_id,report_revision,validation_version_id,
          validation_compiled_sha256,evaluated_by,outcome,findings,failures,evaluated_at
      `, [session.organization.id, report.id, Number(report.revision), validationVersionId,
        version.compiled_sha256, session.user.id, outcome, JSON.stringify(findings),
        JSON.stringify(failures), evaluatedAt]));
      return evaluation(inserted[0]!);
    });
  }
}
