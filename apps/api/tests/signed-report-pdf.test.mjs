import { createHash } from "node:crypto";
import { signedPdfMediaFixture } from "./fixtures/signed-pdf-media.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderSignedReportPdf, effectiveSignedPdfOccurrences } from "../dist/reports/signed-report-pdf.js";
import { signedPdfFixture } from "./fixtures/signed-pdf-source.mjs";

async function inspect(buffer) {
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const pdf = await loading.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push((await page.getTextContent()).items.map((item) => item.str ?? "").join(" "));
  }
  await loading.destroy();
  return pages;
}

test("signed PDF preserves long authored notes, custom fields, repeated groups, Swedish labels and amendment provenance", async () => {
  const { source } = signedPdfFixture();
  const before = structuredClone(source);
  for (const language of ["en", "sv"]) {
    const pdf = await renderSignedReportPdf(source, language);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const pages = await inspect(pdf);
    const text = pages.join(" ").replace(/\s+/g, " ");
    assert.ok(pages.length < 5, "tabular repeated values reduce the original five-page report");
    for (const value of source.occurrences) assert.ok(!text.includes(value.element_id), "technical element IDs are hidden");
    assert.ok(text.replaceAll(" ", "").includes(source.canonicalSha256));
    for (const expected of ["Andrea", "Lindqvist", "FINAL CLINICAL NOTE SENTINEL", "Å, Ä, Ö, é, μ", "88", "86", source.snapshotId])
      assert.ok(text.includes(expected), `Missing ${expected} in ${language} PDF`);
    for (let index = 1; index <= 20; index++) assert.ok(text.includes(`Observation ${index}:`));
    assert.ok(text.includes(language === "sv" ? "Patientens kommunikationsbehov" : "Patient communication needs"));
    assert.ok(text.includes(language === "sv" ? "Post 12" : "Entry 12"));
    assert.ok(pages.every((page) => page.length > 200), "every page must have clinical content");
    assert.ok(pages.every((page) => page.includes(language === "sv" ? "SYNTETISK" : "SYNTHETIC")));
    assert.ok(pages.at(-1).includes(language === "sv" ? "Slut på signerad klinisk version" : "End of signed clinical version"));
  }
  assert.deepEqual(source, before, "rendering must not mutate the signed clinical version");
});

test("explicit amendment boundary and removal/addition preserve exact versions", async () => {
  const { source } = signedPdfFixture();
  assert.equal(effectiveSignedPdfOccurrences(source).find((v) => v.id === "pulse-0").value_integer, 86);
  const original = { ...source, amendments: [], amendmentSequence: 0 };
  assert.equal(effectiveSignedPdfOccurrences(original).find((v) => v.id === "pulse-0").value_integer, 88);
  source.amendments.push({ ...source.amendments[0], sequence: 2, changes: [
    { action: "remove", targetId: "given", original: source.occurrences[0], corrected: null },
    { action: "add", targetId: null, original: null, corrected: { ...source.occurrences[0], id: "new", value_text: "Amended name" } },
  ] });
  source.amendmentSequence = 2;
  const values = effectiveSignedPdfOccurrences(source);
  assert.ok(!values.some((v) => v.id === "given"));
  assert.equal(values.find((v) => v.id === "new").value_text, "Amended name");
  assert.throws(() => effectiveSignedPdfOccurrences({ ...source, amendmentSequence: 4 }), { code: "pdf.invalid-version" });
});

test("rendering fails explicitly for unsupported glyphs, missing pinned definitions and oversized content", async () => {
  const { source } = signedPdfFixture();
  source.notes[0].normalizedText = "Unsupported glyph \u{10FFFF}";
  await assert.rejects(renderSignedReportPdf(source, "en"), { code: "pdf.unsupported-text" });
  source.notes[0].normalizedText = "safe";
  delete source.configuration.customFields;
  await assert.rejects(renderSignedReportPdf(source, "en"), { code: "pdf.definitions-unavailable" });
  const oversized = signedPdfFixture().source;
  oversized.notes[0].normalizedText = "x".repeat(2_000_001);
  await assert.rejects(renderSignedReportPdf(oversized, "en"), { code: "pdf.too-large" });
});

