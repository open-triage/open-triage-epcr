export type FieldType = "text" | "date" | "time" | "select" | "multiselect" | "number";

export interface OptionDefinition {
  value: string;
  label: string;
  system?: string;
}

export interface FieldDefinition {
  id: string;
  source?: { standard: "NEMSIS"; version: "3.5.1"; element: string };
  label: string;
  type: FieldType;
  required: boolean;
  options?: OptionDefinition[];
}

export interface SectionDefinition {
  id: string;
  title: string;
  fields: FieldDefinition[];
}

export interface FormDefinition {
  id: string;
  version: string;
  locale: string;
  sections: SectionDefinition[];
}

export interface HealthResponse {
  status: "ok";
  service: "open-triage-api";
}
