// ffmpeg reads Instagram's CDN streams directly: audio for transcription,
// and single decoded frames at chosen timestamps. Nothing is kept on disk.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ReelsError } from "./errors.js";
import { Limiter } from "./limiter.js";
import type { Stream } from "./instagram.js";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffmpegLimiter = new Limiter(Math.max(1, Number(process.env.REELS_FFMPEG_CONCURRENCY ?? 3)), 0);

let versionPromise: Promise<string | undefined> | undefined;

export function ffmpegVersion(): Promise<string | undefined> {
  versionPromise ??= run(FFMPEG, ["-version"], { timeout: 10_000 })
    .then((r) => r.stdout.split("\n")[0].replace(/ Copyright.*/, "").trim())
    .catch(() => undefined);
  return versionPromise;
}

function inputArgs(s: Stream): string[] {
  const headers = Object.entries(s.headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  const proxy = process.env.REELS_PROXY ? ["-http_proxy", process.env.REELS_PROXY] : [];
  return [...proxy, ...(headers ? ["-headers", headers] : []), "-i", s.url];
}

async function requireFfmpeg(): Promise<void> {
  if (!(await ffmpegVersion())) throw new ReelsError("ffmpeg is not installed (brew install ffmpeg)", "setup");
}

/** Download the audio track as 16 kHz mono WAV into a fresh temp dir. Caller removes `dir`. */
export async function audioToWav(s: Stream): Promise<{ path: string; dir: string; duration: number }> {
  await requireFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), "reels-audio-"));
  const path = join(dir, "audio.wav");
  try {
    const { stderr } = await ffmpegLimiter.run(() =>
      run(FFMPEG, ["-nostdin", "-hide_banner", ...inputArgs(s), "-vn", "-ac", "1", "-ar", "16000", "-y", path], {
        timeout: 120_000,
      }),
    );
    const m = String(stderr).match(/time=(\d+):(\d+):([\d.]+)/g)?.pop()?.match(/(\d+):(\d+):([\d.]+)/);
    const duration = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
    return { path, dir, duration };
  } catch (e: any) {
    await rm(dir, { recursive: true, force: true });
    throw new ReelsError(`Could not read the Reel's audio: ${String(e?.stderr ?? e?.message).split("\n").filter(Boolean).pop()?.slice(0, 160)}`, "failed");
  }
}

export interface Frame {
  at: number;
  jpeg: Buffer;
}

/** One decoded frame per timestamp; failures are reported per frame. */
export async function grabFrames(
  s: Stream,
  times: number[],
  width: number,
): Promise<{ frames: Frame[]; failed: Array<{ at: number; error: string }> }> {
  await requireFfmpeg();
  const dir = await mkdtemp(join(tmpdir(), "reels-frames-"));
  try {
    const settled = await Promise.allSettled(
      times.map((at) =>
        ffmpegLimiter.run(async () => {
          const out = join(dir, `f${Math.round(at * 1000)}.jpg`);
          await run(
            FFMPEG,
            ["-loglevel", "error", "-nostdin", "-ss", at.toFixed(2), ...inputArgs(s), "-frames:v", "1",
             "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", "-y", out],
            { timeout: 45_000 },
          );
          return { at, jpeg: await readFile(out) };
        }),
      ),
    );
    const frames: Frame[] = [];
    const failed: Array<{ at: number; error: string }> = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") frames.push(r.value);
      else failed.push({ at: times[i], error: String((r.reason as any)?.stderr || (r.reason as any)?.message).split("\n")[0].slice(0, 140) });
    });
    return { frames, failed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Stream duration in seconds via ffprobe (reads only the container header). */
export async function probeDuration(s: Stream): Promise<number | undefined> {
  const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
  const headers = Object.entries(s.headers).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  try {
    const { stdout } = await run(
      FFPROBE,
      ["-v", "error", ...(headers ? ["-headers", headers] : []), "-show_entries", "format=duration", "-of", "csv=p=0", s.url],
      { timeout: 20_000 },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) ? d : undefined;
  } catch {
    return undefined;
  }
}
