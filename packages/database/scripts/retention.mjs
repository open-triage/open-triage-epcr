import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import pg from "pg";

function option(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (required && !value) throw new Error(`--${name} is required`);
  return value;
}

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!["prepare", "export", "verify", "fail", "delete"].includes(command)) {
  throw new Error("usage: retention.mjs <prepare|export|verify|fail|delete> [options]");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  if (command === "prepare") {
    const result = await client.query(
      "select retention.prepare_archive_batch($1::uuid, $2::date, $3::text) as batch_id",
      [option("organization"), option("as-of"), option("actor")]
    );
    console.log(JSON.stringify(result.rows[0]));
  }

  if (command === "export") {
    const batchId = option("batch");
    const output = option("output");
    const batch = await client.query(
      "select status, report_count, archive_sha256 from retention.archive_batch where id = $1",
      [batchId]
    );
    if (batch.rowCount !== 1 || batch.rows[0].status !== "prepared") {
      throw new Error(`batch ${batchId} is not prepared`);
    }
    const payloads = await client.query(`
      select retention.report_archive_payload(br.report_id)::text as payload
      from retention.archive_batch_report br
      where br.batch_id = $1
      order by br.reporting_date, br.report_id
    `, [batchId]);
    const stream = createWriteStream(output, { encoding: "utf8", flags: "wx", mode: 0o600 });
    const hash = createHash("sha256");
    for (const row of payloads.rows) {
      const line = `${row.payload}\n`;
      hash.update(line);
      if (!stream.write(line)) await once(stream, "drain");
    }
    stream.end();
    await once(stream, "close");
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== batch.rows[0].archive_sha256) {
      throw new Error(`export checksum mismatch: expected ${batch.rows[0].archive_sha256}, got ${actualSha256}`);
    }
    console.log(JSON.stringify({ batchId, output, reportCount: payloads.rowCount, sha256: actualSha256 }));
  }

  if (command === "verify") {
    await client.query("select retention.verify_archive($1::uuid, $2, $3, $4, $5)", [
      option("batch"), option("object-uri"), option("object-version"), option("sha256"), option("actor")
    ]);
    console.log(JSON.stringify({ batchId: option("batch"), status: "archive_verified" }));
  }

  if (command === "fail") {
    await client.query("select retention.fail_archive($1::uuid, $2, $3, $4)", [
      option("batch"), option("actor"), option("code"), option("detail")
    ]);
    console.log(JSON.stringify({ batchId: option("batch"), status: "archive_failed" }));
  }

  if (command === "delete") {
    const result = await client.query("select retention.delete_verified_batch($1::uuid, $2) as evidence", [
      option("batch"), option("actor")
    ]);
    console.log(JSON.stringify({ batchId: option("batch"), status: "deleted", ...result.rows[0].evidence }));
  }
} finally {
  await client.end();
}
