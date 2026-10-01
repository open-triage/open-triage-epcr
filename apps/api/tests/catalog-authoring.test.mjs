import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { CatalogAuthoringService, catalogDefinitionSha256 } from "../dist/admin/catalog-authoring.service.js";

const sourceElement = {
  element_id: "ePatient.01", element_identity_id: "11111111-1111-4111-8111-111111111111",
  name: "Patient Name", description: "Patient name as documented.",
  base_datatype: "string", source_datatype: "xs:string", group_path: ["Patient"], min_occurs: 0,
  max_occurs: 1, nillable: true, supports_not_values: true, supports_pertinent_negatives: false,
  usage: "Recommended", agency_required_severity: null, analytical_location: "wide", sql_type: "text"
};
const element = {
  elementId: sourceElement.element_id, label: sourceElement.name, description: sourceElement.description, identityId: sourceElement.element_identity_id, baseDatatype: "string",
  storageSemantics: { sourceDatatype: "xs:string", groupPath: ["Patient"], analyticalLocation: "wide", sqlType: "text" },
  requirednessSeverity: null,
  constraints: { minOccurs: 0, maxOccurs: 1, nillable: true, supportsNotValues: true, supportsPertinentNegatives: false }
};
const definition = { schemaVersion: 1, sourceReleaseId: "release-1", elements: [element], codeLists: [] };
const session = { user: { id: "owner-1" }, organization: { id: "org-1" } };

function serviceWith(manager, sessions = { requireCapability: async () => session }) {
  const wrapped = { ...manager, query: (sql, ...parameters) =>
    sql.includes("from forms.custom_element_definition ced")
      ? [] : manager.query(sql, ...parameters) };
  return new CatalogAuthoringService({ transaction: async (_level, work) => work(wrapped), manager: wrapped,
    query: (...parameters) => wrapped.query(...parameters) }, sessions);
}

test("catalog hashes are stable across object key ordering", () => {
  assert.equal(catalogDefinitionSha256({ b: 2, a: 1 }), catalogDefinitionSha256({ a: 1, b: 2 }));
});

test("custom text validation rejects duplicate identity and incompatible published reuse", async () => {
  const custom = { id: "da77b0fc-a701-41b0-a387-18b07662ed71", namespace: "org.example.ems",
    slug: "LocalNote", title: "Local note", definition: "A locally requested note.", datatype: "string",
    recurrence: "single", usage: "Optional", constraints: { maxLength: 100 }, identifying: false };
  let inherited = [];
  let collisions = [];
  let pinned = null;
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("select ced.id,ced.namespace,ced.slug,ced.definition")) return inherited;
    if (sql.includes("customElementDefinitions")) return [{ definitions: pinned }];
    if (sql.includes("from catalog.element_identity")) return collisions;
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const service = new CatalogAuthoringService({ manager, query: (...args) => manager.query(...args) },
    { requireCapability: async () => session });
  const candidate = { ...definition, customElements: [custom] };
  assert.equal((await service.validateDefinition(manager, "release-1", candidate)).valid, true);
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, retired: true }] })).findings.join(" "), /published before retirement/);
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [custom, { ...custom, id: "5b5cde30-2057-4e6d-919e-e2cbf712d72b" }] })).findings.join(" "), /Duplicate custom identity/);
  collisions = [{ id: custom.id, namespace: custom.namespace, canonical_key: `${custom.namespace}.${custom.slug}` }];
  assert.match((await service.validateDefinition(manager, "release-1", candidate)).findings.join(" "), /already published/);
  inherited = [{ id: custom.id, namespace: custom.namespace, slug: custom.slug, definition: custom }];
  pinned = [custom];
  assert.equal((await service.validateDefinition(manager, "release-1", candidate)).valid, true);
  assert.equal((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, title: "Revised local note", definition: "A clearer clinical description." }] })).valid, true);
  assert.equal((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, retired: true }] })).valid, true);
  pinned = [{ ...custom, retired: true }];
  assert.match((await service.validateDefinition(manager, "release-1", candidate)).findings.join(" "), /cannot change its meaning/);
  pinned = [custom];
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, identifying: true }] })).findings.join(" "), /cannot change its meaning/);
});

