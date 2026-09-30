import type { ClinicalFormConfiguration } from "@open-triage/contracts";
import type { EncounterDefinition } from "./encounter-definition";
import type { EncounterEvent } from "./standard-encounter";
import { resolveMessage } from "./localization";

export function enabledMobileOptions<T>(options: readonly T[], elementId: string,
  codeOf: (option: T) => string, clinicalForm?: ClinicalFormConfiguration): T[] {
  const configured = clinicalForm?.catalogFields[elementId]?.codeChoices;
  if (!configured) return [...options];
  return configured.flatMap((choice) => options.filter((option) => codeOf(option) === choice.code));
}

export function mobileDisplayDefinition(definition: EncounterDefinition, language: string,
  clinicalForm?: ClinicalFormConfiguration): EncounterDefinition {
  const text = (key: string, fallback: string) => {
    const translated = resolveMessage(language, key);
    return translated === key ? fallback : translated;
  };
  const labels = <T extends Record<string, string>>(prefix: string, values: T): T =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, text(`${prefix}.${key}`, value)])) as T;
  const choice = (elementId: string, code: string, fallback: string) => language === "sv"
    ? clinicalForm?.catalogFields[elementId]?.codeChoices?.find((item) => item.code === code)?.localization?.sv?.label?.trim() || fallback
    : fallback;
  const { vitals, procedure, medication, note } = definition.events;
  return { ...definition, events: { ...definition.events,
    vitals: { ...vitals, labels: labels("mobile.vital", vitals.labels),
      fields: vitals.fields.map((field) => ({ ...field,
        label: text(`mobile.vital.field.${field.id}`, field.label),
        unit: text(`mobile.vital.unit.${field.id}`, field.unit),
        absenceStates: field.absenceStates.filter((state) => state.kind !== "NV" ||
          !clinicalForm?.catalogFields[field.reference]?.choiceOrder ||
          clinicalForm?.catalogFields[field.reference]?.choiceOrder?.some((choice) => choice.kind === "not-value" && choice.code === state.code))
          .map((state) => ({ ...state, label: language === "sv"
          ? clinicalForm?.catalogFields[field.reference]?.exceptionalChoices?.find((item) => item.key === state.code || item.key === `${state.kind === "NV" ? "not-value" : "pertinent-negative"}:${state.code}`)?.localization?.sv?.label || state.label : state.label })) })),
      summary: vitals.summary.map((item) => ({ ...item, label: text(`mobile.vital.summary.${item.fields[0]}`, item.label) })) },
    procedure: { ...procedure, timeline: labels("mobile.procedure.timeline", procedure.timeline),
      outcomeOptions: enabledMobileOptions(procedure.outcomeOptions, "eProcedures.08", (item) => item.code, clinicalForm)
        .map((item) => ({ ...item, label: choice("eProcedures.08", item.code, item.label) })),
      complicationOptions: enabledMobileOptions(procedure.complicationOptions, "eProcedures.07", (item) => item.code, clinicalForm)
        .map((item) => ({ ...item, label: choice("eProcedures.07", item.code, item.label) })) },
    medication: { ...medication, labels: labels("mobile.medication", medication.labels) },
    note: { ...note, labels: { ...note.labels, timelineTitle: text("mobile.textNote", note.labels.timelineTitle) } },
  } };
}

/** Localize coded display text without changing the recorded event or free text. */
export function mobileDisplayEvent(event: EncounterEvent, language: string, clinicalForm?: ClinicalFormConfiguration): EncounterEvent {
  if (language !== "sv") return event;
  const choices = (id: string) => clinicalForm?.catalogFields[id]?.codeChoices ?? [];
  const coded = (id: string, code: string, fallback: string, system?: string) => choices(id)
    .find((item) => item.code === code && (!system || item.codeSystem === system))?.localization?.sv?.label?.trim() || fallback;
  const valueLabel = (id: string, value: string) => choices(id)
    .find((item) => item.code === value || item.label === value || item.sourceLabel === value)?.localization?.sv?.label?.trim() || value;
  if (event.kind === "document") {
    const key = `mobile.timeline.${event.reference}`;
    const fallback = resolveMessage(language, key);
    const title = clinicalForm?.catalogFields[event.reference]?.localization?.sv?.label?.trim()
      || (fallback === key ? event.title : fallback);
    return { ...event, title };
  }
  if (event.procedure) return { ...event, procedure: { ...event.procedure,
    label: coded("eProcedures.03", event.procedure.code, event.procedure.label) } };
  if (event.medication) return { ...event, medication: { ...event.medication,
    label: coded("eMedications.03", event.medication.medicationCode, event.medication.label, event.medication.codeType),
    unit: valueLabel("eMedications.06", event.medication.unit), route: valueLabel("eMedications.04", event.medication.route) } };
  return event;
}
