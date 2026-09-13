/**
 * TypeORM's PostgreSQL driver returns direct mutation queries as
 * `[returnedRows, affectedRowCount]`, while CTE-wrapped mutations are returned
 * as a plain row array. Normalize both shapes at the database boundary.
 */
export function mutationRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) return [];
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[0] as T[];
  }
  return result as T[];
}
