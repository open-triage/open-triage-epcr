import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { EntityManager } from "typeorm";
import type { AnalyticsDefinition, AnalyticsSavedVisualization, AnalyticsSaveVisualizationCommand } from "@open-triage/contracts";
import { mutationRows } from "../database/mutation-result.js";
import type { ReviewScope } from "./review-scope.js";

export const visualizationKind = "analytics-visualization";
type SavedRow = { id: string; name: string; version: string; updated_at: Date | string;
  definition: { kind: typeof visualizationKind; parameters: AnalyticsDefinition } };
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const savedVisualization = (row: SavedRow): AnalyticsSavedVisualization => ({ id: row.id, name: row.name,
  version: Number(row.version), updatedAt: new Date(row.updated_at).toISOString() });
export async function listVisualizations(database: Pick<EntityManager, "query">, scope: ReviewScope) {
  const rows = await database.query<SavedRow[]>(`select id,name,version,updated_at from clinical.review_saved_analysis
    where organization_id=$1 and owner_id=$2 and not shared and definition->>'kind'=$3
    order by updated_at desc,id limit 501`, [scope.organizationId, scope.userId, visualizationKind]);
  if (rows.length > 500) throw new BadRequestException("Saved visualization limit exceeded");
  return rows.map(savedVisualization);
}
export async function readVisualization(database: Pick<EntityManager, "query">, scope: ReviewScope, id: string) {
  if (!uuid(id)) throw new BadRequestException("Choose a valid saved visualization");
  const [row] = await database.query<SavedRow[]>(`select id,name,definition,version,updated_at from clinical.review_saved_analysis
    where id=$1 and organization_id=$2 and owner_id=$3 and not shared and definition->>'kind'=$4`,
  [id, scope.organizationId, scope.userId, visualizationKind]);
  if (!row) throw new NotFoundException("Saved visualization is unavailable");
  return row;
}
export function validateSaveVisualization(id: string | undefined, command: AnalyticsSaveVisualizationCommand) {
  if (id !== undefined && !uuid(id) || !command || !uuid(command.commandId) || typeof command.name !== "string" ||
    !command.name.trim() || command.name.trim().length > 120 || !command.definition ||
    (id === undefined ? command.expectedVersion !== undefined : !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion! < 1))
    throw new BadRequestException("Invalid saved visualization command");
}
export async function writeVisualization(database: Pick<EntityManager, "query">, scope: ReviewScope, id: string | undefined,
  command: AnalyticsSaveVisualizationCommand, definition: AnalyticsDefinition) {
  const name = command.name.trim();
  const requested = JSON.stringify({ kind: visualizationKind, parameters: command.definition });
  const stored = JSON.stringify({ kind: visualizationKind, parameters: definition });
  await database.query(`select id from app_identity.organization where id=$1 for update`, [scope.organizationId]);
  const [previous] = await database.query<Array<SavedRow & { actor_id: string; action: string; same_definition: boolean }>>(`
    select h.analysis_id id,h.name,h.definition,h.version,h.recorded_at updated_at,h.actor_id,h.action,
      h.requested_definition=$3::jsonb same_definition
    from clinical.review_saved_analysis_history h
    where h.organization_id=$1 and h.command_id=$2`, [scope.organizationId, command.commandId, requested]);
  if (previous) {
    if (previous.actor_id !== scope.userId || previous.definition.kind !== visualizationKind || previous.name !== name ||
      !previous.same_definition || previous.action !== (id ? "updated" : "created") || id && previous.id !== id)
      throw new ConflictException("Saved visualization command has already been used");
    return savedVisualization(previous);
  }
  let row: SavedRow;
  if (id) {
    const current = await readVisualization(database, scope, id);
    if (Number(current.version) !== command.expectedVersion) throw new ConflictException("Saved visualization changed; load it before saving again");
    row = mutationRows<SavedRow>(await database.query(`update clinical.review_saved_analysis set name=$4,definition=$5::jsonb,
      version=version+1,updated_at=now() where id=$1 and organization_id=$2 and owner_id=$3 and not shared
      returning id,name,definition,version,updated_at`, [id, scope.organizationId, scope.userId, name, stored]))[0]!;
  } else {
    await listVisualizations(database, scope).then((rows) => { if (rows.length >= 500) throw new BadRequestException("You can save up to 500 visualizations"); });
    row = mutationRows<SavedRow>(await database.query(`insert into clinical.review_saved_analysis(organization_id,owner_id,name,definition,shared)
      values($1,$2,$3,$4::jsonb,false) returning id,name,definition,version,updated_at`, [scope.organizationId, scope.userId, name, stored]))[0]!;
  }
  await database.query(`insert into clinical.review_saved_analysis_history
    (organization_id,analysis_id,command_id,actor_id,version,action,name,definition,requested_definition,shared)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,false)`,
  [scope.organizationId, row.id, command.commandId, scope.userId, row.version, id ? "updated" : "created", name, stored, requested]);
  return savedVisualization(row);
}
