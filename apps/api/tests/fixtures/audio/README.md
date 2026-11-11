These synthetic tones were captured with the repository-pinned Playwright Chromium's real `MediaRecorder`, an `AudioContext` oscillator, 64 kbit/s encoding, 1000 ms time slices and approximately 1.6 seconds of capture. They contain no speech or clinical data.

The WebM fixture has valid Opus packets but no container duration. The MP4 fixture has Opus packets and a container duration. Both must pass actual FFmpeg conversion and a complete canonical mono-AAC decode; a container-metadata-only mock does not cover live browser capture.

Regenerate explicitly with `node apps/api/tests/fixtures/audio/generate.mjs` after installing the repository-pinned Playwright Chromium. The generator uses a Web Audio oscillator and never requests microphone permission.
