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

/** Returns the number of rows changed for either supported TypeORM result shape. */
export function affectedRowCount(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === "number") {
    return result[1];
  }
  return result.length;
}

/** Decode PostgreSQL integer-family values without silently losing precision. */
export function databaseInteger(value: string | number, field: string): number {
  const decoded = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(decoded)) {
    throw new TypeError(`${field} must be a safe database integer`);
  }
  return decoded;
}

/** Decode PostgreSQL numeric values while rejecting invalid/non-finite data. */
export function databaseNumber(value: string | number, field: string): number {
  const decoded = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(decoded)) {
    throw new TypeError(`${field} must be a finite database number`);
  }
  return decoded;
}
