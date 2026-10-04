import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminLanguageContext } from "../app/admin-localization";
import { RoleCapabilityMatrix, UsersPanel } from "../components/admin-directory";
import { AuthoringVersionWorkspace } from "../components/authoring-version-workspace";
import { TranslationIssueSummary } from "../components/translation-issue-summary";
import { ValidationRuleFilterControls } from "../components/validation-authoring";

function render(language: "en" | "sv", child: ReturnType<typeof createElement>) {
  return renderToStaticMarkup(createElement(AdminLanguageContext.Provider, { value: language }, child));
}

test("directory controls and accessible search text follow agency language", () => {
  const english = render("en", createElement(UsersPanel));
  const swedish = render("sv", createElement(UsersPanel));
  assert.match(english, />Users<\/h2>/);
  assert.match(swedish, />Användare<\/h2>/);
  assert.match(swedish, /aria-label="Sök användare"/);
  assert.match(swedish, /Visningsnamn eller användarnamn/);
  assert.match(swedish, /Läser in användare/);
});

test("version selector translates chrome but keeps the authored version name", () => {
  const version = { id: "version-1", displayName: "Patientöverföring 2026", version: 3, status: "active" as const };
  const props = { title: "Catalog", versions: [version], selectedId: version.id, onSelect: () => {},
    draftName: "", onDraftNameChange: () => {}, onCreateDraft: () => {}, canWrite: false, busy: false, hasDraft: false };
  const swedish = render("sv", createElement(AuthoringVersionWorkspace, props));
  assert.match(swedish, /Patientöverföring 2026/);
  assert.match(swedish, /Aktiv/);
  assert.match(swedish, /Katalog versioner/);
});

test("validation filters and translation diagnostics expose Swedish controls", () => {
  const filters = { search: "", element: "", source: "", severity: "", reviewPriority: "", executionTarget: "", enabled: "", validity: "" };
  const validation = render("sv", createElement(ValidationRuleFilterControls, { value: filters, onChange: () => {} }));
  assert.match(validation, /aria-label="Filtrera valideringsregler"/);
  assert.match(validation, /Alla allvarlighetsgrader/);
  assert.match(validation, /Granskningsprioritet/);
  assert.match(validation, /Alla prioriteter/);
  assert.match(validation, /value="wording">Textproblem/);
  assert.match(validation, /value="missing-english">Saknar engelska/);
  assert.match(validation, /value="missing-swedish">Saknar svenska/);
  const issues = render("sv", createElement(TranslationIssueSummary, {
    issues: [{ id: "ePatient.01", field: "label", kind: "agency", message: "Missing Swedish text" }],
    filter: "all", onFilter: () => {}, onNavigate: () => {}
  }));
  assert.match(issues, /Svensk text saknas/);
  assert.match(issues, /ePatient.01/);
  assert.match(issues, /Visa textproblem/);
});


test("capability descriptions translate by key while authored role names and keys stay stable", () => {
  const role = { id: "role-id", displayName: "Dispatch Lead", description: "Authored role detail", active: true,
    protected: false, version: 1, assigneeCount: 2,
    capabilities: [{ key: "users:read", description: "View users", administrative: true, systemOnly: false }] };
  const option = { key: "users:read", description: "View users", administrative: true, systemOnly: false,
    prerequisites: [], mutable: true };
  const props = { roles: [role], capabilityOptions: [option], canWrite: false,
    onHistory: () => {}, onEdit: () => {}, onDeactivate: () => {}, onReactivate: () => {} };
  const swedish = render("sv", createElement(RoleCapabilityMatrix, props));
  assert.match(swedish, /title="Visa användare"/);
  assert.match(swedish, /users:read/);
  assert.match(swedish, /Dispatch Lead/);
  assert.match(swedish, /Authored role detail/);
});
