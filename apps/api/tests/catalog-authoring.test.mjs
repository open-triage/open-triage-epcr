import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { CatalogAuthoringService, catalogDefinitionSha256 } from "../dist/admin/catalog-authoring.service.js";

const sourceElement = {
  element_id: "ePatient.01", element_identity_id: "11111111-1111-4111-8111-111111111111",
  name: "Patient Name",
  base_datatype: "string", source_datatype: "xs:string", group_path: ["Patient"], min_occurs: 0,
  max_occurs: 1, nillable: true, supports_not_values: true, supports_pertinent_negatives: false,
  usage: "Recommended", agency_required_severity: null, analytical_location: "wide", sql_type: "text"
};
const element = {
  elementId: sourceElement.element_id, label: sourceElement.name, identityId: sourceElement.element_identity_id, baseDatatype: "string",
  storageSemantics: { sourceDatatype: "xs:string", groupPath: ["Patient"], analyticalLocation: "wide", sqlType: "text" },
  requirednessSeverity: null,
  constraints: { minOccurs: 0, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: false }
};
const definition = { schemaVersion: 1, sourceReleaseId: "release-1", elements: [element], codeLists: [] };
const session = { user: { id: "owner-1" }, organization: { id: "org-1" } };

function serviceWith(manager, sessions = { requireCapability: async () => session }) {
  return new CatalogAuthoringService({ transaction: async (_level, work) => work(manager), manager,
    query: (...parameters) => manager.query(...parameters) }, sessions);
}

test("catalog hashes are stable across object key ordering", () => {
  assert.equal(catalogDefinitionSha256({ b: 2, a: 1 }), catalogDefinitionSha256({ a: 1, b: 2 }));
});

test("stale catalog saves fail before changing canonical content", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 3, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    throw new Error(`unexpected query: ${sql}`);
  } };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 2, definition }), ConflictException);
});

test("saving normalizes legacy element labels and requiredness before validation", async () => {
  const legacyDefinition = { ...definition, elements: definition.elements.map(({ label, requirednessSeverity, ...legacy }) => legacy) };
  let persisted;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: legacyDefinition,
      definition_sha256: catalogDefinitionSha256(legacyDefinition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("update catalog.authoring_draft")) {
      persisted = JSON.parse(parameters[2]);
      return [{ id: "draft-1", organization_id: "org-1", source_release_id: "release-1", revision: 2,
        canonical_definition: persisted, definition_sha256: parameters[3], updated_at: new Date(), published_release_id: null }];
    }
    throw new Error(`unexpected query: ${sql}`);
  } };
  const saved = await serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: legacyDefinition });
  assert.equal(saved.definition.elements[0].label, "Patient Name");
  assert.equal(saved.definition.elements[0].requirednessSeverity, null);
  assert.deepEqual(saved.definition, persisted);
});

test("identity, datatype, storage, and unsupported constraint changes are rejected", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    if (sql.includes("select 'inline:'")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const changed = { ...definition, elements: [{ ...element, baseDatatype: "integer",
    constraints: { ...element.constraints, maxOccurs: null, supportsPertinentNegatives: true } }] };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: changed }),
    (error) => error instanceof UnprocessableEntityException && /identity, datatype, and storage/.test(JSON.stringify(error.getResponse())));
});

test("publication requires a human change note before database access", async () => {
  const manager = { query: async () => { throw new Error("database should not be queried"); } };
  await assert.rejects(serviceWith(manager).publish("session", "draft-1", {
    expectedRevision: 1, definitionSha256: catalogDefinitionSha256(definition), displayName: "Agency Catalog", changeNote: " "
  }), UnprocessableEntityException);
});