test("custom coded publication validates pinned NEMSIS mappings and distinct code systems", async () => {
  const custom = { id: "d474249a-f946-4b96-8280-637782b2ef13", namespace: "org.example.ems",
    slug: "LocalFinding", title: "Local finding", definition: "Agency observation code.",
    datatype: "coded", recurrence: "single", usage: "Optional", identifying: false,
    codeSystem: "https://example.org/ems/finding", choices: [{ code: "A", label: "Alert", nemsisCode: "P1" }],
    nemsisElement: "ePatient.01", permittedNotValues: ["7701003"], permittedPertinentNegatives: ["8801019"] };
  let inherited = [];
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("select distinct code_system from catalog.element_option")) return [{ code_system: "https://standard.example/codes" }];
    if (sql.includes("select distinct code from catalog.element_option")) return [{ code: "P1" }];
    if (sql.includes("select ced.id,ced.namespace,ced.slug,ced.definition")) return inherited;
    if (sql.includes("customElementDefinitions")) return [{ definitions: [custom] }];
    if (sql.includes("from catalog.element_identity")) return [];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const service = new CatalogAuthoringService({ manager }, { requireCapability: async () => session });
  const candidate = { ...definition, customElements: [custom] };
  assert.equal((await service.validateDefinition(manager, "release-1", candidate)).valid, true);
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, codeSystem: "https://standard.example/codes" }] })).findings.join(" "), /reserved by the pinned standard catalog/);
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, choices: [{ code: "A", label: "Alert", nemsisCode: "missing" }] }] })).findings.join(" "), /not a pinned catalog code/);
  inherited = [{ id: custom.id, namespace: custom.namespace, slug: custom.slug, definition: custom }];
  assert.equal((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, title: "Updated finding", choices: [
      { code: "A", label: "Alerted", nemsisCode: "P1" }, { code: "B", label: "Calm" }
    ] }] })).valid, true);
  assert.match((await service.validateDefinition(manager, "release-1", { ...candidate,
    customElements: [{ ...custom, choices: [{ code: "A", label: "Alert", nemsisCode: "P2" }] }] })).findings.join(" "), /cannot change its meaning/);
});

test("catalog version inspection only loads a version visible to the organization", async () => {
  const service = serviceWith({ query: async () => [] });
  service.versions = async () => [{ id: "release-1", displayName: "Sweden catalog", version: "1.0", status: "published" }];
  service.cloneDefinition = async (_manager, id) => {
    assert.equal(id, "release-1");
    return definition;
  };
  assert.deepEqual(await service.inspectVersion("session", "release-1"), {
    id: "release-1", displayName: "Sweden catalog", version: "1.0", status: "published", definition
  });
  await assert.rejects(service.inspectVersion("session", "foreign-release"), NotFoundException);
});

test("stale catalog saves fail before changing canonical content", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 3, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 2, definition }), ConflictException);
});

