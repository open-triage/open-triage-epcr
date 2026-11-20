import west from "./west-a-2025.json" with { type: "json" };

const { catalogFields, uiMessages, ...clinical } = west;

// These fields already carry both languages in the API and offline snapshot format.
const bilingualFields = new Set(["label", "provisionalLabel", "message", "criterionLabelSuffix"]);

function translate(label, language) {
  return Object.hasOwn(label, language) ? label[language] : label.en;
}

// Use the pinned rows and rules. Look up row labels by code so a reordered or
// historical report never acquires criteria or thresholds from the current file.
function resolveLabels(value, template, language, field) {
  if (!template || typeof template !== "object") return value;
  if (Object.hasOwn(template, "en")) {
    if (bilingualFields.has(field)) return { ...value, ...template };
    return translate(template, language);
  }
  if (Array.isArray(value) && Array.isArray(template)) {
    const byId = new Map(template.filter(row => row?.id).map(row => [row.id, row]));
    return value.map((row, index) => resolveLabels(row, row?.id ? byId.get(row.id) : template[index], language));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, resolveLabels(item, template[key], language, key)]));
}

export function localizedWestDefinition(pinned, language) {
  if (pinned.key !== clinical.key || pinned.version !== clinical.version) return pinned;
  return resolveLabels(pinned, clinical, language);
}

export function shippedWestDefinition(language = "sv") {
  return resolveLabels(clinical, clinical, language);
}

export const westColourLabels = clinical.triage_colors;

export function westCatalogText(field, language) {
  const { title, description } = catalogFields[field];
  return { label: translate(title, language), description: translate(description, language) };
}

export function westUiMessages(language) {
  const { elements, result } = clinical.assessment;
  const messages = Object.fromEntries(Object.entries(uiMessages).map(([key, label]) => [key, translate(label, language)]));
  messages["settings.decisionSupportWest"] = clinical.name;
  messages["mobile.westNoCriteriaMet"] = translate(elements.criteria.noneOption.label, language);
  messages["mobile.westUnassessed"] = translate(result.unsupportedDraft.label, language);
  messages["mobile.westColourRequired"] = translate(result.finalization.message, language);
  messages["mobile.westNewsScale"] = translate(elements.newsScale.label, language);
  for (const [code, scale] of Object.entries(elements.newsScale.values)) {
    messages[`mobile.westScale.${code}`] = translate(scale.label, language);
  }
  for (const [code, label] of Object.entries(westColourLabels)) {
    messages[`mobile.westColour.${code}`] = translate(label, language);
  }
  return messages;
}
