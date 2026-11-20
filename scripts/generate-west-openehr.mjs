import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import xmlbuilder from "xmlbuilder";
import {
  decisionSupportCategoryCriteria, decisionSupportCriterionLabel, decisionSupportNegativeCode,
  decisionSupportPickerCategories, isSelectableDecisionSupportCriterion,
} from "@open-triage/contracts";

const source = new URL("../defines/decision_support/west-a-2025.en.json", import.meta.url);
const west = JSON.parse(readFileSync(source, "utf8"));
const labels = JSON.parse(readFileSync(new URL("localization/catalog-labels.json", source), "utf8"));
assert.equal(west.language, "en", "The template requires the English WEST definition");
const messages = JSON.parse(readFileSync(new URL("../apps/web/messages/en.json", import.meta.url), "utf8"));
const output = new URL("../packages/contracts/openehr/west-a-2025.opt", import.meta.url);
const templateId = `OpenTriage ${west.name} ${west.version}`;
const required = [1, 1], optional = [0, 1], repeating = [0, null], oneOrMore = [1, null];

// UUIDv5 in the RFC 9562 URL namespace, stable across builds of the same release.
function templateUid() {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const url = `https://opentriage.org/openehr/templates/${west.key}/${west.version}`;
  const bytes = createHash("sha1").update(namespace).update(url).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes.toString("hex").replace(/^(........)(....)(....)(....)(............)$/, "$1-$2-$3-$4-$5");
}

function interval([lower, upper]) {
  return {
    lower_included: true, upper_included: upper !== null,
    lower_unbounded: false, upper_unbounded: upper === null, lower,
    ...(upper === null ? {} : { upper }),
  };
}

function object(rmType, attributes = [], nodeId = "", occurrences = required, type = "C_COMPLEX_OBJECT") {
  return { "@xsi:type": type, rm_type_name: rmType, occurrences: interval(occurrences), node_id: nodeId, attributes };
}

function single(name, child) {
  return { "@xsi:type": "C_SINGLE_ATTRIBUTE", rm_attribute_name: name, existence: interval(required), children: child };
}

function multiple(name, children, bounds = oneOrMore) {
  return { "@xsi:type": "C_MULTIPLE_ATTRIBUTE", rm_attribute_name: name, existence: interval(required), children,
    cardinality: { is_ordered: false, is_unique: false, interval: interval(bounds) } };
}

function phrase(terminology, codes) {
  const constraint = object("CODE_PHRASE", [], "", required, "C_CODE_PHRASE");
  return object("DV_CODED_TEXT", [single("defining_code", {
    ...constraint, terminology_id: { value: terminology }, code_list: codes,
  })]);
}

function constrainedPrimitive(rmType, attribute, primitive, constraint) {
  return object(rmType, [single(attribute, {
    ...object(primitive, [], "", required, "C_PRIMITIVE_OBJECT"),
    item: { "@xsi:type": `C_${primitive}`, ...constraint },
  })]);
}

function count(upper) {
  return constrainedPrimitive("DV_COUNT", "magnitude", "INTEGER", { range: interval([0, upper]) });
}

function quantity(input) {
  const units = { "mmHg": "mm[Hg]", "°C": "Cel", "/min": "/min", "%": "%" }[input.unit];
  if (!units) throw new Error(`Missing UCUM mapping for ${input.unit}`);
  return { ...object("DV_QUANTITY", [], "", required, "C_DV_QUANTITY"),
    list: { magnitude: interval([input.minValue, input.maxValue]),
      precision: interval([0, input.precision]), units } };
}

const terms = new Map();

function term(code, text, description = text) {
  assert.ok(text, `Missing English term for ${code}`);
  terms.set(code, { "@code": code, items: [
    { "@id": "text", "#text": text }, { "@id": "description", "#text": description },
  ] });
  return code;
}

function field(id, label, value, occurrences = optional, description = label) {
  return object("ELEMENT", [single("value", value)], term(id, label, description), occurrences);
}

function catalogField(id, key, value, occurrences) {
  return field(id, labels[key].title.en, value, occurrences, labels[key].description.en);
}

function choices(key, entries) {
  const system = `https://opentriage.org/codes/${west.key}/${key}`;
  for (const [code, label] of entries) term(`${system}::${code}`, label);
  return phrase(system, entries.map(([code]) => code));
}

const categories = decisionSupportPickerCategories(west.categories);
const categoryChoices = categories.map(category => [category.id, category.displayLabel ?? category.category]);
const positiveCriteria = categories.flatMap(category => decisionSupportCategoryCriteria(category)
  .filter(({ criterion }) => isSelectableDecisionSupportCriterion(criterion))
  .map(({ criterion, labelSuffix }) => [criterion.id, decisionSupportCriterionLabel(criterion, labelSuffix, "en")]));
const negatives = categories.map(category => [decisionSupportNegativeCode(west, category.id),
  `${category.displayLabel ?? category.category} · ${west.assessment.elements.criteria.noneOption.label.en}`]);
const scale = west.assessment.elements.newsScale;
const colours = Object.entries(west.triage_colors);
const colour = choices("overrideColour", colours);

// Keep archetype node IDs independent of the order of inputs in a definition.
const inputFields = [
  ["respiratoryRate", "at0020", "at0040"],
  ["spo2", "at0021", "at0041"],
  ["oxygen", "at0022", "at0042"],
  ["systolic", "at0023", "at0043"],
  ["diastolic", "at0024", "at0044"],
  ["heartRate", "at0025", "at0045"],
  ["consciousness", "at0026", "at0046"],
  ["temperature", "at0027", "at0047"],
];
assert.deepEqual(inputFields.map(([key]) => key).sort(), Object.keys(west.inputs).sort(),
  "Each WEST input needs a measurement and component score in the template");
