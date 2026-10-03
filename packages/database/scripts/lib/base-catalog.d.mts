export interface BaseCatalogBundle {
  catalog: { release: string; dataset: string; schemaVersion: string; provenance: Record<string, unknown> };
  mapping: unknown;
  elementRows: unknown[];
  catalogSourceSha256: string;
  artifactSha256: string;
  localization: { elementLocalization: unknown; groupLocalization: unknown; codeListLocalization: unknown;
    specialChoiceLocalization: unknown; seedSha256: string };
}
export function prepareBaseCatalog(catalogText: string, localizationPath: string): Promise<BaseCatalogBundle>;
export function materializeBaseCatalog(client: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  bundle: Pick<BaseCatalogBundle, "catalog" | "mapping" | "elementRows"> & { releaseId: string; catalogStandard?: string }):
  Promise<{ elementOptionCount: number; valueSetOptionCount: number }>;
