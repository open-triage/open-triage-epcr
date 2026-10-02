import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { ReviewSignedReportsResponse } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { reviewScope } from "./review-scope.js";

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new BadRequestException("Invalid Review pagination");
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new BadRequestException("Invalid Review pagination");
  return number;
}

@Injectable()
export class ReviewService {
  constructor(@InjectDataSource() private readonly database: DataSource,
    private readonly sessions: ClinicianSessionService) {}

  async signedReports(token: string, requestedDataset?: string,
    requestedPage?: string, requestedPageSize?: string): Promise<ReviewSignedReportsResponse> {
    const scope = reviewScope(await this.sessions.get(token));
    const dataset = requestedDataset ?? scope.defaultDataset;
    if (dataset !== "real" && dataset !== "synthetic") throw new BadRequestException("Invalid Review dataset");
    const page = positiveInteger(requestedPage, 1, 1000000);
    const pageSize = positiveInteger(requestedPageSize, 25, 100);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new BadRequestException("Invalid Review pagination");
    const parameters = [scope.organizationId, dataset === "synthetic", scope.userId, scope.reports === "all"];
    const where = `r.organization_id = $1 and r.synthetic = $2 and r.status = 'signed'
      and ($4::boolean or r.documenting_user_id = $3)`;
    const [countRows, reportRows] = await Promise.all([
      this.database.query<Array<{ total: string }>>(`select count(*)::text total from clinical.report r where ${where}`, parameters),
      this.database.query<Array<{ id: string; reporting_date: string; signed_at: Date | string;
        author_name: string | null }>>(`
        select r.id, r.reporting_date, s.signed_at,
          case when $7::boolean then u.display_name else null end author_name
        from clinical.report r
        join clinical.signed_snapshot s on s.report_id = r.id
        join app_identity.app_user u on u.id = r.documenting_user_id
        where ${where}
        order by s.signed_at desc, r.id desc limit $5 offset $6
      `, [...parameters, pageSize, offset, scope.identifying]),
    ]);
    return {
      dataset, page, pageSize, total: Number(countRows[0]?.total ?? 0),
      scope: scope.reports, identifying: scope.identifying, administrator: scope.administrator,
      asOf: new Date().toISOString(),
      reports: reportRows.map((row) => ({ id: row.id, reportingDate: row.reporting_date,
        signedAt: new Date(row.signed_at).toISOString(),
        ...(row.author_name ? { documentingClinician: row.author_name } : {}) })),
    };
  }
}
