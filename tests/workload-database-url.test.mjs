import assert from "node:assert/strict";
import test from "node:test";
import {
  databaseUrlForLogin,
  normalizeWorkloadDatabaseUrl,
} from "../scripts/workload-database-url.mjs";

const login = "open_triage_demo_api_012345abcdef";
const password = "a+/ password with reserved characters";

test("preserves Supabase shared-pooler project routing for a custom role", () => {
  const result = new URL(databaseUrlForLogin(
    "postgresql://postgres.projectref:owner@aws-0-eu.pooler.supabase.com:5432/postgres?sslmode=require",
    login,
    password,
  ));
  assert.equal(decodeURIComponent(result.username), `${login}.projectref`);
  assert.equal(decodeURIComponent(result.password), password);
  assert.equal(result.searchParams.get("sslmode"), "require");
});

test("leaves direct and dedicated-pooler usernames unsuffixed", () => {
  for (const template of [
    "postgresql://postgres:owner@db.projectref.supabase.co:5432/postgres",
    "postgresql://postgres:owner@db.projectref.supabase.co:6543/postgres",
  ]) {
    assert.equal(decodeURIComponent(new URL(
      databaseUrlForLogin(template, login, password),
    ).username), login);
  }
});

test("repairs and then preserves an existing shared-pooler workload URL", () => {
  const template = "postgresql://postgres.projectref:owner@aws-0-eu.pooler.supabase.com:5432/postgres";
  const broken = `postgresql://${login}:workload@aws-0-eu.pooler.supabase.com:5432/postgres`;
  const repaired = normalizeWorkloadDatabaseUrl(template, broken);
  assert.equal(decodeURIComponent(new URL(repaired).username), `${login}.projectref`);
  assert.equal(normalizeWorkloadDatabaseUrl(template, repaired), repaired);
});

test("rejects a shared-pooler template without a project reference", () => {
  assert.throws(() => databaseUrlForLogin(
    "postgresql://postgres:owner@aws-0-eu.pooler.supabase.com:5432/postgres",
    login,
    password,
  ), /missing its project reference/);
});
