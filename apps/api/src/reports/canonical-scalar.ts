type JsonRecord = Record<string, unknown>;

export type CatalogScalarDatatype =
  | "string"
  | "anyURI"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "dateTime"
  | "time"
  | "duration"
  | "binary";

export type ScalarDatabaseColumn =
  | "value_text"
  | "value_integer"
  | "value_numeric"
  | "value_boolean"
  | "value_date"
  | "value_datetime"
  | "value_time"
  | "value_duration"
  | "value_binary";

export type ScalarDatabaseKind =
  | "text"
  | "uri"
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "binary";

type ScalarMapping = Readonly<{
  databaseKind: ScalarDatabaseKind;
  databaseColumn: ScalarDatabaseColumn;
}>;

/** The single translation table between catalog scalar datatypes and canonical storage. */
export const SCALAR_DATABASE_MAPPING = {
  string: { databaseKind: "text", databaseColumn: "value_text" },
  anyURI: { databaseKind: "uri", databaseColumn: "value_text" },
  integer: { databaseKind: "integer", databaseColumn: "value_integer" },
  decimal: { databaseKind: "numeric", databaseColumn: "value_numeric" },
  boolean: { databaseKind: "boolean", databaseColumn: "value_boolean" },
  date: { databaseKind: "date", databaseColumn: "value_date" },
  dateTime: { databaseKind: "datetime", databaseColumn: "value_datetime" },
  time: { databaseKind: "time", databaseColumn: "value_time" },
  duration: { databaseKind: "duration", databaseColumn: "value_duration" },
  binary: { databaseKind: "binary", databaseColumn: "value_binary" },
} as const satisfies Record<CatalogScalarDatatype, ScalarMapping>;

function isCatalogScalarDatatype(value: string): value is CatalogScalarDatatype {
  return Object.hasOwn(SCALAR_DATABASE_MAPPING, value);
}

export function scalarDatabaseMapping(baseDatatype: string): ScalarMapping {
  return isCatalogScalarDatatype(baseDatatype)
    ? SCALAR_DATABASE_MAPPING[baseDatatype]
    : SCALAR_DATABASE_MAPPING.string;
}

export function scalarDatabaseValue(value: unknown, baseDatatype: string): unknown {
  return baseDatatype === "binary" ? Buffer.from(String(value), "base64") : value;
}

const DATABASE_SCALAR_KINDS = new Set<ScalarDatabaseKind>(
  Object.values(SCALAR_DATABASE_MAPPING).map(({ databaseKind }) => databaseKind),
);

/** Normalizes canonical and legacy database-shaped scalars for transport comparisons. */
export function comparableScalar(candidate: JsonRecord): { kind: "scalar"; value: unknown } | null {
  if (candidate.kind === "scalar") return { kind: "scalar", value: candidate.value };
  if (DATABASE_SCALAR_KINDS.has(candidate.kind as ScalarDatabaseKind)) {
    return { kind: "scalar", value: candidate.value };
  }
  return null;
}
