import source from "./data/nemsis-data-model-3.5.1.json";

export type NemsisOccurrence = { readonly min: number; readonly max: number | "unbounded" };

export type NemsisDataElement = {
  readonly id: string;
  readonly section: string;
  readonly name: string;
  readonly definition: string;
  readonly national: boolean;
  readonly state: boolean;
  readonly usage: "Mandatory" | "Required" | "Recommended" | "Optional";
  readonly sourceDatatype: string;
  readonly occurrence: NemsisOccurrence;
};

export type NemsisDataModel = {
  readonly catalog: "nemsis-ems-data-model";
  readonly release: "3.5.1";
  readonly dataset: "EMSDataSet";
  readonly elementCount: number;
  readonly elements: ReadonlyArray<NemsisDataElement>;
};

export const NEMSIS_DATA_MODEL = source as NemsisDataModel;
export const NEMSIS_ELEMENT_IDS: ReadonlySet<string> = new Set(NEMSIS_DATA_MODEL.elements.map((element) => element.id));

if (NEMSIS_DATA_MODEL.elementCount !== NEMSIS_ELEMENT_IDS.size) {
  throw new Error("Bundled NEMSIS data model contains duplicate or missing elements");
}

export function getNemsisDataElement(id: string): NemsisDataElement | undefined {
  return NEMSIS_DATA_MODEL.elements.find((element) => element.id === id);
}
