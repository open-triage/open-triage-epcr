import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Explicit regeneration only. These are synthetic tones, never microphone input.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const clips = await page.evaluate(async () => {
    const result = [];
    for (const [type, extension] of [['audio/mp4', 'm4a'], ['audio/webm;codecs=opus', 'webm']]) {
      if (!MediaRecorder.isTypeSupported(type)) throw new Error(`The pinned Chromium cannot generate ${type}`);
      const context = new AudioContext(), source = context.createOscillator(), destination = context.createMediaStreamDestination();
      source.connect(destination); source.start();
      const recorder = new MediaRecorder(destination.stream, { mimeType: type, audioBitsPerSecond: 64000 }), chunks = [];
      const stopped = new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
      recorder.addEventListener('dataavailable', event => chunks.push(event.data)); recorder.start(1000);
      await new Promise(resolve => setTimeout(resolve, 1600)); recorder.stop(); await stopped;
      const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
      let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
      result.push({ extension, base64: btoa(binary) });
      destination.stream.getTracks().forEach(track => track.stop()); source.stop(); await context.close();
    }
    return result;
  });
  for (const { extension, base64 } of clips) {
    const bytes = Buffer.from(base64, 'base64');
    await writeFile(new URL(`chromium-timeslices.${extension}`, import.meta.url), bytes, { mode: 0o600 });
    console.log(`Generated synthetic ${extension}: ${bytes.length} bytes`);
  }
} finally { await browser.close(); }