test("catalog writers delete only their unpublished draft at the expected revision and retain audit evidence", async () => {
  const calls = [];
  const capabilities = [];
  const draft = { id: "draft-1", organization_id: "org-1", source_release_id: "release-1", revision: 4,
    canonical_definition: definition, definition_sha256: catalogDefinitionSha256(definition),
    updated_at: new Date(), published_release_id: null };
  const manager = { query: async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("select * from catalog.authoring_draft")) return [draft];
    if (sql.includes("insert into app_identity.configuration_event")) return [];
    if (sql.includes("delete from catalog.authoring_draft")) return [{ id: draft.id }];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const service = serviceWith(manager, { requireCapability: async (_token, capability) => {
    capabilities.push(capability); return session;
  } });
  await service.delete("session", draft.id, { expectedRevision: 4 });
  assert.deepEqual(capabilities, ["catalog:write"]);
  const audit = calls.find(({ sql }) => sql.includes("insert into app_identity.configuration_event"));
  assert.deepEqual(audit.parameters.slice(0, 4), ["org-1", "owner-1", "release-1", draft.definition_sha256]);
  assert.deepEqual(JSON.parse(audit.parameters[4]), {
    catalogDraftId: "draft-1", sourceReleaseId: "release-1", revision: 4
  });
  const deletion = calls.find(({ sql }) => sql.includes("delete from catalog.authoring_draft"));
  assert.match(deletion.sql, /organization_id=\$2 and revision=\$3 and published_release_id is null/);
  assert.deepEqual(deletion.parameters, ["draft-1", "org-1", 4]);

  const mutations = [];
  const staleManager = { query: async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("select * from catalog.authoring_draft")) return [draft];
    mutations.push(sql); return [];
  } };
  await assert.rejects(serviceWith(staleManager).delete("session", draft.id, { expectedRevision: 3 }),
    (error) => error instanceof ConflictException && error.getResponse().actualRevision === 4);
  assert.deepEqual(mutations, []);
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
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const saved = await serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: legacyDefinition });
  assert.equal(saved.definition.elements[0].label, "Patient Name");
  assert.equal(saved.definition.elements[0].requirednessSeverity, null);
  assert.deepEqual(saved.definition, persisted);
});

test("Catalog saves discard attempted requiredness and documented occurrence policy edits", async () => {
  let persisted;
  const attempted = { ...definition, elements: [{ ...element, requirednessSeverity: "warning",
    constraints: { ...element.constraints, minOccurs: 1, maxOccurs: null } }] };
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("update catalog.authoring_draft")) {
      persisted = JSON.parse(parameters[2]);
      return [{ id: "draft-1", organization_id: "org-1", source_release_id: "release-1", revision: 2,
        canonical_definition: persisted, definition_sha256: parameters[3], updated_at: new Date(), published_release_id: null }];
    }
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  await serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: attempted });
  assert.equal(persisted.elements[0].requirednessSeverity, null);
  assert.deepEqual({ minOccurs: persisted.elements[0].constraints.minOccurs,
    maxOccurs: persisted.elements[0].constraints.maxOccurs }, { minOccurs: 0, maxOccurs: 1 });
});

test("identity, datatype, storage, and unsupported constraint changes are rejected", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    if (sql.includes("select 'inline:'")) return [];
    if (sql.includes("customGroupDefinitions")) return [];
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
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const viewed = await serviceWith(manager).inspectActive("reader-session");
  assert.equal(viewed.status, "active");
  assert.equal(viewed.displayName, "NEMSIS 3.5.1");
  assert.deepEqual(viewed.definition.elements, [element]);
});

test("cloning the active catalog unwraps PostgreSQL mutation tuples into a usable draft", async () => {
  const manager = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("select * from catalog.authoring_draft")) return [];
    if (sql.includes("select cr.id from catalog.release cr")) return [{ id: "release-1" }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("insert into catalog.authoring_draft")) return [[{
      id: "draft-1", organization_id: "org-1", source_release_id: "release-1", revision: 1,
      display_name: parameters[5], canonical_definition: JSON.parse(parameters[2]),
      definition_sha256: parameters[3], updated_at: "2026-09-13T10:00:00.000Z", published_release_id: null
    }], 1];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const cloned = await serviceWith(manager).cloneActive("owner-session", { displayName: "Night catalog" });
  assert.equal(cloned.id, "draft-1");
  assert.equal(cloned.displayName, "Night catalog");
  assert.equal(cloned.updatedAt, "2026-09-13T10:00:00.000Z");
  assert.deepEqual(cloned.definition.elements, [element]);
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
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
}

