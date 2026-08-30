import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FormDefinitionEntity } from "./entities/form-definition.entity.js";
import { PatientCareReportEntity } from "./entities/patient-care-report.entity.js";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const url = process.env.DATABASE_URL;

        if (!url) {
          throw new Error("DATABASE_URL is required to connect the OpenTriage API to Postgres");
        }

        return {
          type: "postgres" as const,
          url,
          entities: [FormDefinitionEntity, PatientCareReportEntity],
          synchronize: false,
          logging: process.env.DATABASE_LOGGING === "true"
        };
      }
    }),
    TypeOrmModule.forFeature([FormDefinitionEntity, PatientCareReportEntity])
  ],
  exports: [TypeOrmModule]
})
export class DatabaseModule {}
