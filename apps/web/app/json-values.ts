/** Compare JSON-shaped application data without allocating serialized copies.
 * Optional undefined object properties have the same persisted value as absent
 * properties; object insertion order does not affect the comparison.
 */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]));
  }
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  const keys = Object.keys(first).filter((key) => first[key] !== undefined);
  return keys.length === Object.keys(second).filter((key) => second[key] !== undefined).length &&
    keys.every((key) => Object.hasOwn(second, key) && sameJsonValue(first[key], second[key]));
}