test("recommended code lists support labels, enabled state, ordering, additions, and inert legacy default metadata", async () => {
  const changed = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids, values: [
      { ...sourceCodeList.values[1], label: "Walking or hiking", enabled: false },
      sourceCodeList.values[0],
      { code: "LOCAL-1", codeSystem: "Example EMS", label: "Local activity", sourceLabel: "Local activity",
        category: null, enabled: true, nemsisCode: "Y93.K" }
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
    if (sql.includes("from forms.custom_element_definition ced")) return [];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    if (sql.includes("select 'inline:'")) return [inline];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const cloned = await serviceWith(manager).cloneDefinition(manager, "release-1");
  assert.deepEqual(cloned.codeLists[0], {
    listId: inline.list_id, name: inline.name, classification: "inline", elementIds: ["eAirway.03"],
    defaultValue: null, values: inline.values
  });
});

test("inline NEMSIS elements accept mapped local values and reject unmapped values", async () => {
  const inline = { list_id: "inline:ePatient.01", name: "Patient Name", classification: "inline",
    element_ids: ["ePatient.01"], default_value: null, values: [
      { code: "1001", codeSystem: "", label: "Other", sourceLabel: "Other", category: null, enabled: true }
    ] };
  const manager = { query: async (sql) => {
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option")) return [];
    if (sql.includes("select 'inline:'")) return [inline];
    if (sql.includes("customGroupDefinitions") || sql.includes("from forms.custom_element_definition")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const list = { listId: inline.list_id, name: inline.name, classification: "inline", elementIds: inline.element_ids,
    values: [...inline.values, { code: "LOCAL-1", codeSystem: "urn:agency:example", label: "Local choice",
      sourceLabel: "Local choice", category: null, enabled: true, nemsisCode: "1001" }] };
  const service = serviceWith(manager);
  assert.equal((await service.validateDefinition(manager, "release-1", { ...definition, codeLists: [list] })).valid, true);
  const unmapped = { ...list, values: list.values.map((value) => value.code === "LOCAL-1" ? { ...value, nemsisCode: "missing" } : value) };
  assert.match((await service.validateDefinition(manager, "release-1", { ...definition, codeLists: [unmapped] })).findings.join(" "), /mapped NEMSIS value/);
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

test("legacy default metadata stays inert when its code is disabled", async () => {
  const invalid = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids,
    values: sourceCodeList.values.map((value, index) => index === 0 ? { ...value, enabled: false } : value),
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  const saved = await serviceWith(listManager(invalid)).save("session", "draft-1", { expectedRevision: 1, definition: invalid });
  assert.deepEqual(saved.definition.codeLists, invalid.codeLists);
});


test("Swedish text survives a revision-checked save and incomplete translations are advisory", async () => {
  let savedDefinition;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: savedDefinition ? 2 : 1, canonical_definition: savedDefinition ?? definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("update catalog.authoring_draft")) {
      savedDefinition = JSON.parse(parameters[2]);
      return [{ id: "draft-1", organization_id: "org-1", source_release_id: "release-1", revision: 2,
        canonical_definition: savedDefinition, definition_sha256: parameters[3], updated_at: new Date(), published_release_id: null }];
    }
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const localized = { ...definition, elements: [{ ...element, label: "Updated name", description: "Updated description",
    localization: { schemaVersion: 1, sv: { label: "Patientnamn", description: "Patientens namn",
      reviewedSource: { label: element.label, description: element.description } } } }] };
  const service = serviceWith(manager);
  const saved = await service.save("session", "draft-1", { expectedRevision: 1, definition: localized });
  assert.equal(saved.definition.elements[0].localization.sv.label, "Patientnamn");
  assert.equal(savedDefinition.elements[0].description, "Updated description");
  const validation = await service.validate("session", "draft-1");
  assert.equal(validation.valid, true);
  assert.ok(validation.warnings.every((warning) => !warning.includes("source review")));
});

test("malformed catalog localization remains a publication-blocking structural error", async () => {
  const manager = { query: async (sql) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 1, canonical_definition: definition,
      definition_sha256: catalogDefinitionSha256(definition), updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.element_definition e left join catalog.analytics_element_mapping")) return [sourceElement];
    if (sql.includes("from catalog.value_set v left join catalog.value_set_option") || sql.includes("select 'inline:'")) return [];
    if (sql.includes("customGroupDefinitions")) return [];
    throw new Error(`unexpected query: ${sql}`);
  } };
  const changed = { ...definition, elements: [{ ...element, localization: { schemaVersion: 1, sv: { label: 12 } } }] };
  await assert.rejects(serviceWith(manager).save("session", "draft-1", { expectedRevision: 1, definition: changed }),
    (error) => error instanceof UnprocessableEntityException && /localization is malformed/.test(JSON.stringify(error.getResponse())));
});

test("publishing seals localized text with its catalog digest without editing the source release", async () => {
  const localized = { ...definition, elements: [{ ...element, label: "Updated name", description: "Updated description",
    localization: { schemaVersion: 1, sv: { label: "Patientnamn", description: "Patientens namn",
      reviewedSource: { label: "Updated name", description: "Updated description" } } } }] };
  const digest = catalogDefinitionSha256(localized);
  let publishedProvenance;
  let publishedDigest;
  let projected = false;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 2, canonical_definition: localized,
      definition_sha256: digest, updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.release source")) return [{ standard: "NEMSIS", version: "3.5.1",
      dataset: "EMSDataSet", artifact_schema_version: "1.0.0", data_model_version: "3.5.1" }];
    if (sql.includes("insert into catalog.release")) {
      publishedDigest = parameters[5];
      publishedProvenance = JSON.parse(parameters[6]);
      return [];
    }
    if (sql.includes("source_counts")) return [{ source_counts: [0, 1, 0, 0, 0, 0, 0, 0],
      published_counts: [0, 1, 0, 0, 0, 0, 0, 0], expected_option_count: 0, expected_element_option_count: 0 }];
    if (sql.includes("update catalog.authoring_draft set published_release_id")) return [{ published_at: new Date() }];
    return [];
  } };
  const service = serviceWith(manager);
  service.validateDefinition = async () => ({ valid: true, findings: [], warnings: [], definitionSha256: digest, projectionsVerified: true });
  service.project = async () => { projected = true; };
  service.cloneAgencyDemographics = async () => {};
  const published = await service.publish("session", "draft-1", { expectedRevision: 2, definitionSha256: digest,
    displayName: "Swedish catalog", changeNote: "Reviewed Swedish text" });
  assert.equal(projected, true);
  assert.equal(published.definitionSha256, digest);
  assert.equal(publishedDigest, digest);
  assert.equal(publishedProvenance.elementLocalization["ePatient.01"].sv.label, "Patientnamn");
  assert.equal(publishedProvenance.sourceReleaseId, "release-1");
  assert.equal(definition.elements[0].localization, undefined);
});