const observationLabel = key => messages[`mobile.westObservation.${key}`];
const observations = inputFields.map(([key, id]) => {
  const input = west.inputs[key];
  const value = input.values
    ? choices(key, input.values.map(code => [code, observationLabel(`${key}.${code}`)]))
    : quantity(input);
  const label = key === "heartRate" ? messages["mobile.vital.field.heartRate"] : observationLabel(key);
  return field(id, label, value);
});
observations.push(field("at0028", observationLabel("pulse"), quantity(west.inputs.heartRate)));

function cluster(id, label, items) {
  return object("CLUSTER", [multiple("items", items)], term(id, label), optional);
}

const componentScores = inputFields.map(([key, , id]) => field(id, observationLabel(key), count(3)));
const override = cluster("at0050", "Manual override", [
  catalogField("at0051", "overrideColour", colour, required),
  field("at0052", "Entered by", object("DV_IDENTIFIER"), required),
  field("at0053", "Entered at", object("DV_DATE_TIME"), required),
  field("at0054", "Calculated color when override was selected", colour),
  field("at0055", "Inherited from measurement", object("DV_IDENTIFIER")),
]);

// The saved calculation uses "definitive" for the definition's "established".
const statusCodes = { established: ["definitive", "Definitive"], provisional: ["provisional", west.assessment.result.provisionalLabel.en],
  unassessed: ["unassessed", west.assessment.result.unsupportedDraft.label.en] };
const data = object("ITEM_TREE", [multiple("items", [
  catalogField("at0010", "categories", choices("categories", categoryChoices), repeating),
  catalogField("at0011", "criteria", choices("criteria", [...positiveCriteria, ...negatives]), repeating),
  catalogField("at0012", "noWarningCriteria", object("DV_BOOLEAN"), optional),
  catalogField("at0013", "newsScale", choices("newsScale",
    Object.entries(scale.values).map(([code, value]) => [code, value.label.en])), required),
  ...observations,
  cluster("at0030", "Component scores", componentScores),
  catalogField("at0031", "physiologyScore", count(null), optional),
  field("at0032", "Physiology color", colour),
  field("at0033", "Driving criterion", choices("criteria", positiveCriteria)),
  field("at0034", "Calculated WEST color", colour),
  field("at0035", "Calculation status", choices("calculationStatus",
    west.assessment.elements.calculationStatus.options.map(code => statusCodes[code])), required),
  override,
  field("at0036", "Effective WEST color", colour, required),
])], term("at0003", "Assessment data"));

const event = object("POINT_EVENT", [
  single("uid", object("HIER_OBJECT_ID")),
  single("time", object("DV_DATE_TIME")),
  single("data", data),
], term("at0002", "Measurement"), oneOrMore);
const history = object("HISTORY", [multiple("events", [event])], term("at0001", "Assessment history"));
const protocol = object("ITEM_TREE", [multiple("items", [
  field("at0005", "Definition key", constrainedPrimitive("DV_TEXT", "value", "STRING", { list: west.key }), required),
  field("at0006", "Definition version", constrainedPrimitive("DV_TEXT", "value", "STRING", { list: west.version }), required),
])], term("at0004", "Decision support"));

const observation = {
  ...object("OBSERVATION", [single("data", history), single("protocol", protocol)],
    term("at0000", "WEST-A", "Documented adult triage assessment."), required, "C_ARCHETYPE_ROOT"),
  archetype_id: { value: "openEHR-EHR-OBSERVATION.opentriage_west_a.v0" },
  term_definitions: [...terms.values()],
};
const composition = {
  ...object("COMPOSITION", [
    single("category", phrase("openehr", ["433"])),
    single("context", object("EVENT_CONTEXT", [
      { "@xsi:type": "C_SINGLE_ATTRIBUTE", rm_attribute_name: "other_context", existence: interval([0, 0]) },
    ])),
    multiple("content", [observation], required),
  ], "at0000", required, "C_ARCHETYPE_ROOT"),
  archetype_id: { value: "openEHR-EHR-COMPOSITION.encounter.v1" },
  term_definitions: { "@code": "at0000", items: [
    { "@id": "text", "#text": "WEST-A adult triage" },
    { "@id": "description", "#text": "WEST-A assessments during one encounter." },
  ] },
};

const language = { terminology_id: { value: "ISO_639-1" }, code_string: west.language };
const xml = xmlbuilder.create({ template: {
  "@xmlns": "http://schemas.openehr.org/v1", "@xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
  language,
  description: {
    original_author: { "@id": "organisation", "#text": "OpenTriage" }, lifecycle_state: "in_development",
    other_details: [
      { "@id": "WEST definition", "#text": `${west.key} ${west.version}` },
      { "@id": "Clinical criteria", "#text": west.sources.criteria.url },
      { "@id": "Physiology", "#text": west.sources.scores.url },
    ],
    details: { language, purpose: "Record repeated, finalized WEST-A assessments during one encounter." },
  },
  uid: { value: templateUid() }, template_id: { value: templateId },
  concept: "WEST-A adult triage", definition: composition,
} }, { encoding: "UTF-8" }).end({ pretty: true }) + "\n";

if (process.argv.includes("--check")) {
  if (readFileSync(output, "utf8") !== xml) throw new Error("Regenerate west-a-2025.opt from the current WEST definition.");
} else {
  writeFileSync(output, xml);
}