test("media completeness embeds every signed photo and explicit localized audio metadata", async () => {
  const {source} = await signedPdfMediaFixture();
  for (const language of ["en", "sv"]) {
    const bytes = await renderSignedReportPdf(source, language);
    const pages = await inspect(bytes);
    const text = pages.join(" ");
    assert.match(text, /12.345/);
    assert.match(text, /2026-10-19T10:01/);
    assert.ok(text.includes(language === "en" ? "recording was not transferred" : "Ljudinspelningen överfördes inte"));
    assert.match(text, /demonstration photo 1/); assert.match(text, /demonstration photo 2/);
    assert.equal((bytes.toString("latin1").match(/\/Subtype \/Image/g) ?? []).length, 2);
    assert.ok(pages.every(page => page.includes(language === "en" ? "SYNTHETIC" : "SYNTETISK")));
  }
});

test("missing, modified, undecodable, over-budget photos and missing signed duration fail closed", async () => {
  const {source} = await signedPdfMediaFixture();
  const bytes = source.photoBytes['photo-0'];
  delete source.photoBytes['photo-0'];
  await assert.rejects(renderSignedReportPdf(source, 'en'), {code:'pdf.media-unavailable'});
  source.photoBytes['photo-0'] = Buffer.from('invalid JPEG');
  await assert.rejects(renderSignedReportPdf(source, 'en'), {code:'pdf.media-unavailable'});
  const note = source.notes.find(note => note.id === 'photo-0');
  note.media.byteSize = source.photoBytes['photo-0'].length;
  note.media.sha256 = createHash('sha256').update(source.photoBytes['photo-0']).digest('hex');
  await assert.rejects(renderSignedReportPdf(source, 'en'), {code:'pdf.media-decode-failed'});
  source.photoBytes['photo-0'] = Buffer.alloc(26*1024*1024);
  note.media.byteSize = source.photoBytes['photo-0'].length;
  note.media.sha256 = createHash('sha256').update(source.photoBytes['photo-0']).digest('hex');
  await assert.rejects(renderSignedReportPdf(source, 'en'), {code:'pdf.media-too-large'});
  source.photoBytes['photo-0'] = bytes;
  note.media.byteSize = bytes.length; note.media.sha256 = createHash('sha256').update(bytes).digest('hex');
  delete source.notes.at(-1).media.durationMilliseconds;
  await assert.rejects(renderSignedReportPdf(source, 'en'), {code:'pdf.audio-metadata-unavailable'});
});

test("an oversized completed PDF fails instead of omitting its signed photo", async () => {
  const { randomBytes } = await import('node:crypto');
  const { default: sharp } = await import('sharp');
  const {source} = await signedPdfMediaFixture();
  const bytes = await sharp(randomBytes(2500*2500*3), {raw:{width:2500,height:2500,channels:3}})
    .jpeg({quality:100,chromaSubsampling:'4:4:4'}).toBuffer();
  assert.ok(bytes.length > 10*1024*1024 && bytes.length < 25*1024*1024);
  const note = source.notes.find(n => n.id === 'photo-0');
  source.photoBytes[note.id]=bytes;
  note.media.byteSize=bytes.length; note.media.sha256=createHash('sha256').update(bytes).digest('hex');
  await assert.rejects(renderSignedReportPdf(source,'en'),{code:'pdf.too-large'});
});

 test("coded clinical values retain readable meanings without machine codes", async () => {
  const { signedPdfValue } = await import("../dist/reports/signed-report-pdf.js");
  const { source } = signedPdfFixture();
  source.configuration.catalogFields["eVitals.10"].codeChoices = [{code:"999123",codeSystem:"fixture",label:"Regular",localization:{sv:{label:"Regelbunden"}}}];
  for (const language of ["en","sv"]) {
    const value = {id:"coded",element_id:"eVitals.10",value_kind:"coded",code:"999123",code_system:"fixture"};
    assert.equal(signedPdfValue(value,source,language),language === "en" ? "Regular" : "Regelbunden");
    const absent = {...value,value_kind:"null",absence_code:"7701003",absence_display:"Not recorded"};
    assert.ok(signedPdfValue(absent,source,language).includes("Not recorded"));
    assert.ok(!signedPdfValue(absent,source,language).includes("7701003"));
  }
});

