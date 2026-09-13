import { Controller, Get, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { HealthResponse } from "@open-triage/contracts";
import { DataSource } from "typeorm";

type DatabaseIdentityRow = { database_name: string; postgres_version: string };

@Controller("health")
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  getHealth(): HealthResponse {
    return { status: "ok", service: "open-triage-api" };
  }

  /** Non-secret diagnostics for detecting stale worktrees and wrong local databases. */
  @Get("details")
  async getDevelopmentDetails(): Promise<Record<string, unknown>> {
    if (process.env.NODE_ENV === "production") throw new NotFoundException();
    const rows = await this.dataSource.query<DatabaseIdentityRow[]>(`
      select current_database() database_name, current_setting('server_version') postgres_version
    `);
    if (!rows[0]) throw new Error("PostgreSQL did not return its runtime identity");
    return {
      status: "ok",
      service: "open-triage-api",
      runtime: {
        workingDirectory: process.cwd(),
        buildSha: process.env.OPEN_TRIAGE_BUILD_SHA ?? null,
        nodeEnvironment: process.env.NODE_ENV ?? "development"
      },
      database: {
        name: rows[0].database_name,
        postgresVersion: rows[0].postgres_version
      }
    };
  }
}
