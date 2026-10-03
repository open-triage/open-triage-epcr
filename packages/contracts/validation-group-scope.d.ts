export interface ValidationScopeGroup {
  groupId: string;
  repeating: boolean;
  parentGroupId?: string;
  intrinsicOccurrence: { min: number };
}
export declare function validationOccurrenceScope(groupId: string,
  groups: ReadonlyMap<string, ValidationScopeGroup>): string;
