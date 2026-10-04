/** Match the canonical element/value-set choices exposed to the validation compiler. */
export function canonicalValidationCatalog(definition) {
  return {
    elements: definition.elements.map(element => ({ elementId: element.id, label: element.name,
      baseDatatype: element.datatype.base, groupPath: element.groupPath, intrinsicOccurrence: element.occurrence })),
    groups: definition.groups.map(group => ({ groupId: group.id, label: group.name, repeating: group.repeating,
      parentGroupId: group.parentId, intrinsicOccurrence: group.occurrence })),
    codes: definition.elements.flatMap(element => [
      ...(element.valueSource.values ?? []).map(value => ({ elementId: element.id, code: value.code,
        label: value.label, codeSystem: "" })),
      ...definition.bundledLists.filter(list => element.valueSource.bundledListIds?.includes(list.id))
        .flatMap(list => list.values.map(value => ({ elementId: element.id, code: value.code,
          label: value.label, codeSystem: value.codeSystem }))),
    ]),
  };
}