test("nested table cells span pages without losing text or parent context", async () => {
  const {source} = signedPdfFixture();
  source.amendments=[]; source.amendmentSequence=0; source.notes=[];
  source.groups=[{id:'parent',group_id:'eVitals.VitalGroup',ordinal:0},
    {id:'child',group_id:'eVitals.VitalGroup',ordinal:0,parent_group_instance_id:'parent'}];
  source.occurrences=[{id:'long',group_instance_id:'child',element_id:'ePatient.03',value_kind:'text',
    value_text:Array.from({length:140},(_,i)=>`Clinical detail ${i} preserved.`).join(' ')+' END OF NESTED VALUE'}];
  const pages=await inspect(await renderSignedReportPdf(source,'en'));
  const text=pages.join(' ').replace(/\s+/g,' ');
  assert.ok(pages.length>1);
  assert.ok(!text.includes('Vital signs'));
  assert.ok(text.includes('Entry 1'));
  assert.ok(text.includes('END OF NESTED VALUE'));
  for(let i=0;i<140;i++) assert.ok(text.includes(`Clinical detail ${i} preserved.`));
  assert.ok(pages[1].includes('Entry 1'), 'continued tables repeat their column headers');
  source.groups[0].parent_group_instance_id='child';
  await assert.rejects(renderSignedReportPdf(source,'en'),{code:'pdf.invalid-version'});
});

test("signed PDFs display clinical and signature instants in the agency time zone", async () => {
  const { signedPdfDateTime, signedPdfValue } = await import('../dist/reports/signed-report-pdf.js');
  const { source } = signedPdfFixture();
  source.timeZone = 'Europe/Stockholm';
  source.signedAt = '2026-10-29T14:55:57Z';
  const occurrence = { id: 'local-time', element_id: 'eVitals.01', value_kind: 'datetime', value_datetime: source.signedAt };
  source.configuration.catalogFields['eVitals.01'] = { name: 'Vital time' };
  assert.match(signedPdfValue(occurrence, source, 'sv'), /15:55:57/);
  assert.match(signedPdfDateTime('2026-07-29T14:55:57Z', 'en', source.timeZone), /16:55:57/);
  const pages = await inspect(await renderSignedReportPdf(source, 'en'));
  assert.match(pages.join(' '), /15:55:57/);
  assert.doesNotMatch(pages.join(' '), /2026-10-29T14:55:57Z/);
});


test("nested measurements align across parent entries without group headings", async () => {
  const { source } = signedPdfFixture();
  source.amendments = []; source.amendmentSequence = 0; source.notes = [];
  source.groups = source.groups.slice(0, 2);
  source.occurrences = source.occurrences.filter(value => source.groups.some(group => group.id === value.group_instance_id));
  source.configuration.catalogGroups.temperature = { name: "Temperature Group" };
  source.configuration.catalogFields.temperature = { name: "Temperature" };
  for (let index = 0; index < 2; index++) {
    source.groups.push({ id: `temperature-${index}`, group_id: 'temperature', ordinal: 0,
      parent_group_instance_id: `vital-${index}` });
    source.occurrences.push({ id: `temperature-value-${index}`, group_instance_id: `temperature-${index}`,
      element_id: 'temperature', value_kind: 'text', value_text: `TEMP${index}` });
  }
  const before = structuredClone(source);
  for (const language of ['en', 'sv']) {
    const text = (await inspect(await renderSignedReportPdf(source, language))).join(' ').replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /Temperature Group|Vital signs|Vitalparametrar/);
    assert.match(text, /Temperature TEMP0 TEMP1/);
    assert.equal(text.split(language === 'en' ? 'Entry 1' : 'Post 1').length - 1, 1);
    assert.ok(text.includes(language === 'en' ? 'Entry 2' : 'Post 2'));
  }
  assert.deepEqual(source, before);
});

test('draft PDF previews are explicitly unsigned and never display a signing attestation',async()=>{
 const {source}=signedPdfFixture();
 source.draftPreview=true;source.amendments=[];source.amendmentSequence=0;
 for(const language of ['en','sv']){
  const pages=await inspect(await renderSignedReportPdf(source,language));
  assert.ok(pages.every(page=>page.includes(language==='en'?'Draft preview':'Förhandsgranskning')));
  assert.ok(!pages.join(' ').includes(language==='en'?'Signed by':'Signerad av'));
  assert.ok(pages.join(' ').includes('Andrea'));
 }
});

