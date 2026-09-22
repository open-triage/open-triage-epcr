import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileValidationRule } from "@open-triage/contracts";

test("every enabled canonical NEMSIS rule compiles against the canonical catalog", async () => {
  const catalogDefinition = JSON.parse(await readFile(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url)));
  const validation = JSON.parse(await readFile(new URL("../../../defines/validation/validation_nemsis-full.json", import.meta.url)));
  const catalog = {
    elements: catalogDefinition.elements.map((element) => ({
      elementId: element.id, label: element.name, baseDatatype: element.datatype.base,
      groupPath: element.groupPath, intrinsicOccurrence: element.occurrence,
    })),
    groups: catalogDefinition.groups.map((group) => ({
      groupId: group.id, label: group.name, repeating: group.repeating,
      ...(group.parentId ? { parentGroupId: group.parentId } : {}),
      intrinsicOccurrence: group.occurrence,
    })),
  };
  const failures = validation.rules.filter((rule) => rule.enabled).flatMap((rule) => {
    const result = compileValidationRule(rule, "00000000-0000-4000-8000-000000000000", catalog);
    return result.compiled ? [] : [{ name: rule.name, diagnostics: result.diagnostics }];
  });
  assert.deepEqual(failures, []);
});
