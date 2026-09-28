
export const REPORT_PHOTO_CAPTION_MAX_CHARACTERS = 1_000;
export const CANONICAL_PHOTO_LONGEST_EDGE = 2_560;
export const CANONICAL_PHOTO_JPEG_QUALITY = 0.92;
const UNSAFE_CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\p{Cf}]/u;

export function cameraRequestConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" } },
  };
}

export function canonicalPhotoDimensions(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  const rotated = Math.abs(quarterTurns % 2) === 1;
  const orientedWidth = rotated ? height : width;
  const orientedHeight = rotated ? width : height;
  const scale = Math.min(1, CANONICAL_PHOTO_LONGEST_EDGE / Math.max(orientedWidth, orientedHeight));
  return { width: Math.max(1, Math.round(orientedWidth * scale)), height: Math.max(1, Math.round(orientedHeight * scale)) };
}

export function normalizePhotoCaption(value: string): { caption: string | null; characterCount: number; error: string | null } {
  const caption = value.normalize("NFC").trim();
  const characterCount = [...caption].length;
  return {
    caption: caption || null,
    characterCount,
    error: UNSAFE_CONTROL_CHARACTER.test(caption)
      ? "Photo captions cannot contain control characters."
      : characterCount > REPORT_PHOTO_CAPTION_MAX_CHARACTERS
        ? `Photo captions are limited to ${REPORT_PHOTO_CAPTION_MAX_CHARACTERS.toLocaleString()} characters.`
        : null,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("The captured frame could not be encoded.")),
    type,
    quality,
  ));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

export async function normalizeCapturedPhoto(source: Blob, quarterTurns: number): Promise<{
  blob: Blob; canonicalBase64: string; sha256: string; width: number; height: number;
}> {
  const image = await createImageBitmap(source);
  try {
    const dimensions = canonicalPhotoDimensions(image.width, image.height, quarterTurns);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image normalization is unavailable on this device.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((quarterTurns * Math.PI) / 2);
    const rotated = Math.abs(quarterTurns % 2) === 1;
    const orientedWidth = rotated ? image.height : image.width;
    const scale = canvas.width / orientedWidth;
    context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
    // The server removes metadata that the browser's JPEG encoder may add.
    const blob = await canvasBlob(canvas, "image/jpeg", CANONICAL_PHOTO_JPEG_QUALITY);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const sha256 = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
    return { blob, canonicalBase64: bytesToBase64(bytes), sha256, ...dimensions };
  } finally {
    image.close();
  }
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) throw new Error("Wait for the live camera preview before taking a photo.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Camera capture is unavailable on this device.");
  context.drawImage(video, 0, 0);
  return canvasBlob(canvas, "image/png");
}