test("authors save Swedish list and choice text without changing code, source name, or default", async () => {
  const localized = { ...definition, codeLists: [{ listId: sourceCodeList.list_id,
    name: sourceCodeList.name, classification: "suggested", elementIds: sourceCodeList.element_ids,
    localization: { schemaVersion: 1, sv: { name: "Patientaktivitet",
      reviewedSource: { name: sourceCodeList.name } } },
    values: sourceCodeList.values.map((value, index) => index === 0 ? { ...value,
      localization: { schemaVersion: 1, sv: { label: "Djurvård", reviewedSource: { label: value.label } } } } : value),
    defaultValue: { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem } }] };
  const saved = await serviceWith(listManager(localized)).save("session", "draft-1", { expectedRevision: 1, definition: localized });
  const list = saved.definition.codeLists[0];
  assert.equal(list.values[0].localization.sv.label, "Djurvård");
  assert.equal(list.values[0].code, "Y93.K");
  assert.equal(list.values[0].sourceLabel, "Activities involving animal care");
  assert.deepEqual(list.defaultValue, { code: "Y93.K", codeSystem: "ICD-10-CM" });
});

test("publishing choice translations seals nested list, system, and code identities", async () => {
  const value = { ...sourceCodeList.values[0], localization: { schemaVersion: 1,
    sv: { label: "Djurvård", reviewedSource: { label: sourceCodeList.values[0].label } } } };
  const localized = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids, values: [value,
      { code: "LOCAL-1", codeSystem: "urn:agency:example", label: "Local activity", sourceLabel: "Local activity",
        category: null, enabled: true, nemsisCode: "Y93.K" }], defaultValue: null }] };
  const digest = catalogDefinitionSha256(localized);
  let provenance;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("select * from catalog.authoring_draft")) return [{ id: "draft-1", organization_id: "org-1",
      source_release_id: "release-1", revision: 2, canonical_definition: localized,
      definition_sha256: digest, updated_at: new Date(), published_release_id: null }];
    if (sql.includes("from catalog.release source")) return [{ standard: "NEMSIS", version: "3.5.1",
      dataset: "EMSDataSet", artifact_schema_version: "1.0.0", data_model_version: "3.5.1" }];
    if (sql.includes("insert into catalog.release")) { provenance = JSON.parse(parameters[6]); return []; }
    if (sql.includes("source_counts")) return [{ source_counts: [0, 1, 0, 1, 1, 1, 0, 0],
      published_counts: [0, 1, 0, 1, 1, 2, 0, 0], expected_option_count: 2, expected_element_option_count: 0 }];
    if (sql.includes("update catalog.authoring_draft set published_release_id")) return [{ published_at: new Date() }];
    return [];
  } };
  const service = serviceWith(manager);
  service.validateDefinition = async () => ({ valid: true, findings: [], warnings: [], definitionSha256: digest, projectionsVerified: true });
  service.project = async () => {};
  service.cloneAgencyDemographics = async () => {};
  await service.publish("session", "draft-1", { expectedRevision: 2, definitionSha256: digest,
    displayName: "Swedish choices", changeNote: "Reviewed Swedish choices" });
  assert.equal(provenance.codeListLocalization["patient-activity"].values["ICD-10-CM"]["Y93.K"].sv.label, "Djurvård");
  assert.equal(provenance.codeListCustomMappings["patient-activity"]["urn:agency:example"]["LOCAL-1"], "Y93.K");
  assert.equal(JSON.stringify(provenance).includes("\\u0000"), false);
});

