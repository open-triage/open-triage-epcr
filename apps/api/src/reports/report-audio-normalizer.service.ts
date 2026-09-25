import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Injectable } from "@nestjs/common";
import type { ReportAudioSourceContentType } from "@open-triage/contracts";
import { REPORT_AUDIO_MAX_DURATION_MILLISECONDS, ReportAudioValidationError } from "./report-audio.validation.js";

const run = promisify(execFile);
const extensions: Record<ReportAudioSourceContentType, string> = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
};

type Probe = { format?: { duration?: string }; streams?: Array<{ codec_name?: string; codec_type?: string; channels?: number }> };

export type NormalizedAudio = { bytes: Buffer; durationMilliseconds: number };

function missingExecutable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

@Injectable()
export class ReportAudioNormalizer {
  async normalize(source: Buffer, sourceContentType: ReportAudioSourceContentType): Promise<NormalizedAudio> {
    const directory = await mkdtemp(join(tmpdir(), "open-triage-audio-"));
    const input = join(directory, `source.${extensions[sourceContentType]}`);
    const output = join(directory, "canonical.m4a");
    try {
      await writeFile(input, source, { mode: 0o600, flag: "wx" });
      const sourceProbe = await this.probe(input);
      this.assertDuration(sourceProbe, "source recording");
      await this.ffmpeg(["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", input, "-map_metadata", "-1", "-map_chapters", "-1",
        "-vn", "-ac", "1", "-ar", "48000", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4", output]);
      const canonicalProbe = await this.probe(output);
      const durationMilliseconds = this.assertCanonical(canonicalProbe);
      // A successful full decode is required in addition to container probing.
      await this.ffmpeg(["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", output, "-f", "null", "-"]);
      return { bytes: await readFile(output), durationMilliseconds };
    } catch (error) {
      if (error instanceof ReportAudioValidationError) throw error;
      throw new ReportAudioValidationError(["recording could not be decoded and normalized"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  protected async ffmpeg(args: readonly string[]): Promise<void> {
    const configured = process.env.FFMPEG_PATH;
    try {
      await run(configured || "ffmpeg", args, { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (error) {
      if (configured || !missingExecutable(error)) throw error;
      const fallback = (await import("ffmpeg-static")).default as unknown as string | null;
      if (!fallback) throw error;
      await run(fallback, args, { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    }
  }

  protected async probe(path: string): Promise<Probe> {
    const args = ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_entries", "format=duration:stream=codec_name,codec_type,channels", "-of", "json", path];
    const configured = process.env.FFPROBE_PATH;
    let stdout: string;
    try {
      ({ stdout } = await run(configured || "ffprobe", args, { timeout: 15_000, maxBuffer: 256 * 1024 }));
    } catch (error) {
      if (configured || !missingExecutable(error)) throw error;
      const fallback = (await import("ffprobe-static")).default.path;
      ({ stdout } = await run(fallback, args, { timeout: 15_000, maxBuffer: 256 * 1024 }));
    }
    return JSON.parse(stdout) as Probe;
  }

  private assertDuration(probe: Probe, label: string): number {
    const milliseconds = Math.round(Number(probe.format?.duration) * 1000);
    if (!Number.isFinite(milliseconds) || milliseconds < 1) throw new ReportAudioValidationError([`${label} has no decodable duration`]);
    if (milliseconds > REPORT_AUDIO_MAX_DURATION_MILLISECONDS + 250) {
      throw new ReportAudioValidationError([`${label} exceeds the five-minute limit`]);
    }
    return Math.min(milliseconds, REPORT_AUDIO_MAX_DURATION_MILLISECONDS);
  }

  private assertCanonical(probe: Probe): number {
    const stream = probe.streams?.find(({ codec_type }) => codec_type === "audio");
    if (!stream || stream.codec_name !== "aac" || stream.channels !== 1) {
      throw new ReportAudioValidationError(["normalized recording is not mono AAC"]);
    }
    return this.assertDuration(probe, "normalized recording");
  }
}
