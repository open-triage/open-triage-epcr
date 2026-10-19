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
    assert.equal(pages.length, 5, "no blank footer-only pages");
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