test("synthetic demo catalog drafts remain editable but cannot be published", async () => {
  const original = process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
  process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = "synthetic-demo";
  let queried = false;
  const manager = { query: async () => { queried = true; return []; } };
  try {
    await assert.rejects(serviceWith(manager).publish("session", "draft-1", {}),
      (error) => error instanceof ForbiddenException && /Drafts can still be/.test(error.message));
    assert.equal(queried, false);
  } finally {
    if (original === undefined) delete process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE;
    else process.env.OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE = original;
  }
});

test("catalog publication carries forward one effective agency demographic version", async () => {
  const calls = [];
  const manager = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    return [{ id: "demographic-version-2" }];
  } };
  const service = serviceWith(manager);
  await service.cloneAgencyDemographics(manager, "org-1", "release-1", "release-2", "owner-1");
  assert.match(calls[0].sql, /insert into app_identity\.agency_demographic_version/);
  assert.match(calls[0].sql, /source\.catalog_release_id=\$2/);
  assert.deepEqual(calls[0].parameters, ["org-1", "release-1", "release-2", "owner-1"]);
});

test("catalog publication fails when its source has no effective agency demographics", async () => {
  const manager = { query: async () => [] };
  const service = serviceWith(manager);
  await assert.rejects(
    service.cloneAgencyDemographics(manager, "org-1", "release-1", "release-2", "owner-1"),
    (error) => error instanceof UnprocessableEntityException && /No effective agency demographics/.test(error.message)
  );
});

test("catalog reads require their granular capability", async () => {
  const service = serviceWith({ query: async () => [] }, {
    requireCapability: async (_token, capability) => {
      assert.equal(capability, "catalog:read");
      throw new UnauthorizedException();
    }
  });
  await assert.rejects(service.current("clinician-session"), UnauthorizedException);
});

test("Catalog API enforces read, write, and publish authority independently before data access", async () => {
  const attempts = [
    { name: "reader save", capabilities: ["catalog:read"], invoke: (service) =>
      service.save("session", "draft-1", {}), required: "catalog:write" },
    { name: "reader clone", capabilities: ["catalog:read"], invoke: (service) =>
      service.cloneActive("session", {}), required: "catalog:write" },
    { name: "writer publish", capabilities: ["catalog:read", "catalog:write"], invoke: (service) =>
      service.publish("session", "draft-1", {}), required: "catalog:publish" },
    { name: "write without read", capabilities: ["catalog:write"], invoke: (service) =>
      service.save("session", "draft-1", {}), required: "catalog:write" },
    { name: "publish without prerequisites", capabilities: ["catalog:publish"], invoke: (service) =>
      service.publish("session", "draft-1", {}), required: "catalog:publish" }
  ];
  for (const attempt of attempts) {
    let queried = false;
    const service = serviceWith({ query: async () => { queried = true; return []; } }, {
      requireCapability: async (_token, capability) => {
        assert.equal(capability, attempt.required, attempt.name);
        if (!attempt.capabilities.includes(capability) ||
            (capability === "catalog:write" && !attempt.capabilities.includes("catalog:read")) ||
            (capability === "catalog:publish" &&
              !(attempt.capabilities.includes("catalog:read") && attempt.capabilities.includes("catalog:write")))) {
          throw new ForbiddenException("The requested capability and its prerequisites are required");
        }
        return session;
      }
    });
    await assert.rejects(attempt.invoke(service), ForbiddenException, attempt.name);
    assert.equal(queried, false, `${attempt.name} reached the database`);
  }
});

test("Catalog readers may inspect and validate definitions without mutation authority", async () => {
  const requested = [];
  const manager = { query: async () => [] };
  const service = serviceWith(manager, { requireCapability: async (_token, capability) => {
    requested.push(capability);
    if (capability !== "catalog:read") throw new ForbiddenException();
    return session;
  } });
  assert.equal(await service.current("session"), null);
  await assert.rejects(service.validate("session", "11111111-1111-4111-8111-111111111111"), /was not found/);
  assert.deepEqual(requested, ["catalog:read", "catalog:read"]);
});

