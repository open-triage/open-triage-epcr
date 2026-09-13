import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to purge expired synthetic records");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(
    "select retention.purge_expired_synthetic_records(clock_timestamp()) as purged"
  );
  console.log(JSON.stringify(result.rows[0]?.purged ?? { assignments: 0, reports: 0 }));
} finally {
  await client.end();
}
