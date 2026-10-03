import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyMigrations, readMigrations } from "../scripts/migrate.mjs";

class FakeClient {
  constructor(applied = []) {
    this.applied = new Map(applied);
    this.queries = [];
    this.pending = null;
  }

  async query(sql, parameters = []) {
    const normalized = sql.trim().toLowerCase();
    this.queries.push({ sql, parameters });
    if (normalized.startsWith("select history.version, checksums.checksum")) {
      return { rows: [...this.applied].map(([version, checksum]) => ({ version, checksum })) };
    }
    if (normalized === "begin") this.pending = [];
    if (normalized === "rollback") this.pending = null;
    if (normalized === "commit") {
      for (const [version, checksum] of this.pending ?? []) this.applied.set(version, checksum);
      this.pending = null;
    }
    if (normalized.startsWith("insert into supabase_migrations.schema_migrations")) {
      this.pending.push([parameters[0], null]);
    }
    if (normalized.startsWith("insert into open_triage_deploy.migration_checksums")) {
      this.pending[this.pending.length - 1][1] = parameters[1];
    }
    if (sql.includes("raise_migration_failure")) throw new Error("synthetic migration failure");
    return { rows: [] };
  }
}

const silentLog = { info() {} };
const repositoryMigrations = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));

async function migrationSet(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "open-triage-migrations-"));
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(path.join(directory, name), sql)));
  return readMigrations(directory);
}

test("repository migration versions are globally unique", async () => {
  const migrations = await readMigrations(repositoryMigrations);
  assert.equal(new Set(migrations.map(({ version }) => version)).size, migrations.length);
});

test("duplicate migration versions fail before any migration can run", async () => {
  await assert.rejects(migrationSet({
    "20260917110000_first.sql": "select 'first';",
    "20260917110000_second.sql": "select 'second';",
  }), /Duplicate migration version: 20260917110000/);
});

test("migrations run in version order before rollout", async () => {
  const migrations = await migrationSet({
    "202608300003_third.sql": "select 'third migration';",
    "202608300001_first.sql": "select 'first migration';",
    "202608300002_second.sql": "select 'second migration';",
  });
  const client = new FakeClient();
  const messages = [];

  await applyMigrations(client, migrations, { info(message) { messages.push(message); } });

  const executed = client.queries.map(({ sql }) => sql).filter((sql) => sql.includes("migration';"));
  assert.deepEqual(executed, ["select 'first migration';", "select 'second migration';", "select 'third migration';"]);
  assert.deepEqual([...client.applied.keys()], ["202608300001", "202608300002", "202608300003"]);
  assert.deepEqual(messages.slice(0, 3), [
    "Waiting for the deployment migration lock",
    "Acquired the deployment migration lock",
    "Applying migration 202608300001_first",
  ]);
});

test("a failed migration rolls back, is not recorded, and stops later migrations", async () => {
  const migrations = await migrationSet({
    "202608300001_first.sql": "select 'first migration';",
    "202608300002_failure.sql": "select raise_migration_failure();",
    "202608300003_never.sql": "select 'never migration';",
  });
  const client = new FakeClient();

  await assert.rejects(applyMigrations(client, migrations, silentLog), /202608300002_failure failed/);

  assert.deepEqual([...client.applied.keys()], ["202608300001"]);
  assert.ok(client.queries.some(({ sql }) => sql.trim().toLowerCase() === "rollback"));
  assert.ok(!client.queries.some(({ sql }) => sql.includes("never migration")));
});

test("completed migrations are safe to rerun and changed history is rejected", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([[migrations[0].version, migrations[0].checksum]]);

  await applyMigrations(client, migrations, silentLog);
  assert.ok(!client.queries.some(({ sql }) => sql.includes("first migration")));

  client.applied.set(migrations[0].version, "0".repeat(64));
  await assert.rejects(applyMigrations(client, migrations, silentLog), /has been modified/);
});

test("the known transaction-only role migration amendment preserves immutable history", async () => {
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const migration = migrations.find(({ version }) => version === "20260912120000");
  assert.equal(migration?.checksum, "a94e7492463a45e29089d56e0e1d8c46a31f544efe9af4ea93eabf7e60feeeed");
  const legacyChecksum = "de083488ce021a6cfd2333603b5e8e3da700553bc8f024840e3dd5c3b9ff4534";
  const client = new FakeClient([[migration.version, legacyChecksum]]);
  const messages = [];

  await applyMigrations(client, [migration], { info(message) { messages.push(message); } });

  assert.equal(client.applied.get(migration.version), legacyChecksum, "the recorded checksum must not be rewritten");
  assert.ok(messages.some((message) => message.includes("compatible legacy checksum verified")));
});

