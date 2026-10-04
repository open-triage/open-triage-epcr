import { withCustomGenerationModel } from '@open-triage/contracts/synthetic-record-generator';
export { generateDocument, validationProblems } from '@open-triage/contracts/synthetic-record-generator';

const PROVENANCE = 'stationary-populate-v1';
const attributes = () => ({ 'x-open-triage-demo': PROVENANCE });

/** Shape is loaded from the agency's pinned catalog, including local extensions. */
export async function loadGenerationModel(manager, configuration, releaseId) {
  const elements = await manager.query(`select e.element_id as id, e.base_datatype as base,
    e.group_path as path, e.definition, e.min_occurs as minimum, e.max_occurs as maximum
    from catalog.element_definition e join catalog.analytics_element_mapping m
      on m.release_id=e.release_id and m.element_id=e.element_id where e.release_id=$1`, [releaseId]);
  const groups = await manager.query(`select group_id as id, parent_group_id as parent,
    min_occurs as minimum, max_occurs as maximum from catalog.group_definition where release_id=$1`, [releaseId]);
  return withCustomGenerationModel(configuration, { elements, groups });
}

/** Persist through the existing draft service with explicit demo provenance. */
export function documentMutations(document, source, model) {
  const metadata = new Map(model.elements.map(element => [element.id, element]));
  const groupMetadata = new Map(model.groups.map(group => [group.id, group]));
  const previous = new Set(source.groups.flatMap(group => group.instances.flatMap(instance => instance.elements.flatMap(element => element.values.map(value => value.occurrenceId)))));
  const groups = [], occurrences = [];
  for (const group of document.groups) for (const [ordinal, instance] of group.instances.entries()) {
    groups.push({ id: instance.instanceId, groupId: group.id, ordinal,
      ...(instance.parentInstanceId ? { parentGroupInstanceId: instance.parentInstanceId } : {}),
      ...(groupMetadata.get(group.id)?.customId ? { customGroupDefinitionId: groupMetadata.get(group.id).customId } : {}),
      correlationId: `demo:${PROVENANCE}:${instance.instanceId}` });
    for (const element of instance.elements) for (const [valueOrdinal, value] of element.values.entries()) {
      previous.delete(value.occurrenceId);
      if (element.id === 'eRecord.01') continue;
      const spec = metadata.get(element.id);
      if (!spec) throw new Error(`No metadata for ${element.id}`);
      let draftValue;
      if (value.kind === 'coded') draftValue = { kind: 'coded', code: value.code, ...(value.system ? { codeSystem: value.system } : {}), display: value.display };
      else if (value.kind === 'null') draftValue = { kind: 'null', absenceCode: value.notValue?.code };
      else if (value.kind === 'pertinent-negative') draftValue = { kind: 'pertinent-negative', absenceCode: value.code };
      else if (value.kind === 'scalar') draftValue = { kind: ({ string: 'text', integer: 'integer', decimal: 'numeric',
        boolean: 'boolean', date: 'date', dateTime: 'datetime', time: 'time', duration: 'duration', binary: 'binary', anyURI: 'uri' })[spec.base],
        value: value.value, ...(spec.base === 'dateTime' ? { utcOffsetMinutes: 0, precision: 'second' } : {}) };
      else throw new Error(`Unsupported generated value kind ${value.kind}`);
      occurrences.push({ id: value.occurrenceId, elementId: element.id, groupInstanceId: instance.instanceId, ordinal: valueOrdinal,
        value: draftValue, sourceAttributes: { ...value.attributes, ...attributes() },
        // Dispatch provenance may retain a sourceValue shortcut. Clear it when
        // replacing that value, so reads use the newly persisted typed columns.
        provenanceKind: 'demo', provenanceDetail: { generator: PROVENANCE, source: 'synthetic-record-cli', sourceValue: null } });
    }
  }
  // Removed dispatch values use the ordinary tombstone path before demo population.
  const removals = source.groups.flatMap(group => group.instances.flatMap(instance => instance.elements.flatMap(element =>
    element.values.filter(value => element.id !== 'eRecord.01' && previous.has(value.occurrenceId)).map(value => ({
      id: value.occurrenceId, elementId: element.id, tombstone: true,
    })))));
  return { groups, occurrences, removals };
}
