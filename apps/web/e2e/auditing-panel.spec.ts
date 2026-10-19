import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { auditCategories } from "@open-triage/contracts";

let script: string, css: string;
const actor = "10000000-0000-4000-8000-000000000001";
const target = "20000000-0000-4000-8000-000000000001";
const session = { user: { id: actor, displayName: "Auditor" }, organization: { id: target, name: "Example EMS" },
  startedAt: "2026-10-17T10:00:00Z", expiresAt: "2099-01-01T00:00:00Z", capabilities: ["audit:read", "audit:identifying"] };
const eventId = (index: number) => `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const entry = { id: eventId(1), category: "authentication", source: "app_identity.authentication_event", occurredAt: "2026-10-17T10:00:00Z",
  actorId: actor, actorUsername: "audit.clinician", actorDisplayName: "Audit Clinician",
  action: "authentication.sign_in", outcome: "succeeded", targetId: target,
  target: { kind: "user", label: "Target Clinician" },
  patientId: null, accessOrganizationId: null, careProcess: null };

function auditPage<T extends { entries: unknown[]; nextCursor: string | null; totalEntries?: number; pageNumber?: number }>(page: T) {
  const totalEntries = page.totalEntries ?? (page.nextCursor ? 51 : page.entries.length);
  return { ...page, totalEntries, totalPages: Math.ceil(totalEntries / 50), pageNumber: page.pageNumber ?? (totalEntries ? 1 : 0) };
}

async function selectTypes(page: Page, names: string[], language = "en") {
  const filter = page.locator(".audit-type-filter");
  if (!await filter.evaluate(element => (element as HTMLDetailsElement).open)) await filter.locator("summary").click();
  for (const checkbox of await filter.getByRole("checkbox").all()) await checkbox.uncheck();
  for (const name of names) await filter.getByRole("checkbox", { name, exact: true }).check();
  await page.locator(".audit-panel").getByRole("button", { name: language === "sv" ? "Tillämpa filter" : "Apply filters", exact: true }).click();
}

test.beforeAll(async () => {
  css = await readFile(path.resolve(__dirname, "../app/styles.css"), "utf8");
  const result = await build({ bundle: true, write: false, jsx: "automatic", format: "iife", platform: "browser",
    define: { "process.env": JSON.stringify({ NEXT_PUBLIC_API_URL: "same-origin" }) },
    stdin: { resolveDir: path.resolve(__dirname, ".."), loader: "tsx", contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { AdminShell } from './components/admin-shell';
      const language = new URLSearchParams(location.search).get('language') || 'en';
      createRoot(document.getElementById('root')).render(<div className="admin-shell">
        <AdminShell session={${JSON.stringify(session)}} language={language}/></div>);
    ` } });
  script = result.outputFiles[0]!.text;
});

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => { throw error; });
  await page.route("**/__audit-script", route => route.fulfill({ contentType: "text/javascript", body: script }));
  await page.route("**/__audit?*", route => route.fulfill({ contentType: "text/html", body:
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
    :root { --green:#65449b; --green-dark:#45266e; --inactive-button:#f4f0f8; --text-color:#251637; }</style></head>
    <body><div id="root"></div><script src="/__audit-script"></script></body></html>` }));
  await page.route("**/api/admin/context", route => route.fulfill({ json: {
    organization: session.organization, panels: ["auditing"], capabilities: session.capabilities,
    dashboard: null, activeConfiguration: null,
  } }));
  await page.route("**/api/admin/audit/users*", route => route.fulfill({ json: {
    users: [{ id: actor, displayName: entry.actorDisplayName }], nextCursor: null,
  } }));
});

test("combined audit filters, paging and failure recovery preserve results until access is revoked", async ({ page }) => {
  let failure = 0;
  const requests: URL[] = [];
  await page.route("**/api/admin/audit?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    if (failure) return route.fulfill({ status: failure, json: { code: "platform.unavailable" } });
    const next = !!url.searchParams.get("cursor");
    return route.fulfill({ json: auditPage({ categories: auditCategories, pageNumber: next ? 2 : 1, totalEntries: 51, entries: [{ ...entry, id: eventId(next ? 2 : 1),
      action: next ? "authentication.sign_out" : `${url.searchParams.get("categories") || "all"}.event` }], nextCursor: next ? null : "page-2" }) });
  });
  await page.goto("/__audit?language=en");
  await expect(page.getByRole("heading", { name: "Audit logs", exact: true })).toBeVisible();
  const panel = page.locator(".audit-panel");
  await expect(panel.locator(".audit-type-filter summary")).toHaveText("Log types: All logs");
  expect(requests[0]?.searchParams.get("categories")).toBe("");
  await expect(panel.getByRole("columnheader", { name: "Log type", exact: true })).toBeVisible();
  await expect(panel.getByText("all.event", { exact: true })).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "Display name", exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: entry.actorDisplayName, exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: entry.actorUsername, exact: true })).toHaveCount(0);
  await expect(panel.getByRole("columnheader", { name: "Target", exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "User: Target Clinician", exact: true })).toBeVisible();
  await expect(panel.getByRole("cell", { name: target, exact: true })).toHaveCount(0);
  await expect(panel.getByText(actor, { exact: true })).toHaveCount(0);
  await expect(panel.getByRole("columnheader", { name: "Actions", exact: true })).toHaveCount(0);
  await expect(panel.locator("tbody button")).toHaveCount(0);
  await panel.getByRole("combobox", { name: "User", exact: true }).selectOption({ label: entry.actorDisplayName });
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("actorId")).toBe(actor);
  await panel.getByRole("button", { name: "Next page" }).click();
  await expect(panel.getByText("authentication.sign_out", { exact: true })).toBeVisible();
  await panel.getByRole("row", { name: "Inspect authentication.sign_out", exact: true }).click();
  await expect(panel.getByRole("dialog", { name: "Event details" })).toContainText("app_identity.authentication_event");
  await expect(panel.getByRole("dialog")).toContainText(entry.actorDisplayName);
  await expect(panel.getByRole("dialog")).not.toContainText(entry.actorUsername);
  await expect(panel.locator(".audit-event-summary")).not.toContainText(actor);
  await expect(panel.getByRole("dialog")).toContainText("User: Target Clinician");
  await panel.getByText("Identifiers", { exact: true }).click();
  await expect(panel.getByRole("dialog").locator("dl > div").filter({ has: page.getByText("Target ID", { exact: true }) }).locator("dd")).toHaveText(target);
  await panel.getByRole("button", { name: "Close details" }).click();
  await expect(panel.getByRole("row", { name: "Inspect authentication.sign_out", exact: true })).toBeFocused();
  await expect(panel.getByRole("combobox", { name: "User", exact: true })).toHaveValue(actor);
  failure = 503;
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect(panel.getByRole("alert")).toContainText("Previously loaded results remain");
  await expect(panel.getByText("authentication.sign_out", { exact: true })).toBeVisible();
  await expect(panel.locator(".audit-results-label")).toContainText("All logs");
  await selectTypes(page, ["Patient access", "Media access"]);
  await expect(panel.getByRole("alert")).toContainText("Previously loaded results remain");
  await expect(panel.getByText("authentication.sign_out", { exact: true })).toBeVisible();
  await expect(panel.locator(".audit-results-label")).toContainText("All logs");
  failure = 0;
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.getByText("patient,media.event", { exact: true })).toBeVisible();
  await page.route("**/api/admin/context", route => route.fulfill({ json: {
    organization: session.organization, panels: ["auditing"], capabilities: ["audit:read"], dashboard: null, activeConfiguration: null,
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(panel.getByRole("checkbox", { name: "Patient access", exact: true })).toHaveCount(0);
  await expect(panel.getByText("patient,media.event", { exact: true })).toHaveCount(0);
  await expect(panel.getByText("all.event", { exact: true })).toBeVisible();
  failure = 403;
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByRole("table")).toHaveCount(0);
});

test("audit actor labels prefer display names and preserve unnamed historical events", async ({ page }) => {
  const cases = [
    { actorId: actor, actorUsername: "sso.clinician", actorDisplayName: "SSO Clinician", label: "SSO Clinician" },
    { actorId: actor, actorUsername: null, actorDisplayName: "Regional Clinician", label: "Regional Clinician" },
    { actorId: actor, actorUsername: "retained.username", actorDisplayName: null, label: "retained.username" },
    { actorId: actor, actorUsername: null, actorDisplayName: null, label: actor },
    { actorId: null, actorUsername: null, actorDisplayName: null, label: "Not recorded" },
  ];
  await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
    entries: cases.map((value, index) => ({ ...entry, ...value, id: eventId(index), action: `event.${index}` })), nextCursor: null }) }));
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel");
  for (const [index, value] of cases.entries()) {
    await expect(panel.locator("tbody tr").nth(index).locator("td").nth(3)).toHaveText(value.label);
    await panel.getByRole("row", { name: `Inspect event.${index}`, exact: true }).click();
    await expect(panel.getByRole("dialog").locator("dl > div").filter({ has: page.getByText("Display name", { exact: true }) }).locator("dd")).toHaveText(value.label);
    await panel.getByRole("button", { name: "Close details" }).click();
  }
});

for (const language of ["en", "sv"]) {
  test(`${language} event IDs and inspection targets omit source prefixes`, async ({ page }) => {
    const swedish = language === "sv";
    const references = [`feedback.submission:${eventId(100)}`, `feedback.review_event:${eventId(101)}`, `clinical.report_change:${target}`];
    await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
      entries: [...references.map((reference, index) => ({ ...entry, id: eventId(index + 1),
        source: "clinical_audit.audit_read_event", action: `audit.event.${index}`,
        targetId: reference.split(":")[1], target: { kind: "auditEvent", label: reference },
        inspection: { kind: index === 2 ? "clinical-values" : "payload", category: index === 2 ? "clinical" : "feedback" },
      })), { ...entry, id: eventId(4), source: "clinical_audit.audit_read_event", action: "audit.list",
        targetId: target, target: { kind: "record", label: null }, inspection: { kind: "list", category: "authentication" },
      }, { ...entry, id: eventId(5), category: "audit", source: "clinical_audit.audit_read_event", action: "audit.combined.list",
        targetId: null, target: null, inspection: { kind: "list", category: "combined", categories: ["feedback", "analytics"], uuidFilter: target },
      }], nextCursor: null }) }));
    await page.goto(`/__audit?language=${language}`);
    const panel = page.locator(".audit-panel");
    await expect(panel.getByRole("columnheader").first()).toHaveText(swedish ? "Händelse-ID" : "Event ID");
    for (const [index, reference] of references.entries()) {
      const row = panel.locator("tbody tr").nth(index);
      await expect(row.locator("td").first()).toHaveText(eventId(index + 1));
      await expect(row.locator("td").last()).toHaveText(reference.split(":")[1]!);
      await expect(row).not.toContainText("clinical_audit.audit_read_event");
      await expect(row).not.toContainText(reference.split(":")[0]!);
      await row.locator("td").first().click();
      const dialog = panel.getByRole("dialog");
      await expect(dialog.locator("dl > div").filter({ has: page.getByText(swedish ? "Objekt" : "Target", { exact: true }) }).locator("dd")).toHaveText(reference.split(":")[1]!);
      await expect(dialog.locator("dl > div").filter({ has: page.getByText(swedish ? "Källa" : "Source", { exact: true }) }).locator("dd")).toHaveText("clinical_audit.audit_read_event");
      await page.keyboard.press("Escape");
    }
    await expect(panel.locator("tbody tr").nth(3).locator("td").last()).toHaveText(swedish ? "Lista: Autentisering" : "Authentication list");
    const combined = panel.locator("tbody tr").last();
    await expect(combined.locator("td").last()).toHaveText(swedish ? "Kombinerade loggar (2 typer)" : "Combined logs (2 types)");
    await combined.click();
    await expect(panel.getByRole("dialog").locator("dl > div").filter({ has: page.getByText(swedish ? "Sökt UUID" : "Searched UUID", { exact: true }) }).locator("dd")).toHaveText(target);
    await expect(panel.getByRole("dialog").locator("dl > div").filter({ has: page.getByText(swedish ? "Loggtyper" : "Log types", { exact: true }) }).locator("dd"))
      .toHaveText(swedish ? "Återkoppling, Analys och exporter" : "Feedback, Analytics and exports");
  });

  test(`${language} audit JSON dumps load on expansion, wrap long content and explain older queries`, async ({ page }) => {
    const swedish = language === "sv";
    let inspections = 0, fail = true;
    await page.route("**/api/admin/audit?*", route => {
      const analytics = new URL(route.request().url()).searchParams.get("categories") === "analytics";
      return route.fulfill({ json: auditPage({ categories: auditCategories,entries: [{ ...entry,
        source: analytics ? "clinical_audit.analytics_access_event" : "feedback.submission",
        id: analytics ? target : eventId(1),action: analytics ? "analytics.query" : "feedback.submit.bug" }],nextCursor: null }) });
    });
    const report = 'Complete submitted feedback: "åäö" <script>throw Error("not executable")</script> ' + "long-text-".repeat(180);
    await page.route("**/api/admin/audit/payload/**", route => {
      inspections++;
      if (fail) return route.fulfill({ status: 503,json: { code: "platform.unavailable" } });
      const analytics = route.request().url().includes("analytics_access_event");
      return route.fulfill({ json: analytics ? { kind: "analytics",requestCaptured: false,payload: { request: null,operation: "query" } }
        : { kind: "feedback",payload: { submission: { description: report },diagnostics: { status: "not-retained" } } } });
    });
    await page.goto(`/__audit?language=${language}`);
    const panel = page.locator(".audit-panel");
    await selectTypes(page, [swedish ? "Återkoppling" : "Feedback"], language);
    await panel.locator("tbody tr").first().click();
    const dialog = panel.getByRole("dialog"), show = dialog.getByRole("button", { name: swedish ? "Visa JSON-dump" : "Show JSON dump" });
    expect(inspections).toBe(0);
    await show.click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    fail = false;
    await dialog.getByRole("button", { name: swedish ? "Försök igen" : "Retry",exact: true }).click();
    const json = dialog.locator(".audit-event-dump pre");
    await expect(json).toContainText("Complete submitted feedback");
    expect(JSON.parse(await json.innerText()).submission.description).toBe(report);
    expect(inspections).toBe(2);
    await page.setViewportSize({ width: 390,height: 900 });
    await json.evaluate(element => { element.style.fontSize = "24px"; });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await dialog.getByRole("button", { name: swedish ? "Dölj JSON-dump" : "Hide JSON dump" }).click();
    await expect(json).toHaveCount(0);
    await page.keyboard.press("Escape");
    await selectTypes(page, [swedish ? "Analys och exporter" : "Analytics and exports"], language);
    await expect(panel.locator("tbody tr").first()).toContainText("analytics.query");
    await panel.locator("tbody tr").first().click();
    await show.click();
    await expect(dialog.getByRole("status")).toContainText(swedish ? "sparades inte" : "was not captured");
    await expect(json).toContainText('"request": null');
  });
}

test("payload responses are discarded when their dialog closes and revoked access clears the event", async ({ page }) => {
  await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
    entries: [{ ...entry,source: "feedback.submission" }],nextCursor: null }) }));
  let release: (() => Promise<void>) | undefined;
  await page.route("**/api/admin/audit/payload/**", route => {
    release = () => route.fulfill({ json: { kind: "feedback",payload: { description: "Late private feedback" } } });
  });
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel");
  await panel.locator("tbody tr").first().click();
  await panel.getByRole("button", { name: "Show JSON dump" }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.keyboard.press("Escape");
  await release!();
  await panel.locator("tbody tr").first().click();
  await expect(panel.locator("pre")).toHaveCount(0);
  await page.route("**/api/admin/audit/payload/**", route => route.fulfill({ status: 403,json: { code: "denied" } }));
  await panel.getByRole("button", { name: "Show JSON dump" }).click();
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await expect(panel.getByRole("table")).toHaveCount(0);
  await expect(panel.getByText("Late private feedback")).toHaveCount(0);
});

for (const language of ["en", "sv"]) {
  test(`${language} targets display typed names, versions and retained-record references with optional identifiers`, async ({ page }) => {
    const swedish = language === "sv";
    const cases = [
      { target: { kind: "report", label: "PCR-000012345" }, expected: `${swedish ? "Patientjournal" : "PCR"}: PCR-000012345` },
      { target: { kind: "form", label: "Ambulance form", version: 3 }, expected: `${swedish ? "Formulär" : "Form"}: Ambulance form (version 3)` },
      { target: { kind: "unit", label: "A-12 · North" }, expected: `${swedish ? "Enhet" : "Unit"}: A-12 · North` },
      { target: { kind: "analytics", label: "analytics.query", occurredAt: entry.occurredAt }, expected: `${swedish ? "Analysfråga" : "Analytics query"}: analytics.query` },
      { target: { kind: "report", label: null }, expected: `${swedish ? "Patientjournal" : "PCR"} · 20000000` },
      { target: undefined, expected: `${swedish ? "Post" : "Record"} · 20000000` },
      { target: null, targetId: null, expected: swedish ? "Inte registrerat" : "Not recorded" },
    ];
    await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
      entries: cases.map((value, index) => ({ ...entry, ...value, id: eventId(index), action: `event.${index}` })), nextCursor: null }) }));
    await page.goto(`/__audit?language=${language}`);
    const panel = page.locator(".audit-panel");
    for (const [index, value] of cases.entries()) {
      const row = panel.locator("tbody tr").nth(index);
      await expect(row.locator("td").last()).toHaveText(value.expected);
      await expect(row.locator("time")).toHaveAttribute("datetime", entry.occurredAt);
      await row.click();
      const dialog = panel.getByRole("dialog");
      await expect(dialog.locator("dl > div").filter({ has: page.getByText(swedish ? "Objekt" : "Target", { exact: true }) }).locator("dd")).toHaveText(value.expected);
      if (value.targetId !== null) {
        const identifier = dialog.locator(".audit-identifiers dd").filter({ hasText: target });
        await expect(identifier).not.toBeVisible();
        await dialog.locator("summary").click();
        await expect(identifier).toBeVisible();
      }
      await page.keyboard.press("Escape");
    }
  });
}

for (const language of ["en", "sv"]) {
  test(`${language} audit details prefer agency and resource labels while retaining precise identifiers`, async ({ page }) => {
    const swedish = language === "sv", secondAgency = "30000000-0000-4000-8000-000000000001";
    const missingAgency = "40000000-0000-4000-8000-000000000001", patient = "50000000-0000-4000-8000-000000000001";
    const analytics = { dataset: "synthetic", from: null, through: null, reportCount: 1,
      reportScope: "all", identifying: true, organizationIds: [target, secondAgency, missingAgency],
      organizations: [{ id: secondAgency, name: "South EMS" }, { id: target, name: "North EMS" }, { id: missingAgency, name: null }] };
    await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories, nextCursor: null,
      entries: [{ ...entry, source: "clinical_audit.patient_access_event", action: "analytics.query",
        target: { kind: "report", label: "PCR-123" }, patientId: patient, accessOrganizationId: secondAgency,
        accessOrganizationName: "South EMS", resourceId: actor,
        resource: { kind: "analytics", label: "analytics.query", occurredAt: entry.occurredAt }, analytics }] }) }));
    await page.goto(`/__audit?language=${language}`);
    await page.locator("tbody tr").first().click();
    const dialog = page.getByRole("dialog"), summary = dialog.locator(".audit-event-summary");
    const field = (name: string) => summary.locator("div").filter({ has: page.getByText(name, { exact: true }) }).locator("dd");
    await expect(field(swedish ? "Sökta organisationer" : "Agencies queried")).toHaveText(swedish
      ? "Organisation: North EMS, Organisation: South EMS, Organisation · 40000000"
      : "Agency: North EMS, Agency: South EMS, Agency · 40000000");
    await expect(field(swedish ? "Åtkommande organisation" : "Accessing agency")).toContainText("South EMS");
    await expect(field("Patient")).toHaveText(swedish ? "Patient i journal PCR-123" : "Patient in report PCR-123");
    await expect(field(swedish ? "Relaterad händelse eller media" : "Related event or media")).toContainText("analytics.query");
    await expect(field(swedish ? "Relaterad händelse eller media" : "Related event or media")).not.toContainText("UTC");
    for (const id of [target, secondAgency, missingAgency, patient, actor]) await expect(summary).not.toContainText(id);
    await dialog.locator("summary").click();
    for (const id of [target, secondAgency, missingAgency, patient, actor]) await expect(dialog.locator(".audit-identifiers")).toContainText(id);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.evaluate(element => { element.style.fontSize = "24px"; });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

test("user dropdown loads further display names, retries failures and applies or clears account IDs", async ({ page }) => {
  const secondActor = "10000000-0000-4000-8000-000000000002";
  const requests: URL[] = [];
  let usersFailure = 0;
  let delayAudit = false;
  let releaseAudit: (() => Promise<void>) | undefined;
  await page.route("**/api/admin/audit/users*", route => {
    if (usersFailure) return route.fulfill({ status: usersFailure, json: { code: "platform.unavailable" } });
    const next = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { users: next ? [{ id: secondActor, displayName: "Zoe Clinician" }]
      : [{ id: actor, displayName: "Alex Clinician" }], nextCursor: next ? "final-users" : "next-users" } });
  });
  await page.route("**/api/admin/audit?*", route => {
    requests.push(new URL(route.request().url()));
    const respond = () => route.fulfill({ json: auditPage({ categories: auditCategories, entries: [entry], nextCursor: null }) });
    if (delayAudit) { releaseAudit = respond; return; }
    return respond();
  });
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel"), select = panel.getByRole("combobox", { name: "User", exact: true });
  await select.selectOption({ label: "Alex Clinician" });
  usersFailure = 503;
  await panel.getByRole("button", { name: "Load more users" }).click();
  await expect(panel.locator(".audit-user-filter").getByRole("alert")).toContainText("Users could not be loaded");
  await expect(select).toHaveValue(actor);
  await expect(select.getByRole("option", { name: "Alex Clinician", exact: true })).toHaveCount(1);
  usersFailure = 0;
  await panel.locator(".audit-user-filter").getByRole("button", { name: "Retry" }).click();
  await select.selectOption({ label: "Zoe Clinician" });
  await expect(select.getByRole("option")).toHaveText(["All users", "Alex Clinician", "Zoe Clinician"]);
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("actorId")).toBe(secondActor);
  await select.selectOption({ label: "All users" });
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.has("actorId")).toBe(false);
  delayAudit = true;
  await panel.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => !!releaseAudit).toBe(true);
  usersFailure = 403;
  await panel.getByRole("button", { name: "Load more users" }).click();
  await expect(select.getByRole("option")).toHaveText(["All users"]);
  await expect(panel.getByRole("table")).toHaveCount(0);
  const response = page.waitForResponse("**/api/admin/audit?*");
  await releaseAudit!();
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(panel.getByRole("table")).toHaveCount(0);
});

test("multiple log types share a table, retain labeled results while loading and clear back to all logs", async ({ page }) => {
  let release: (() => Promise<void>) | undefined;
  let delay = false, fail = false;
  const requests: URL[] = [];
  await page.route("**/api/admin/audit?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const selected = url.searchParams.get("categories")?.split(",").filter(Boolean) ?? [];
    const categories = selected.length ? selected : auditCategories;
    const respond = () => route.fulfill({ json: auditPage({ categories: auditCategories,
      entries: categories.map(category => ({ ...entry, category, id: eventId(auditCategories.indexOf(category as typeof auditCategories[number])), action: `${category}.only` })), nextCursor: null }) });
    if (fail) return route.fulfill({ status: 503, json: { code: "platform.unavailable" } });
    if (delay) { release = respond; return; }
    return respond();
  });
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel");
  await expect(panel.locator("tbody tr")).toHaveCount(auditCategories.length);
  delay = true;
  await selectTypes(page, ["Patient access", "Media access"]);
  await expect.poll(() => !!release).toBe(true);
  await expect(panel.locator("tbody tr")).toHaveCount(auditCategories.length);
  await expect(panel.getByText("Loading audit logs…", { exact: true })).toBeVisible();
  await expect(panel.locator(".audit-results-label")).toContainText("All logs");
  await release!(); delay = false;
  await expect(panel.locator("tbody tr")).toHaveCount(2);
  await expect(panel.locator("tbody tr td:nth-child(2)")).toHaveText(["Patient access", "Media access"]);
  await expect(panel.locator(".audit-results-label")).toContainText("Patient access, Media access");
  expect(requests.at(-1)?.searchParams.get("categories")).toBe("patient,media");
  expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
  fail = true;
  await selectTypes(page, ["Configuration"]);
  await expect(panel.getByRole("alert")).toContainText("Previously loaded results remain");
  await expect(panel.locator("tbody tr")).toHaveCount(2);
  await expect(panel.locator(".audit-results-label")).toContainText("Patient access, Media access");
  fail = false;
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(1);
  await expect(panel.getByRole("cell", { name: "configuration.only", exact: true })).toBeVisible();
  await panel.locator(".audit-type-filter summary").click();
  await panel.getByRole("button", { name: "Clear log types", exact: true }).click();
  await expect(panel.locator(".audit-type-filter input:checked")).toHaveCount(0);
  await panel.getByRole("button", { name: "Apply filters", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(auditCategories.length);
  await expect(panel.locator(".audit-results-label")).toContainText("All logs");
  expect(requests.at(-1)?.searchParams.get("categories")).toBe("");
  for (const [index] of auditCategories.entries()) {
    await expect(panel.locator("tbody tr").nth(index).locator("td").first()).toHaveText(eventId(index));
  }
});

test("audit rows open a modal with keyboard focus containment and return to the same scrolled row", async ({ page }) => {
  await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
    entries: Array.from({ length: 50 }, (_, index) => ({ ...entry, id: eventId(index), action: `event.${index}` })), nextCursor: null }) }));
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel");
  const row = panel.getByRole("row", { name: "Inspect event.30", exact: true });
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  const scrollTop = await panel.locator(".audit-table-scroll").evaluate(element => element.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  for (const key of ["Enter", "Space"]) {
    await row.press(key);
    const dialog = panel.getByRole("dialog", { name: "Event details" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
    const close = dialog.getByRole("button", { name: "Close details" });
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("region", { name: "Event details" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    if (key === "Enter") await page.keyboard.press("Escape");
    else await close.click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    expect(await panel.locator(".audit-table-scroll").evaluate(element => element.scrollTop)).toBe(scrollTop);
  }
});

test("clinical values require a separate inspection and disappear when identifying audit access is revoked", async ({ page }) => {
  let inspections = 0;
  await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
    entries: [{ ...entry, id: target, source: "clinical.report_change", action: "report.draft_save" }], nextCursor: null }) }));
  await page.route("**/api/admin/audit/clinical-values/**", route => {
    inspections++;
    return route.fulfill({ json: { values: { submittedChanges: { observations: "Fictional clinical value" } } } });
  });
  await page.goto("/__audit?language=en");
  const panel = page.locator(".audit-panel");
  await selectTypes(page, ["Clinical changes"]);
  await panel.getByRole("row", { name: "Inspect report.draft_save", exact: true }).click();
  expect(inspections).toBe(0);
  await expect(panel.getByText("Fictional clinical value", { exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "View clinical values", exact: true }).click();
  await expect(panel.locator("pre")).toContainText("Fictional clinical value");
  expect(inspections).toBe(1);
  await page.route("**/api/admin/context", route => route.fulfill({ json: {
    organization: session.organization, panels: ["auditing"], capabilities: ["audit:read", "review:identifying"], dashboard: null, activeConfiguration: null,
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(panel.locator("pre")).toHaveCount(0);
  await expect(panel.getByRole("dialog")).toHaveCount(0);
  await selectTypes(page, ["Clinical changes"]);
  await panel.getByRole("row", { name: "Inspect report.draft_save", exact: true }).click();
  await expect(panel.getByRole("button", { name: "View clinical values", exact: true })).toHaveCount(0);
  expect(inspections).toBe(1);
});

for (const language of ["en", "sv"]) {
  test(`${language} audit layout supports mobile, desktop, agency colors and enlarged text`, async ({ page }, testInfo) => {
    await page.route("**/api/admin/audit?*", route => route.fulfill({ json: auditPage({ categories: auditCategories,
      entries: Array.from({ length: 50 }, (_, index) => ({ ...entry, id: eventId(index) })), nextCursor: "page-2" }) }));
    await page.goto(`/__audit?language=${language}`);
    const panel = page.locator(".audit-panel");
    await expect(panel.getByRole("table").locator("tbody tr")).toHaveCount(50);
    await expect(panel.getByRole("columnheader", { name: language === "en" ? "Display name" : "Visningsnamn", exact: true })).toBeVisible();
    const userSelect = panel.getByRole("combobox", { name: language === "en" ? "User" : "Användare", exact: true });
    await expect(userSelect).toBeEnabled();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const filter = panel.locator(".audit-type-filter");
      await filter.locator("summary").click();
      const sections = panel.locator(".audit-type-options");
      await expect.poll(() => sections.evaluate(element => new Set([...element.children].map(button => button.getBoundingClientRect().top)).size)).toBeGreaterThan(1);
      expect(await sections.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const firstInput = panel.locator("input[type=date]").first();
      expect((await firstInput.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await userSelect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (width === 1280) {
        await filter.locator("summary").click();
        expect((await panel.locator(".audit-pagination").boundingBox())!.y).toBeLessThan(850);
        await page.screenshot({ path: testInfo.outputPath(`audit-${language}-desktop.png`) });
      } else {
        await panel.locator("button, input, select").evaluateAll(elements => elements.forEach(element => { element.style.fontSize = "24px"; }));
        expect(await sections.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await sections.evaluate(element => [...element.children].every(button => {
          const bounds = button.getBoundingClientRect(), parent = element.getBoundingClientRect();
          return bounds.left >= parent.left && bounds.right <= parent.right && bounds.bottom <= parent.bottom;
        }))).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`audit-${language}-mobile.png`), fullPage: true });
      }
      if (await filter.evaluate(element => (element as HTMLDetailsElement).open)) await filter.locator("summary").click();
      const row = panel.locator("tbody tr").first();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await row.locator("td").first().click();
      const dialog = panel.getByRole("dialog", { name: language === "en" ? "Event details" : "Händelseinformation" });
      await expect(dialog).toBeVisible();
      if (width === 390) await dialog.locator("*").evaluateAll(elements => elements.forEach(element => { element.style.fontSize = "24px"; }));
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(dialog.getByRole("button", { name: language === "en" ? "Close details" : "Stäng information" })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`audit-dialog-${language}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(row).toBeFocused();
    }
    expect(await panel.locator(".audit-type-filter summary").evaluate(element => getComputedStyle(element).borderTopColor)).toBe("rgb(101, 68, 155)");
  });
}

