import assert from "node:assert/strict";
import test from "node:test";
import {
  ReviewContextError, parseContextArguments, resolveReviewConnection, runWithContext,
} from "../scripts/feedback-review-context.mjs";

const localUrl = "postgresql://local-reviewer:secret@127.0.0.1:54322/postgres";
const demoUrl = "postgresql://demo-reviewer:secret@aws-0-eu-north-1.pooler.supabase.com:5432/postgres";

test("context arguments retain every guarded feedback workflow command", () => {
  for (const command of ["list", "list-open", "show", "propose", "dry-run", "apply", "bulk-dry-run", "bulk-apply"]) {
    const parsed = parseContextArguments(["--instance", "public-demo", command, "--format", "text"]);
    assert.equal(parsed.instance, "public-demo");
    assert.deepEqual(parsed.reviewArguments, [command, "--format", "text"]);
  }
  assert.throws(() => parseContextArguments(["--instance", "production", "list"]), ReviewContextError);
  assert.throws(() => parseContextArguments(["--instance", "local", "anything"]), ReviewContextError);
});

test("public demo resolution requires the exact cluster and dedicated Secret", () => {
  const calls = [];
  const exec = (_file, args) => {
    calls.push(args);
    if (args[0] === "config") return "do-ams3-k8s-open-triage-demo\n";
    return Buffer.from(demoUrl).toString("base64");
  };
  assert.equal(resolveReviewConnection("public-demo", { env: {}, exec }), demoUrl);
  assert.deepEqual(calls[1], [
    "get", "secret", "open-triage-feedback-reviewer", "--namespace", "open-triage",
    "-o", "jsonpath={.data.FEEDBACK_REVIEW_DATABASE_URL}",
  ]);
  assert.throws(() => resolveReviewConnection("public-demo", {
    env: {}, exec: () => "unrelated-cluster\n",
  }), /does not target/);
  assert.throws(() => resolveReviewConnection("public-demo", {
    env: { FEEDBACK_REVIEW_DATABASE_URL: demoUrl },
    exec: () => "unrelated-cluster\n",
  }), /does not target/);
});

test("local resolution reads only the selected local database configuration", () => {
  assert.equal(resolveReviewConnection("local", {
    env: {}, root: "/repo", read: (file) => {
      assert.equal(file, "/repo/.env.local");
      return `DATABASE_URL=${localUrl}\nSUPABASE_SECRET_KEY=must-not-be-read\n`;
    },
  }), localUrl);
  assert.throws(() => resolveReviewConnection("local", {
    env: { FEEDBACK_REVIEW_DATABASE_URL: demoUrl },
  }), /does not target localhost/);
});

test("the connection is passed only in the child environment and never in arguments", () => {
  let invocation;
  const status = runWithContext(["--instance", "public-demo", "apply", "--confirm-bulk"], {
    env: {},
    exec: (_file, args) => args[0] === "config"
      ? "do-ams3-k8s-open-triage-demo\n"
      : Buffer.from(demoUrl).toString("base64"),
    spawn: (file, args, options) => {
      invocation = { file, args, options };
      return { status: 4 };
    },
  });
  assert.equal(status, 4);
  assert.equal(invocation.options.env.FEEDBACK_REVIEW_DATABASE_URL, demoUrl);
  assert.equal(invocation.args.join(" ").includes(demoUrl), false);
  assert.equal(invocation.options.stdio, "inherit");
});
