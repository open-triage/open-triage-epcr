import { commandSha256 } from "../../dist/reports/draft-report.validation.js";
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { signedPdfFixture } from './signed-pdf-source.mjs';
export async function signedPdfMediaFixture() {
  const {source, manifest} = signedPdfFixture();
  source.photoBytes = {};
  for (let i = 0; i < 2; i++) {
    const bytes = await sharp({create:{width:640,height:360,channels:3,background:i ? '#e1b45b' : '#498f95'}}).jpeg().toBuffer();
    const note = {id:`photo-${i}`,type:'photo', capturedAt:'2026-10-19T10:00:00.000Z',capturedUtcOffsetMinutes:120,
      author:{id:source.signerId,displayName:'Alex Example'},normalizedCaption:`Fictional demonstration photo ${i+1} — no patient image`,
      media:{mimeType:'image/jpeg',byteSize:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}};
    source.notes.push(note); source.photoBytes[note.id]=bytes;
  }
  source.notes.push({id:'audio-1',type:'audio',capturedAt:'2026-10-19T10:01:00.000Z',capturedUtcOffsetMinutes:120,
    author:{id:source.signerId,displayName:'Alex Example'},media:{mimeType:'audio/mp4',byteSize:100,sha256:'a'.repeat(64),durationMilliseconds:12345}});
  source.canonicalSha256 = commandSha256(manifest);
  return {source, manifest};
}
