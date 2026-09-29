export type FormRuleExpression =
  | { operator: "exists"; field: string }
  | { operator: "equals"; field: string; value: string | number | boolean | null }
  | { operator: "not"; condition: FormRuleExpression }
  | { operator: "and" | "or"; conditions: FormRuleExpression[] };

export interface CanonicalFormRule {
  kind: "visibility" | "requiredness";
  expression: FormRuleExpression;
}

export interface CanonicalFormField {
  key: string;
  source:
    | { kind: "nemsis"; elementId: string }
    | { kind: "custom"; elementDefinitionId: string; groupDefinitionId?: string };
  required?: boolean;
  allowedAbsenceStates?: string[];
  rules?: CanonicalFormRule[];
}

export interface CanonicalFormSection {
  key: string;
  name?: string;
  fields: CanonicalFormField[];
}

export interface CanonicalFormDefinition {
  schemaVersion: 1;
  sections: CanonicalFormSection[];
}

export interface PublishFormVersionCommand {
  publishedBy: string;
  displayName?: string;
  changeNote: string;
  definitionSha256: string;
  warningAcknowledgements?: Record<string, unknown>;
}

export interface PublishedFormVersion {
  id: string;
  displayName?: string;
  status: "published";
  definitionSha256: string;
  publishedAt: string;
  projections: { sections: number; fields: number; rules: number };
}