test('PDFs retain localized section headers for scalar and nested repeated fields without group headings', async () => {
  const { source } = signedPdfFixture();
  source.amendments = []; source.amendmentSequence = 0; source.notes = [];
  source.configuration.catalogGroups.ePatient = { name: 'Patient details', localization: { schemaVersion: 1, sv: { name: 'Patientuppgifter' } } };
  source.configuration.catalogGroups.eVitals = { name: 'Measurements', localization: { schemaVersion: 1, sv: { name: 'Mätningar' } } };
  source.configuration.definition.sections = [
    { key: 'ePatient', fields: [{ source: { kind: 'nemsis', elementId: 'ePatient.03' } }] },
    { key: 'communication', name: 'Communication', fields: [{ source: { kind: 'custom', elementDefinitionId: source.occurrences[2].element_identity_id } }] },
    { key: 'eVitals', fields: ['eVitals.06', 'eVitals.10'].map(elementId => ({ source: { kind: 'nemsis', elementId } })) },
    { key: 'empty', name: 'Empty section', fields: [] },
  ];
  source.groups.push({ id: 'nested', group_id: 'nested-group', parent_group_instance_id: 'vital-0', ordinal: 0 });
  source.occurrences.find(value => value.id === 'pulse-0').group_instance_id = 'nested';
  for (const draftPreview of [false, true]) for (const language of ['en', 'sv']) {
    source.draftPreview = draftPreview;
    const text = (await inspect(await renderSignedReportPdf(source, language))).join(' ').replace(/\s+/g, ' ');
    const patient = language === 'en' ? 'Patient details' : 'Patientuppgifter';
    const vitals = language === 'en' ? 'Measurements' : 'Mätningar';
    assert.ok(text.indexOf(patient) < text.indexOf('Andrea'));
    assert.ok(text.indexOf('Communication') < text.indexOf('Patient requested'));
    assert.ok(text.indexOf(vitals) < text.indexOf(language === 'en' ? 'Entry 1' : 'Post 1'));
    assert.equal(text.split(vitals).length - 1, 1);
    assert.doesNotMatch(text, /Vital signs|Vitalparametrar|nested-group|Empty section/);
    assert.ok(text.includes('Lindqvist'), 'fields outside the form remain present');
    assert.ok(text.includes('88'), 'nested observations remain present');
  }
});

test('repeated field occurrences use separate table columns, including nested and custom values', async () => {
  const { source } = signedPdfFixture();
  source.amendments = []; source.amendmentSequence = 0; source.notes = [];
  source.groups = source.groups.slice(0, 2);
  source.occurrences = [];
  const customId = Object.keys(source.configuration.customFields)[0];
  for (let entry = 0; entry < 2; entry++) {
    for (let repeat = 0; repeat < 2 - entry; repeat++) {
      const nestedId = `nested-${entry}-${repeat}`;
      source.groups.push({ id: nestedId, group_id: 'nested', parent_group_instance_id: `vital-${entry}`, ordinal: repeat });
      for (const [kind, elementId, groupId] of [
        ['direct', 'eVitals.10', `vital-${entry}`],
        ['nested', 'eVitals.06', nestedId],
        ['custom', 'demo.access', nestedId],
      ]) source.occurrences.push({ id: `${kind}-${entry}-${repeat}`, element_id: elementId,
        ...(kind === 'custom' ? { element_identity_id: customId } : {}),
        group_instance_id: groupId, ordinal: repeat, value_kind: 'text', value_text: `${kind}-${entry}-${repeat}` });
    }
  }
  const before = structuredClone(source);
  for (const draftPreview of [false, true]) for (const language of ['en', 'sv']) {
    const loading = getDocument({ data: new Uint8Array(await renderSignedReportPdf({ ...source, draftPreview }, language)), useSystemFonts: false });
    const pdf = await loading.promise;
    const items = (await (await pdf.getPage(1)).getTextContent()).items;
    for (const [kind, label] of [
      ['direct', language === 'en' ? 'Pulse rate (beats/min)' : 'Puls (slag/min)'],
      ['nested', language === 'en' ? 'Systolic blood pressure (mmHg)' : 'Systoliskt blodtryck (mmHg)'],
      ['custom', language === 'en' ? 'Patient communication needs' : 'Patientens kommunikationsbehov'],
    ]) {
      const first = items.find(item => item.str === `${kind}-0-0`);
      const second = items.find(item => item.str === `${kind}-0-1`);
      const otherEntry = items.find(item => item.str === `${kind}-1-0`);
      assert.ok(first && second && otherEntry);
      assert.equal(first.transform[5], otherEntry.transform[5], 'entries align across columns');
      assert.equal(first.transform[5], second.transform[5], 'repeats share the field row');
      assert.ok(first.transform[4] < second.transform[4] && second.transform[4] < otherEntry.transform[4], 'each occurrence has a separate column');
      // Labels may wrap, so match their first word at the row baseline.
      const labels = items.filter(item => item.str.startsWith(label.split(' ')[0]));
      assert.ok(labels.some(item => item.transform[5] === first.transform[5]));
      assert.equal(labels.filter(item => item.transform[5] === first.transform[5]).length, 1, 'one label for the shared field row');
    }
    await loading.destroy();
  }
  assert.deepEqual(source, before);
});
