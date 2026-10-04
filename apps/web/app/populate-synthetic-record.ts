import { compiledValidationBundleSha256, type ClinicalFormConfiguration, type EncounterDocument } from "@open-triage/contracts";
import { generateDocument, randomFromSeed, withCustomGenerationModel } from "@open-triage/contracts/synthetic-record-generator";
import { stableDraftId } from "./draft-report";

/** The CLI's generator, with the current draft and its pinned configuration as inputs. */
export function populateSyntheticRecord(document: EncounterDocument, configuration: ClinicalFormConfiguration,
  now = new Date()): EncounterDocument {
  const validation = configuration.validation;
  if (!validation || compiledValidationBundleSha256(validation.bundle) !== validation.compiledSha256) {
    throw new Error("The report's pinned validation configuration is unavailable or invalid. Reopen the report and try again.");
  }
  const elements = Object.entries(configuration.catalogFields).map(([id, field]) => {
    if (!field.generation) throw new Error(`The pinned catalog for ${id} is unavailable. Reopen the report and try again.`);
    return field.generation;
  });
  const groups = Object.entries(configuration.catalogGroups ?? {}).map(([id, group]) => {
    if (group.parentId === undefined) throw new Error(`The pinned group ${id} is unavailable. Reopen the report and try again.`);
    return { id, parent: group.parentId };
  });
  const dispatched = document.groups.flatMap(group => group.instances.flatMap(instance => instance.elements))
    .find(element => element.id === "eTimes.03")?.values[0];
  const dispatchedAt = new Date(dispatched?.kind === "scalar" ? String(dispatched.value) : document.encounter.createdAt);
  if (!Number.isFinite(+dispatchedAt)) throw new Error("The report has no valid dispatch or creation time.");
  const identity = (key = "value") => stableDraftId(document.encounter.id, `synthetic-populate:${key}`);
  return generateDocument({ source: document, configuration,
    model: withCustomGenerationModel(configuration, { elements, groups }), bundle: validation.bundle,
    dispatchedAt, now, random: randomFromSeed(Number.parseInt(identity("seed").slice(0, 8), 16)),
    preserveExisting: true, createId: identity }).document;
}
