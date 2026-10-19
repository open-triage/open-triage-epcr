import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderSignedReportPdf } from "../dist/reports/signed-report-pdf.js";
import { signedPdfFixture } from "../tests/fixtures/signed-pdf-source.mjs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
const directory = resolve(process.argv[2] ?? "../../preview");
await mkdir(directory, { recursive: true });
for (const language of ["en", "sv"]) {
  const bytes = await renderSignedReportPdf(signedPdfFixture().source, language);
  const name = `hospital-signed-report-preview-v3-${language}`;
  await writeFile(resolve(directory, `${name}.pdf`), bytes);
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    await writeFile(resolve(directory, `${name}-${index}.png`), canvas.toBuffer("image/png"));
  }
  console.log(`${resolve(directory, `${name}.pdf`)}: ${pdf.numPages} pages`);
  await task.destroy();
}
