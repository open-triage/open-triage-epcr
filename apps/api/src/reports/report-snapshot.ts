import type { DataSource, EntityManager } from "typeorm";
import { retryTransaction } from "../database/retry-transaction.js";

type TransactionHost = Pick<DataSource, "transaction">;

/** Runs all reads that compose a mutable report response against one MVCC snapshot. */
export function withReportSnapshot<T>(
  dataSource: TransactionHost,
  work: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  // Row locks and audit writes can invalidate a snapshot during concurrent edits.
  // Retry the whole rolled-back operation so its reads and writes stay consistent.
  return retryTransaction(() => dataSource.transaction("REPEATABLE READ", work));
}
