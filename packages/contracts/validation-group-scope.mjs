/** Required singleton children are evaluated with their containing occurrence.
 * Optional and repeating groups establish their own applicability boundary.
 */
export function validationOccurrenceScope(groupId, groups) {
  let current = groupId;
  const visited = new Set();
  while (!visited.has(current)) {
    visited.add(current);
    const group = groups.get(current);
    if (!group || group.repeating || group.intrinsicOccurrence.min === 0
      || !group.parentGroupId || !groups.has(group.parentGroupId)) break;
    current = group.parentGroupId;
  }
  return current;
}
