import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { processReviewWork } from './review-worker.js';

async function main() {
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const database = new DataSource({ type: 'postgres', url, synchronize: false });
try {
  await database.initialize();
  const batchSize = Number(process.env.REVIEW_BATCH_SIZE ?? 25);
  const result = await processReviewWork(database, batchSize);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (database.isInitialized) await database.destroy();
}

}
void main();
