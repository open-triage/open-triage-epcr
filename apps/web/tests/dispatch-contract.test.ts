import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { AnySchema } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { NEMSIS_DATA_MODEL, type NemsisDataElement } from "../app/nemsis-data-model";

type DispatchValue = {
  kind: "scalar" | "coded" | "null" | "pertinent-negative";
  occurrenceId: string;
  value?: string | number | boolean;
  code?: string;
  display?: string;
  notValue?: { code: string; display?: string };
  system?: string;
  attributes?: Record<string, string>;
};

type DispatchMessage = {
  messageId: string;
  sourceRecordId: string;
  revision: number;
  eventType: "upsert" | "cancel";
  groups: Array<{
    id: string;
    instances: Array<{
      instanceId: string;
      parentInstanceId?: string;
      elements: Array<{ id: string; values: DispatchValue[] }>;
    }>;
  }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const schemaPath = resolve(root, "packages/contracts/dispatch-message.schema-1.0.0.json");
const examplePaths = [
  ...Array.from({ length: 10 }, (_, index) => resolve(root, `packages/contracts/examples/dispatch/synthetic-assignment-${String(index + 1).padStart(2, "0")}.json`)),
  resolve(root, "packages/contracts/examples/dispatch/synthetic-update.json"),
  resolve(root, "packages/contracts/examples/dispatch/synthetic-cancellation.json"),
];

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function lexicalValue(value: DispatchValue): string | number | boolean | undefined {
  return value.kind === "scalar" ? value.value : value.kind === "coded" ? value.code : undefined;
}

function validateDatatype(element: NemsisDataElement, value: DispatchValue): void {
  const lexical = lexicalValue(value);
  if (lexical === undefined) return;
  const { base, constraints } = element.datatype;

  if (base === "integer") assert.match(String(lexical), /^-?[0-9]+$/, `${element.id} must be an integer`);
  if (base === "decimal") assert.match(String(lexical), /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/, `${element.id} must be decimal`);
  if (base === "boolean") assert.equal(typeof lexical, "boolean", `${element.id} must be boolean`);
  if (base === "date") assert.match(String(lexical), /^\d{4}-\d{2}-\d{2}(?:Z|[+-]\d{2}:\d{2})?$/, `${element.id} must be an XSD date`);
  if (base === "dateTime") assert.match(String(lexical), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/, `${element.id} must be offset-aware`);

  const text = String(lexical);
  if (typeof constraints.length === "number") assert.equal(text.length, constraints.length, `${element.id} length`);
  if (typeof constraints.minLength === "number") assert.ok(text.length >= constraints.minLength, `${element.id} minimum length`);
  if (typeof constraints.maxLength === "number") assert.ok(text.length <= constraints.maxLength, `${element.id} maximum length`);
  if (typeof constraints.pattern === "string") assert.match(text, new RegExp(`^(?:${constraints.pattern})$`), `${element.id} pattern`);
}

function validateValue(element: NemsisDataElement, value: DispatchValue): void {
  if (value.kind === "null") {
    assert.ok(element.nillable, `${element.id} is not nillable`);
    assert.ok(element.permittedNotValues.some(({ code }) => code === value.notValue?.code), `${element.id} null code`);
    return;
  }
  if (value.kind === "pertinent-negative") {
    assert.ok(element.permittedPertinentNegatives.some(({ code }) => code === value.code), `${element.id} pertinent-negative code`);
    return;
  }

  const coded = element.valueSource.kind !== "scalar";
  assert.equal(value.kind, coded ? "coded" : "scalar", `${element.id} value kind`);
  validateDatatype(element, value);

  if (value.kind === "coded" && element.valueSource.kind === "inline-enumerated") {
    const option = element.valueSource.values.find(({ code }) => code === value.code);
    assert.ok(option, `${element.id} code ${value.code} is not in the pinned catalog`);
    if (value.display !== undefined) assert.equal(value.display, option.label, `${element.id} display`);
  }

  if (value.kind === "coded" && "bundledListIds" in element.valueSource && element.valueSource.bundledListIds.length > 0) {
    const options = element.valueSource.bundledListIds.flatMap((id) => NEMSIS_DATA_MODEL.bundledLists.find((list) => list.id === id)?.values ?? []);
    const option = options.find(({ code }) => code === value.code);
    assert.ok(option, `${element.id} code ${value.code} is not in the pinned bundled list`);
    if (value.display !== undefined) assert.equal(value.display, option.label, `${element.id} display`);
    if (value.system !== undefined && option.codeSystem !== undefined) assert.equal(value.system, option.codeSystem, `${element.id} code system`);
  }

  if (value.kind === "coded" && element.valueSource.kind === "external-code-system" && value.system !== undefined) {
    assert.ok(element.valueSource.systems.some(({ id }) => id === value.system), `${element.id} code system ${value.system} is not in the pinned catalog`);
  }

  for (const [name, attributeValue] of Object.entries(value.attributes ?? {})) {
    assert.equal(element.id, "ePatient.18", `${name} is not valid on ${element.id}`);
    assert.equal(name, "PhoneNumberType", `${name} is not a valid ePatient.18 attribute`);
    assert.ok(["9913001", "9913003", "9913005", "9913007", "9913009"].includes(attributeValue), `${attributeValue} is not a pinned PhoneNumberType`);
  }
}

function validateAgainstCatalog(message: DispatchMessage): void {
  const groupsById = new Map(NEMSIS_DATA_MODEL.groups.map((group) => [group.id, group]));
  const elementsById = new Map(NEMSIS_DATA_MODEL.elements.map((element) => [element.id, element]));
  const instanceGroups = new Map<string, string>();
  const occurrenceIds = new Set<string>();

  for (const group of message.groups) {
    assert.ok(groupsById.has(group.id), `unknown NEMSIS group ${group.id}`);
    for (const instance of group.instances) {
      assert.ok(!instanceGroups.has(instance.instanceId), `duplicate group instance ${instance.instanceId}`);
      instanceGroups.set(instance.instanceId, group.id);
    }
  }

  for (const group of message.groups) {
    const catalogGroup = groupsById.get(group.id)!;
    assert.ok(catalogGroup.occurrence.max === "unbounded" || group.instances.length <= catalogGroup.occurrence.max, `${group.id} cardinality`);
    for (const instance of group.instances) {
      if (catalogGroup.parentId === null) assert.equal(instance.parentInstanceId, undefined, `${group.id} root cannot have a parent`);
      else {
        assert.ok(instance.parentInstanceId, `${group.id} requires parentInstanceId`);
        assert.equal(instanceGroups.get(instance.parentInstanceId!), catalogGroup.parentId, `${group.id} parent placement`);
      }

      const seenElements = new Set<string>();
      for (const supplied of instance.elements) {
        const element = elementsById.get(supplied.id);
        assert.ok(element, `unknown NEMSIS element ${supplied.id}`);
        assert.equal(element.groupPath.at(-1), group.id, `${supplied.id} is not valid in ${group.id}`);
        assert.ok(!seenElements.has(supplied.id), `duplicate ${supplied.id} container`);
        seenElements.add(supplied.id);
        assert.ok(element.occurrence.max === "unbounded" || supplied.values.length <= element.occurrence.max, `${supplied.id} cardinality`);
        for (const value of supplied.values) {
          assert.ok(!occurrenceIds.has(value.occurrenceId), `duplicate occurrence ${value.occurrenceId}`);
          occurrenceIds.add(value.occurrenceId);
          validateValue(element, value);
        }
      }
    }
  }
}

function findElement(message: DispatchMessage, id: string): { values: DispatchValue[] } | undefined {
  return message.groups.flatMap((group) => group.instances).flatMap((instance) => instance.elements).find((element) => element.id === id);
}

function identities(message: DispatchMessage): { instances: Set<string>; occurrences: Set<string> } {
  const instances = message.groups.flatMap((group) => group.instances);
  return {
    instances: new Set(instances.map(({ instanceId }) => instanceId)),
    occurrences: new Set(instances.flatMap(({ elements }) => elements).flatMap(({ values }) => values).map(({ occurrenceId }) => occurrenceId)),
  };
}

test("synthetic dispatch lifecycle validates against the strict envelope and pinned NEMSIS catalog", async () => {
  const schema = await json(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema as AnySchema);
  const messages = (await Promise.all(examplePaths.map(json))) as DispatchMessage[];

  for (const [index, message] of messages.entries()) {
    assert.ok(validateSchema(message), `${examplePaths[index]}: ${ajv.errorsText(validateSchema.errors)}`);
    validateAgainstCatalog(message);
    assert.equal(findElement(message, "eScene.09"), undefined, `${examplePaths[index]} must leave Incident Location Type for clinical documentation`);
  }

  assert.deepEqual(messages.map(({ revision }) => revision), [...Array(10).fill(1), 2, 3]);
  assert.equal(new Set(messages.map(({ sourceRecordId }) => sourceRecordId)).size, 10);
  assert.equal(new Set(messages.map(({ messageId }) => messageId)).size, 12);
  assert.deepEqual(messages.map(({ eventType }) => eventType), [...Array(11).fill("upsert"), "cancel"]);

  const required = ["eResponse.03", "eResponse.04", "eResponse.13", "eResponse.14", "eTimes.02", "eTimes.03"];
  for (const message of messages) for (const id of required) assert.equal(findElement(message, id)?.values.length, 1, `${id} required in revision ${message.revision}`);
  const assignment = messages[0];
  const cancellation = messages.at(-1);
  assert.ok(assignment && cancellation, "all lifecycle examples must be present");
  assert.ok(findElement(cancellation, "eTimes.14"), "cancellation must include eTimes.14");

  const assignmentIds = identities(assignment);
  for (const later of messages.slice(1)) {
    const laterIds = identities(later);
    for (const id of assignmentIds.instances) assert.ok(laterIds.instances.has(id), `group identity ${id} must remain stable`);
    for (const id of assignmentIds.occurrences) assert.ok(laterIds.occurrences.has(id), `occurrence identity ${id} must remain stable`);
  }

  const phones = findElement(assignment, "ePatient.18")!.values;
  assert.equal(phones.length, 2, "assignment demonstrates repeated telephone values");
  assert.deepEqual(phones.map(({ attributes }) => attributes?.PhoneNumberType), ["9913003", "9913005"]);
});

test("the schema rejects unknown envelope and nested properties", async () => {
  const schema = await json(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema as AnySchema);
  const sample = (await json(examplePaths[0]!)) as DispatchMessage & Record<string, unknown>;

  sample.vendorTypo = true;
  assert.equal(validateSchema(sample), false);
  delete sample.vendorTypo;
  const firstGroup = sample.groups[0];
  assert.ok(firstGroup);
  const firstInstance = firstGroup.instances[0];
  assert.ok(firstInstance);
  (firstInstance as typeof firstInstance & Record<string, unknown>).unstableParent = "typo";
  assert.equal(validateSchema(sample), false);
});

test("sample attributes are grounded in the pinned NEMSIS 3.5.1 XSD", async () => {
  const patientXsd = await readFile(resolve(root, "apps/web/app/data/nemsis-3.5.1-sources/xsd/ePatient_v3.xsd"), "utf8");
  const commonXsd = await readFile(resolve(root, "apps/web/app/data/nemsis-3.5.1-sources/xsd/commonTypes_v3.xsd"), "utf8");
  const phoneElement = patientXsd.match(/<xs:element name="ePatient\.18"[\s\S]*?<\/xs:element>/)?.[0] ?? "";
  const phoneType = commonXsd.match(/<xs:simpleType name="PhoneNumberType">[\s\S]*?<\/xs:simpleType>/)?.[0] ?? "";

  assert.match(phoneElement, /<xs:attribute name="PhoneNumberType" type="PhoneNumberType" use="optional"\/>/);
  assert.match(phoneType, /<xs:enumeration value="9913003">[\s\S]*?<xs:documentation>Home<\/xs:documentation>/);
  assert.match(phoneType, /<xs:enumeration value="9913005">[\s\S]*?<xs:documentation>Mobile<\/xs:documentation>/);
});