test("the portable offline-recovery role amendment preserves immutable history", async () => {
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const migration = migrations.find(({ version }) => version === "20260917113000");
  assert.equal(migration?.checksum, "2e238c1a9b0a60e0d0bda9fb770953cbd5b8d5eda7cd0294233eae1b93e03979");
  const legacyChecksum = "68fd47193095252e953fbeff93b5d55b1ee4aae2de95ee0f73809bd06792c926";
  const client = new FakeClient([[migration.version, legacyChecksum]]);
  const messages = [];

  await applyMigrations(client, [migration], { info(message) { messages.push(message); } });

  assert.equal(client.applied.get(migration.version), legacyChecksum, "the recorded checksum must not be rewritten");
  assert.ok(messages.some((message) => message.includes("compatible legacy checksum verified")));
});

test("the portable offline-completion role amendment preserves immutable history", async () => {
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const migration = migrations.find(({ version }) => version === "20260917210000");
  assert.equal(migration?.checksum, "28fa73f4c42fd059e2a7158eb307a128587cb45bb41038ce6a794969b9682b6d");
  const legacyChecksum = "14062abc56f142bf24325219351bb72c58f8bf7e1ed2788af10c93a45d484a02";
  const client = new FakeClient([[migration.version, legacyChecksum]]);
  const messages = [];

  await applyMigrations(client, [migration], { info(message) { messages.push(message); } });

  assert.equal(client.applied.get(migration.version), legacyChecksum, "the recorded checksum must not be rewritten");
  assert.ok(messages.some((message) => message.includes("compatible legacy checksum verified")));
});

test("the portable offline-lifecycle role amendment preserves immutable history", async () => {
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const migration = migrations.find(({ version }) => version === "20260917220000");
  assert.equal(migration?.checksum, "ac4d01e02e24bcc04d8f4399cd9b5ab8247e39a83fa745a16b09bc3f48b22d67");
  const legacyChecksum = "08938dfa65fa27d4995a63b410c6aefe821c352177a41e52d7a90c6af1e2d2b3";
  const client = new FakeClient([[migration.version, legacyChecksum]]);
  const messages = [];

  await applyMigrations(client, [migration], { info(message) { messages.push(message); } });

  assert.equal(client.applied.get(migration.version), legacyChecksum, "the recorded checksum must not be rewritten");
  assert.ok(messages.some((message) => message.includes("compatible legacy checksum verified")));
});

test("portable media role amendments preserve immutable migration history", async () => {
  const migrations = await readMigrations(path.resolve(import.meta.dirname, "../../../supabase/migrations"));
  const expected = new Map([
    ["20260924093945", [
      "e3e817e9af9f02ad9c6bf9b7e03b46a4b15f270b4c93a1ff00f669752147b944",
      "768a78853408d97d5067162001123a41e7ca489ebe4312e952c7c2af51e090ff",
    ]],
    ["20260924140000", [
      "2fe89f68c1eb848eb9c29543598229518835e55b937ff9fa08730a45123a4245",
      "aef7c4d2b6c6cff3122d5398e2afbd75dcae2a161dd9b8a888c4bd10f5aafaf2",
    ]],
    ["20260924144000", [
      "8edb06193f60477cf3fadbe6aa83b15be299da939c522d1c40af397657dbdcd2",
      "2d40ec5cde635087833daf16222ed0b68de13fbc60870c8e1d21d0834fec2f5b",
    ]],
    ["20260924150000", [
      "176836305b05dcab49dbac62ba2634314dd01eec6eb1290fd72cf9d4669e1591",
      "23e65ad273a8fda571bb06d28ff71bc51de4ee5311943e01af75258b4adbb3be",
    ]],
    ["20260924151000", [
      "56ff86c7b6e21515ec7c205984afd43712c68ef99675f1c40235ac715e100f0f",
      "9947d86356a691e9cc25806a1fe73f35b0f805df1ed160434b25192403001bce",
    ]],
    ["20260924160000", [
      "b44deed4e702d5c88692e020c618bcaac35bced3e7d6c8baa6fe65f77c29fd1b",
      "f6228220ad3e6f2fdf427e01dd006ad7963e86ab3fdcb41f7afb48844253170a",
    ]],
  ]);

  for (const [version, [legacyChecksum, currentChecksum]] of expected) {
    const migration = migrations.find((candidate) => candidate.version === version);
    assert.equal(migration?.checksum, currentChecksum);
    const client = new FakeClient([[version, legacyChecksum]]);
    const messages = [];
    await applyMigrations(client, [migration], { info(message) { messages.push(message); } });
    assert.equal(client.applied.get(version), legacyChecksum, "the recorded checksum must not be rewritten");
    assert.ok(messages.some((message) => message.includes("compatible legacy checksum verified")));
  }
});

