import type { InstallationSettings } from "./installation-settings.js";
import fixture from "./synthetic-demo-fixture.json" with { type: "json" };

export const SYNTHETIC_DEMO_FIXTURE = Object.freeze(fixture);

export interface PublicInstallationConfiguration {
  profile: "production" | "synthetic-demo";
  settings: InstallationSettings;
  demoLogin?: {
    username: string;
    password: string;
  };
  fixture?: {
    id: string;
    revision: number;
    activeFormVersionId: string | null;
    activeFormVersion: number | null;
    activeFormDefinitionSha256: string | null;
    sectionCount: number;
    fieldCount: number;
  };
}
