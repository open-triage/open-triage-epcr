import { createHash } from "node:crypto";
import sharp from "sharp";
import { SignedPdfError, type SignedReportPdfSource } from "./signed-report-pdf.js";

// Explicit simulator policy, not verified COS receiving-system acceptance.
export const SIGNED_PDF_SIMULATOR_LIMITS = Object.freeze({ artifactBytes: 10 * 1024 * 1024,
  photoBytes: 25 * 1024 * 1024, photoPixels: 20_000_000, totalPhotoPixels: 80_000_000 });

/** Decode fully before embedding original canonical bytes; never resample or silently omit. */
export async function verifiedPdfPhotos(source: SignedReportPdfSource): Promise<Map<string, { bytes: Buffer; width: number; height: number }>> {
  const result = new Map<string, { bytes: Buffer; width: number; height: number }>();
  let bytesTotal = 0, pixelsTotal = 0;
  for (const note of source.notes) {
    if (note.type === "audio") {
      if (!Number.isSafeInteger(note.media?.durationMilliseconds) || Number(note.media?.durationMilliseconds) < 1)
        throw new SignedPdfError("pdf.audio-metadata-unavailable", note.id);
      continue;
    }
    if (note.type !== "photo") continue;
    const bytes = source.photoBytes?.[note.id];
    if (!bytes || !note.media || note.media.mimeType !== "image/jpeg" || bytes.length !== note.media.byteSize ||
        createHash("sha256").update(bytes).digest("hex") !== note.media.sha256)
      throw new SignedPdfError("pdf.media-unavailable", note.id);
    bytesTotal += bytes.length;
    if (bytesTotal > SIGNED_PDF_SIMULATOR_LIMITS.photoBytes) throw new SignedPdfError("pdf.media-too-large", note.id);
    try {
      const image = sharp(bytes, { failOn: "warning", limitInputPixels: SIGNED_PDF_SIMULATOR_LIMITS.photoPixels });
      const metadata = await image.metadata();
      if (metadata.format !== "jpeg" || !metadata.width || !metadata.height) throw new Error("Invalid image");
      pixelsTotal += metadata.width * metadata.height;
      if (pixelsTotal > SIGNED_PDF_SIMULATOR_LIMITS.totalPhotoPixels) throw new SignedPdfError("pdf.media-too-large", note.id);
      await image.raw().toBuffer(); // Full decode catches truncated streams PDFKit would merely embed.
      result.set(note.id, { bytes, width: metadata.width, height: metadata.height });
    } catch (error) {
      if (error instanceof SignedPdfError) throw error;
      throw new SignedPdfError("pdf.media-decode-failed", note.id);
    }
  }
  return result;
}
