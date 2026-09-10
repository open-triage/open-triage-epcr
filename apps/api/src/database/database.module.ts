import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

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
          synchronize: false,
          logging: process.env.DATABASE_LOGGING === "true"
        };
      }
    })
  ],
  exports: [TypeOrmModule]
})
export class DatabaseModule {}
