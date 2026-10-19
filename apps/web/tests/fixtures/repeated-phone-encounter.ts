import type { EncounterDocument } from "@open-triage/contracts";
import synthetic from "../../app/data/synthetic-encounter-document.json";
import dispatch from "../../../../packages/contracts/examples/dispatch/synthetic-assignment-03.json";

/** The ordinary multi-phone example keeps repetition tests independent of EPS patients. */
export function repeatedPhoneEncounter(): EncounterDocument {
  return { ...structuredClone(synthetic), groups: structuredClone(dispatch.groups) } as EncounterDocument;
}