test("API rejects new default authoring while allowing legacy metadata to round-trip", async () => {
  const current = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids, values: sourceCodeList.values }] };
  const changed = structuredClone(current);
  changed.codeLists[0].defaultValue = { code: sourceCodeList.values[0].code, codeSystem: sourceCodeList.values[0].codeSystem };
  await assert.rejects(serviceWith(listManager(current)).save("session", "draft-1", { expectedRevision: 1, definition: changed }),
    (error) => error instanceof UnprocessableEntityException && /Default-value authoring/.test(error.message));
});

test("publishing legacy default metadata never projects an active default or reorders choices", async () => {
  const legacy = { ...definition, codeLists: [{ listId: sourceCodeList.list_id, name: sourceCodeList.name,
    classification: "suggested", elementIds: sourceCodeList.element_ids, values: sourceCodeList.values,
    defaultValue: { code: sourceCodeList.values[1].code, codeSystem: sourceCodeList.values[1].codeSystem } }] };
  const original = structuredClone(legacy);
  let projected;
  const manager = { query: async (sql, parameters) => {
    if (sql.includes("insert into catalog.value_set_option_configuration")) projected = JSON.parse(parameters[1]);
    return [];
  } };
  await serviceWith(manager).project(manager, { source_release_id: "release-1", canonical_definition: legacy }, "release-2");
  assert.deepEqual(projected.map((value) => [value.code, value.sort_order, value.is_default]),
    sourceCodeList.values.map((value, index) => [value.code, index, false]));
  assert.deepEqual(legacy, original);
});