test("Catalog readers inspect the active sealed definition when no authoring draft exists", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("from forms.agency_stationary_default active")) return [{
      id: "release-1", display_name: "NEMSIS 3.5.1", version: "3.5.1"
    }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const viewed = await serviceWith(manager).inspectActive("reader-session");
  assert.equal(viewed.status, "active");
  assert.equal(viewed.displayName, "NEMSIS 3.5.1");
  assert.deepEqual(viewed.definition.elements, [element]);
});

const sourceCodeList = { list_id: "patient-activity", name: "Patient Activity", classification: "suggested",
  element_ids: ["ePatient.01"], default_value: null, values: [
  { code: "Y93.K", codeSystem: "ICD-10-CM", label: "Animal care activity",
    sourceLabel: "Activities involving animal care", category: "Animal Care", enabled: true },
  { code: "Y93.01", codeSystem: "ICD-10-CM", label: "Walking",
    sourceLabel: "Activity, walking", category: "Exercise", enabled: true }
] };

function listManager(currentDefinition) {
  return { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: currentDefinition,
      definition_sha256: catalogDefinitionSha256(currentDefinition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [sourceCodeList];
    if (sql.includes("select 'inline:'")) return [];
    if (sql.includes("update catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 2, canonical_definition: currentDefinition,
      definition_sha256: catalogDefinitionSha256(currentDefinition), updated_at: new Date(), published_release_id: null }];
    throw new Error(`unexpected query: ${sql}`);
  } };
}

test("recommended code lists support labels, enabled state, ordering, additions, and an enabled default", async () => {
  const changed = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids, values: [
      { ...sourceCodeList.values[1], label: "Walking or hiking", enabled: false },
      sourceCodeList.values[0],
      { code: "LOCAL-1", codeSystem: "Example EMS", label: "Local activity", sourceLabel: "Local activity",
        category: null, enabled: true }
    ], defaultValue: { code: "LOCAL-1", codeSystem: "Example EMS" } }] };
  const saved = await serviceWith(listManager(changed)).save("session", "draft-1", { expectedRevision: 1, definition: changed });
  assert.equal(saved.revision, 2);
});

test("inline enumerations are exposed as element-selectable editable code lists", async () => {
  const inline = { list_id: "inline:eAirway.03", name: "Airway Device Being Confirmed", classification: "inline",
    element_ids: ["eAirway.03"], default_value: null, values: [
      { code: "4003001", codeSystem: "", label: "Combitube", sourceLabel: "Combitube", category: null, enabled: true }
    ] };
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    if (sql.includes("select 'inline:'")) return [inline];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const cloned = await serviceWith(manager).cloneDefinition(manager, "release-1");
  assert.deepEqual(cloned.codeLists[0], {
    listId: inline.list_id, name: inline.name, classification: "inline", elementIds: ["eAirway.03"],
    defaultValue: null, values: inline.values
  });
});

test("duplicate codes and removed published values fail validation", async () => {
  const invalid = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids,
    values: [sourceCodeList.values[0], { ...sourceCodeList.values[0], label: "Duplicate", enabled: false }],
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  await assert.rejects(serviceWith(listManager(invalid)).save("session", "draft-1", { expectedRevision: 1, definition: invalid }),
    (error) => error instanceof UnprocessableEntityException && /duplicate code/.test(JSON.stringify(error.getResponse())) &&
      /cannot be deleted/.test(JSON.stringify(error.getResponse())));
});

test("a disabled code cannot be the list default", async () => {
  const invalid = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids,
    values: sourceCodeList.values.map((value, index) => index === 0 ? { ...value, enabled: false } : value),
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  await assert.rejects(serviceWith(listManager(invalid)).save("session", "draft-1", { expectedRevision: 1, definition: invalid }),
    (error) => error instanceof UnprocessableEntityException && /default must reference an enabled value/.test(JSON.stringify(error.getResponse())));
});