for (const language of ["en", "sv"]) {
  test(`${language} any UUID filter trims input, persists across pages and clears independently of the user filter`, async ({ page }) => {
    const swedish = language === "sv", requests: URL[] = [];
    await page.route("**/api/admin/audit?*", route => {
      const url = new URL(route.request().url()); requests.push(url);
      const next = url.searchParams.has("cursor");
      return route.fulfill({ json: auditPage({ categories: auditCategories, pageNumber: next ? 2 : 1, totalEntries: 51, entries: [{ ...entry,
        id: eventId(next ? 2 : 1), action: next ? "second.event" : "first.event" }], nextCursor: next ? null : "page-2" }) });
    });
    await page.goto(`/__audit?language=${language}`);
    const panel = page.locator(".audit-panel");
    const uuidFilter = panel.getByRole("textbox", { name: swedish ? "UUID (valfritt)" : "Any UUID (optional)", exact: true });
    const apply = panel.getByRole("button", { name: swedish ? "Tillämpa filter" : "Apply filters", exact: true });
    await panel.getByRole("combobox", { name: swedish ? "Användare" : "User", exact: true }).selectOption(actor);
    await uuidFilter.fill(`  ${entry.id}  `);
    await apply.click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("uuid")).toBe(entry.id);
    expect(requests.at(-1)?.searchParams.has("targetId")).toBe(false);
    expect(requests.at(-1)?.searchParams.get("actorId")).toBe(actor);
    await panel.getByRole("button", { name: swedish ? "Nästa sida" : "Next page", exact: true }).click();
    await expect(panel.getByRole("cell", { name: "second.event", exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.get("uuid")).toBe(entry.id);
    await uuidFilter.fill("   ");
    await apply.click();
    await expect(panel.getByRole("cell", { name: "first.event", exact: true })).toBeVisible();
    expect(requests.at(-1)?.searchParams.has("uuid")).toBe(false);
    expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
    expect(requests.at(-1)?.searchParams.get("actorId")).toBe(actor);
  });
}

for (const language of ["en", "sv"]) {
  test(`${language} pagination reports filtered totals and keeps the displayed page during pending or failed requests`, async ({ page }) => {
    const swedish=language==="sv";
    let fail=false, delay=true, release:(() => Promise<void>)|undefined;
    await page.route("**/api/admin/audit?*", route => {
      const params=new URL(route.request().url()).searchParams;
      if(fail) return route.fulfill({ status:503,json:{ code:"platform.unavailable" } });
      const totalEntries=params.get("uuid")===target ? 0 : params.has("uuid") ? 1 : 101;
      const pageNumber=totalEntries ? Number(params.get("cursor")?.split("-")[1] ?? 1) : 0;
      const offset=Math.max(0,pageNumber-1)*50;
      const respond=()=>route.fulfill({ json:auditPage({ categories:auditCategories,pageNumber,totalEntries,
        entries:Array.from({ length:Math.min(50,totalEntries-offset) },(_,i)=>({ ...entry,id:eventId(offset+i),action:`event.${offset+i}` })),
        nextCursor:offset+50<totalEntries ? `page-${pageNumber+1}` : null }) });
      if(delay && pageNumber===2) { release=respond; return; }
      return respond();
    });
    await page.goto(`/__audit?language=${language}`);
    const panel=page.locator(".audit-panel"), status=panel.locator(".audit-page-status");
    const number=(current:number,total:number)=>swedish ? `Sida ${current} av ${total}` : `Page ${current} of ${total}`;
    const next=panel.getByRole("button",{ name:swedish ? "Nästa sida" : "Next page",exact:true });
    const first=panel.getByRole("button",{ name:swedish ? "Första sidan" : "First page",exact:true });
    await expect(status).toContainText(number(1,3));
    await expect(status).toContainText(swedish ? "50 av 101 händelser" : "50 of 101 events");
    await next.click();
    await expect.poll(()=>!!release).toBe(true);
    await expect(status).toContainText(number(1,3));
    await release!(); delay=false;
    await expect(status).toContainText(number(2,3));
    fail=true;
    await next.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(status).toContainText(number(2,3));
    fail=false;
    await panel.getByRole("button",{ name:swedish ? "Försök igen" : "Retry",exact:true }).click();
    await expect(status).toContainText(number(3,3));
    await expect(status).toContainText(swedish ? "1 av 101 händelser" : "1 of 101 events");
    await expect(next).toBeDisabled();
    await first.click();
    await expect(status).toContainText(number(1,3));
    await expect(first).toBeDisabled();
    const uuidFilter=panel.getByRole("textbox",{ name:swedish ? "UUID (valfritt)" : "Any UUID (optional)",exact:true });
    const apply=panel.getByRole("button",{ name:swedish ? "Tillämpa filter" : "Apply filters",exact:true });
    await uuidFilter.fill(entry.id); await apply.click();
    await expect(status).toContainText(number(1,1));
    await expect(next).toBeDisabled();
    await uuidFilter.fill(target); await apply.click();
    await expect(status).toContainText(number(0,0));
    await expect(status).toContainText(swedish ? "0 av 0 händelser" : "0 of 0 events");
    await expect(first).toBeDisabled(); await expect(next).toBeDisabled();
  });
}

test("integration events and configuration changes use the audit timeline and localized details", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/api/admin/audit?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    const category = url.searchParams.get('categories') === 'configuration' ? 'configuration' : 'integrations';
    return route.fulfill({ json: auditPage({ categories: auditCategories, nextCursor: null,
      entries: [{ ...entry, category, action: category === 'configuration' ? 'hospital.mapping_import' : 'cos.delivery',
        outcome: category === 'configuration' ? 'succeeded' : 'confirmed',
        integration: { destination: 'cos', configurationRevision: 3, mappingId: 'audit-fixture', mappingSha256: 'a'.repeat(64) } }] }) });
  });
  await page.goto('/__audit?language=en');
  await selectTypes(page, ['Integrations']);
  await expect(page.getByRole('cell', { name: 'Integrations', exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get('categories')).toBe('integrations');
  await page.locator('.audit-table tbody tr').click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('summary').filter({ hasText: 'Integration history' }).click();
  await expect(dialog.getByText('audit-fixture', { exact: true })).toBeVisible();
  await expect(dialog.locator('.hospital-history-panel')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
  await selectTypes(page, ['Configuration']);
  await expect(page.getByRole('cell', { name: 'Canonical mapping imported', exact: true })).toBeVisible();
});

test("metadata auditors can select every log type without clinical-value or payload controls", async ({ page }) => {
  await page.route('**/api/admin/context', route => route.fulfill({ json: {
    organization: session.organization, panels: ['auditing'], capabilities: ['audit:read'],
    dashboard: null, activeConfiguration: null,
  } }));
  const sources: Record<string, string> = { clinical: 'clinical.report_change',
    analytics: 'clinical_audit.analytics_access_event', feedback: 'feedback.submission',
    patient: 'clinical_audit.patient_access_event', integrations: 'clinical_audit.hospital_operational_event' };
  await page.route('**/api/admin/audit?*', route => {
    const category = new URL(route.request().url()).searchParams.get('categories') || 'patient';
    return route.fulfill({ json: auditPage({ categories: auditCategories, entries: [{ ...entry, category,
      source: sources[category], action: `${category}.metadata`, patientId: actor, target: { kind: 'report', label: 'PCR-123' } }], nextCursor: null }) });
  });
  await page.goto('/__audit?language=en');
  const panel = page.locator('.audit-panel');
  await panel.locator('.audit-type-filter summary').click();
  await expect(panel.getByRole('checkbox')).toHaveCount(auditCategories.length);
  for (const [category, name] of Object.entries({ patient: 'Patient access', clinical: 'Clinical changes',
    analytics: 'Analytics and exports', feedback: 'Feedback', integrations: 'Integrations' })) {
    await selectTypes(page, [name]);
    await expect(panel.getByRole('cell', { name: `${category}.metadata`, exact: true })).toBeVisible();
    await expect(panel.getByRole('cell', { name: 'PCR: PCR-123', exact: true })).toBeVisible();
    await panel.locator('tbody tr').click();
    const dialog = panel.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'View clinical values', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Show JSON dump', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
  }
});
