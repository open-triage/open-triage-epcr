import source from "./data/nemsis-data-model-3.5.1.json";

export type NemsisCodeValue = {
  readonly code: string;
  readonly label: string;
};

export type NemsisListValue = NemsisCodeValue & {
  readonly sourceLabel: string;
  readonly codeSystem?: string;
  readonly category?: string;
};

export type NemsisCodeSystem = {
  readonly id: string;
  readonly label: string;
  readonly url: string;
};

export type NemsisBundledList = {
  readonly id: string;
  readonly name: string;
  readonly classification: "defined" | "suggested";
  readonly publishedAt: string;
  readonly exhaustive: false;
  readonly applicableElements: ReadonlyArray<string>;
  readonly applicableDatatypes: ReadonlyArray<string>;
  readonly systems: ReadonlyArray<NemsisCodeSystem>;
  readonly valueCount: number;
  readonly values: ReadonlyArray<NemsisListValue>;
};

export type NemsisValueSource =
  | { readonly kind: "scalar" }
  | { readonly kind: "inline-enumerated"; readonly exhaustive: true; readonly values: ReadonlyArray<NemsisCodeValue> }
  | { readonly kind: "bundled-list"; readonly exhaustive: false; readonly bundledListIds: ReadonlyArray<string> }
  | { readonly kind: "external-code-system"; readonly exhaustive: false; readonly systems: ReadonlyArray<NemsisCodeSystem>; readonly bundledListIds: ReadonlyArray<string> };

export type NemsisOccurrence = { readonly min: number; readonly max: number | "unbounded" };
export type NemsisDatatype = {
  readonly base: string;
  readonly xsdBase: string;
  readonly constraints: Readonly<Record<string, string | number>>;
};

export type NemsisDataElement = {
  readonly id: string;
  readonly section: string;
  readonly name: string;
  readonly definition: string;
  readonly national: boolean;
  readonly state: boolean;
  readonly usage: "Mandatory" | "Required" | "Recommended" | "Optional";
  readonly sourceDatatype: string;
  readonly datatype: NemsisDatatype;
  readonly occurrence: NemsisOccurrence;
  readonly permittedNotValues: ReadonlyArray<NemsisCodeValue>;
  readonly permittedPertinentNegatives: ReadonlyArray<NemsisCodeValue>;
  readonly valueSource: NemsisValueSource;
};

export type NemsisDataModel = {
  readonly catalog: "nemsis-ems-data-model";
  readonly release: "3.5.1";
  readonly dataset: "EMSDataSet";
  readonly elementCount: number;
  readonly statistics: Readonly<Record<string, number>>;
  readonly provenance: {
    readonly publisher: string;
    readonly release: string;
    readonly retrievedAt: string;
    readonly retrievalMethod: string;
    readonly generator: string;
    readonly sources: ReadonlyArray<{ readonly role: string; readonly path: string; readonly url: string; readonly sha256: string }>;
  };
  readonly bundledLists: ReadonlyArray<NemsisBundledList>;
  readonly elements: ReadonlyArray<NemsisDataElement>;
};

export type ResolvedNemsisElementValues = {
  readonly kind: NemsisValueSource["kind"];
  readonly exhaustive: boolean;
  readonly permissibleValues: ReadonlyArray<NemsisCodeValue | NemsisListValue>;
  readonly notValues: ReadonlyArray<NemsisCodeValue>;
  readonly pertinentNegatives: ReadonlyArray<NemsisCodeValue>;
  readonly externalCodeSystems: ReadonlyArray<NemsisCodeSystem>;
};

export const NEMSIS_DATA_MODEL = source as unknown as NemsisDataModel;
export const NEMSIS_ELEMENT_IDS: ReadonlySet<string> = new Set(NEMSIS_DATA_MODEL.elements.map((element) => element.id));
const bundledListsById = new Map(NEMSIS_DATA_MODEL.bundledLists.map((list) => [list.id, list]));

if (NEMSIS_DATA_MODEL.elementCount !== NEMSIS_ELEMENT_IDS.size) throw new Error("Bundled NEMSIS data model contains duplicate or missing elements");
if (bundledListsById.size !== NEMSIS_DATA_MODEL.bundledLists.length) throw new Error("Bundled NEMSIS data model contains duplicate list identifiers");

export function getNemsisDataElement(id: string): NemsisDataElement | undefined {
  return NEMSIS_DATA_MODEL.elements.find((element) => element.id === id);
}

export function resolveNemsisElementValues(element: NemsisDataElement): ResolvedNemsisElementValues {
  const source = element.valueSource;
  const listIds = "bundledListIds" in source ? source.bundledListIds : [];
  const lists = listIds.map((id) => {
    const list = bundledListsById.get(id);
    if (!list) throw new Error(`NEMSIS element ${element.id} references missing bundled list ${id}`);
    return list;
  });
  const permissibleValues = source.kind === "inline-enumerated" ? source.values : lists.flatMap((list) => list.values);
  return {
    kind: source.kind,
    exhaustive: "exhaustive" in source ? source.exhaustive : true,
    permissibleValues,
    notValues: element.permittedNotValues,
    pertinentNegatives: element.permittedPertinentNegatives,
    externalCodeSystems: source.kind === "external-code-system" ? source.systems : [],
  };
}
