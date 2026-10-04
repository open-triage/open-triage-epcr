import type { ClinicalFormConfiguration, CompiledValidationBundle, EncounterDocument } from './src/index.js';

export interface GenerationElement {
  id: string;
  base: string;
  path: readonly string[];
  minimum: number;
  maximum: number | null;
  customId?: string;
  definition: {
    datatype?: { constraints?: Readonly<Record<string, string | number>> };
    valueSource?: { kind: string };
    permittedNotValues?: readonly { code: string }[];
    permittedPertinentNegatives?: readonly { code: string }[];
  };
  choices?: readonly { code: string; label: string; codeSystem?: string }[];
}

export interface GenerationModel {
  elements: GenerationElement[];
  groups: { id: string; parent: string | null; customId?: string; minimum?: number; maximum?: number | null }[];
}

export function withCustomGenerationModel(configuration: ClinicalFormConfiguration, model: GenerationModel): GenerationModel;
export function generateDocument(input: {
  source: EncounterDocument;
  configuration: ClinicalFormConfiguration;
  model: GenerationModel;
  bundle: CompiledValidationBundle;
  dispatchedAt: Date;
  random: () => number;
  now?: Date;
  maxPasses?: number;
  preserveExisting?: boolean;
  createId?: (identity?: string) => string;
}): { document: EncounterDocument; timeline: Record<string, string> };
export function validationProblems(bundle: CompiledValidationBundle, document: EncounterDocument, timestamp: string):
  import('./src/validation-rules.js').ValidationFinding[];
export function normal(random: () => number, mean: number, deviation: number): number;
export function randomFromSeed(state: number): () => number;
export function operationalTimeline(dispatchedAt: Date, random: () => number, latest?: Date): Record<string, string>;
