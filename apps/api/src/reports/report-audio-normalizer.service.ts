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
      const declaredDuration = Number(sourceProbe.format?.duration);
      // Live MediaRecorder WebM time slices need not carry container duration.
      // Decode a bounded interval rather than rejecting valid captured speech.
      if (Number.isFinite(declaredDuration) && declaredDuration > 0) this.assertDuration(sourceProbe, "source recording");
      else this.assertMilliseconds(await this.decodedDuration(input), "source recording");
      await this.ffmpeg(["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", input, "-map_metadata", "-1", "-map_chapters", "-1",
        "-vn", "-t", String((REPORT_AUDIO_MAX_DURATION_MILLISECONDS + 1000) / 1000),
        "-ac", "1", "-ar", "48000", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-f", "mp4", output]);
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
    await this.ffmpegOutput(args);
  }

  protected async decodedDuration(path: string): Promise<number> {
    const progress = await this.ffmpegOutput(["-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe", "-i", path,
      "-map", "0:a:0", "-vn", "-t", String((REPORT_AUDIO_MAX_DURATION_MILLISECONDS + 1000) / 1000), "-progress", "pipe:1", "-nostats", "-f", "null", "-"]);
    const times = [...progress.matchAll(/^out_time_us=(\d+)\r?$/gm)].map(match => Number(match[1]) / 1000);
    return times.length ? Math.round(Math.max(...times)) : NaN;
  }

  protected async ffmpegOutput(args: readonly string[]): Promise<string> {
    const configured = process.env.FFMPEG_PATH;
    try {
      return (await run(configured || "ffmpeg", args, { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
    } catch (error) {
      if (configured || !missingExecutable(error)) throw error;
      const fallback = (await import("ffmpeg-static")).default as unknown as string | null;
      if (!fallback) throw error;
      return (await run(fallback, args, { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
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
    return this.assertMilliseconds(milliseconds, label);
  }

  private assertMilliseconds(milliseconds: number, label: string): number {
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