test("migration history previously written by the Supabase CLI is respected", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([[migrations[0].version, null]]);

  await applyMigrations(client, migrations, silentLog);

  assert.ok(!client.queries.some(({ sql }) => sql.includes("first migration")));
  assert.equal(client.applied.get(migrations[0].version), null);
});

test("an older application tolerates unknown forward migrations without reverting them", async () => {
  const migrations = await migrationSet({ "202608300001_first.sql": "select 'first migration';" });
  const client = new FakeClient([
    [migrations[0].version, migrations[0].checksum],
    ["202608309999", "f".repeat(64)],
  ]);

  await applyMigrations(client, migrations, silentLog);

  assert.equal(client.applied.get("202608309999"), "f".repeat(64));
  assert.ok(!client.queries.some(({ sql }) => /delete|update/i.test(sql)));
});


test("portable Review revokes preserve applied checksums and reject unrelated edits", async () => {
  const migrations = await readMigrations(repositoryMigrations);
  const expected = [
  [
    "20261002120000",
    "2fb0dc3e1670662eb6bce33967db23cdd3a0025b998efc644f58b397a0b40e61",
    "d45b66b2f9435917b144baefbe2fb464f0c0ab00f116f1454789fc3d895731bc"
  ],
  [
    "20261002130000",
    "e8baa0838c366b1a2edcc7bca8564a988ec0cce1c735ca7354f4da085f73e856",
    "19082b9b0c590aecee96911ce47ff92cd5706fa6e1732a6461738c852b091d1e"
  ],
  [
    "20261002180000",
    "cdbd5c0dffe3ad75eb9b850b75007030b91d5f5c9867559eec5c9dfdc82273bd",
    "6b3c2d561747c2e2e0ca262e15b7c1400b97aa5c098810ebc304d6d69b461bc9"
  ],
  [
    "20261002190000",
    "a341b6742cd379fd314ee20ac1a57d7c964f32512f09f28423787f5d463cba3c",
    "c9d5c8cfec4bad632c0a25f07cf05c8a32608eadae19719a7b2e25fb7dd472b1"
  ],
  [
    "20261002230000",
    "80d01b446a437628afa62af7ef562d27034e7afae960c748427e4ede20281a99",
    "04c21fa8ea8f7d1eebfdf53c41608926e2ce20b7f082daea0a476ccba29d5a76"
  ],
  [
    "20261002260000",
    "d963d74efb42224eebace81356d445bc41a0e1af7c9d2122381073c6c8880c58",
    "6ac484ec5f6214ac28c0cfee15db2e4be0408e99569b38d87e0e4658049a585b"
  ],
  [
    "20261002290000",
    "9dc0cb383e2350c165409c56e86efd3378789fdcd084e7ee5ddab4b59e2bbd71",
    "0827f66f7d354233f8f0fb2d71761d1306cf247c680119c03a7281ddfe643aab"
  ],
  [
    "20261002300000",
    "7208ae35f0d373e4d491173da820a2e41cbbcc122e4d17e89fa965561ade57aa",
    "2fbd8bec7f68bfec323a0dfb80ac9d82e685f6110aa6a21027155fa582e72cbc"
  ],
  [
    "20261002202737",
    "59d66301e77d60cb458d3bb2d0b94aa747debc5342aff87d20f7fb951ad181c9",
    "82f8bee7d5d7efc658a19ab8ae2df9371ea83e1c355c193235c2e3d2a435fc46"
  ]
];
  for (const [version, oldChecksum, currentChecksum] of expected) {
    const migration = migrations.find((entry) => entry.version === version);
    assert.equal(migration?.checksum, currentChecksum);
    const client = new FakeClient([[version, oldChecksum]]);
    await applyMigrations(client, [migration], silentLog);
    assert.equal(client.applied.get(version), oldChecksum);
    assert.ok(!client.queries.some(({ sql }) => sql === migration.sql));
    await assert.rejects(applyMigrations(client, [{ ...migration, checksum: "0".repeat(64) }], silentLog), /has been modified/);
  }
});
