import type { DataSource, EntityManager } from "typeorm";

type TransactionHost = Pick<DataSource, "transaction">;

/** Runs all reads that compose a mutable report response against one MVCC snapshot. */
export function withReportSnapshot<T>(
  dataSource: TransactionHost,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return dataSource.transaction("REPEATABLE READ", work);
}
