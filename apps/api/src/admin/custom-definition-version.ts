import type { CatalogDraftCustomElement } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

/** Definitions belong to the sealed catalog release, while the identity row is stable. */
export async function releaseCustomDefinitions(manager: Pick<EntityManager, "query">, releaseId: string): Promise<CatalogDraftCustomElement[] | null> {
  const rows = await manager.query<Array<{ definitions: CatalogDraftCustomElement[] | null }>>(`
    select provenance->'customElementDefinitions' as definitions
    from catalog.release where id=$1
  `, [releaseId]);
  return Array.isArray(rows[0]?.definitions) ? rows[0].definitions : null;
}
