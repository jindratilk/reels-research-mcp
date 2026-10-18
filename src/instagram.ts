// Reel metadata and stream URLs through yt-dlp, which tracks Instagram's
// anonymous web endpoints closely. One lookup per Reel, cached.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { memo } from "./cache.js";
import { ReelsError } from "./errors.js";
import { Limiter } from "./limiter.js";
import { reelUrl } from "./parse.js";

const run = promisify(execFile);
const BIN = process.env.YT_DLP_PATH ?? "yt-dlp";
const PROXY = process.env.REELS_PROXY;

// Instagram throttles anonymous lookups hard: two at a time, spaced out.
const lookups = new Limiter(
  Math.max(1, Number(process.env.REELS_MAX_CONCURRENCY ?? 2)),
  Math.max(0, Number(process.env.REELS_MIN_GAP_MS ?? 700)),
);

export interface Stream {
  url: string;
  headers: Record<string, string>;
  height?: number;
}

export interface ReelComment {
  author: string;
  text: string;
  likes?: number;
  date?: Date;
}

export interface ReelInfo {
  code: string;
  url: string;
  author?: string;
  handle?: string;
  caption: string;
  likes?: number;
  commentCount?: number;
  published?: Date;
  thumbnail?: string;
  audio?: Stream;
  video?: Stream;
  comments: ReelComment[];
}

let versionPromise: Promise<string | undefined> | undefined;

/** yt-dlp version, or undefined when it is not installed. */
export function ytDlpVersion(): Promise<string | undefined> {
  versionPromise ??= run(BIN, ["--version"], { timeout: 10_000 })
    .then((r) => r.stdout.trim())
    .catch(() => undefined);
  return versionPromise;
}

function classify(stderr: string): ReelsError {
  const msg = stderr.split("\n").filter((l) => l.includes("ERROR")).pop() ?? stderr.trim().split("\n").pop() ?? "yt-dlp failed";
  const clean = msg.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "").slice(0, 220);
  if (/429|rate.?limit|too many requests|wait a few minutes/i.test(stderr)) {
    return new ReelsError(`Instagram is rate-limiting this IP: ${clean}`, "rate_limited");
  }
  if (/login|log in|cookies|private|restricted|age/i.test(stderr)) {
    return new ReelsError(`This Reel is not available without a login (private, age-restricted or blocked): ${clean}`, "login_required");
  }
  if (/not found|404|unavailable|removed|does not exist/i.test(stderr)) {
    return new ReelsError(`Reel not found or removed: ${clean}`, "not_found");
  }
  return new ReelsError(clean, "failed");
}

function pickAudio(formats: any[]): Stream | undefined {
  const a = formats
    .filter((f) => f.vcodec === "none" && f.acodec && f.acodec !== "none" && f.url)
    .sort((x, y) => (y.abr ?? 0) - (x.abr ?? 0))[0];
  return a ? { url: a.url, headers: a.http_headers ?? {} } : undefined;
}

function pickVideo(formats: any[]): Stream | undefined {
  const maxH = Number(process.env.REELS_FRAME_MAX_HEIGHT ?? 1280);
  const vids = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.url && (f.height ?? 0) > 0);
  const ok = vids.filter((f) => f.height <= maxH).sort((x, y) => y.height - x.height || (y.tbr ?? 0) - (x.tbr ?? 0));
  const v = ok[0] ?? vids.sort((x, y) => x.height - y.height)[0];
  if (v) return { url: v.url, headers: v.http_headers ?? {}, height: v.height };
  // Progressive fallbacks (formats "1", "2", …) carry audio+video in one file.
  const any = formats.find((f) => f.url && f.ext === "mp4");
  return any ? { url: any.url, headers: any.http_headers ?? {} } : undefined;
}

async function lookup(code: string): Promise<ReelInfo> {
  if (!(await ytDlpVersion())) {
    throw new ReelsError("yt-dlp is not installed (brew install yt-dlp, or pip install yt-dlp)", "setup");
  }
  const args = ["-J", "--no-warnings", "--no-playlist", ...(PROXY ? ["--proxy", PROXY] : []), reelUrl(code)];
  let stdout: string;
  try {
    ({ stdout } = await lookups.run(() => run(BIN, args, { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })));
  } catch (e: any) {
    if (e?.killed) throw new ReelsError("Instagram lookup timed out after 60 s", "timeout");
    throw classify(String(e?.stderr ?? e?.message ?? e));
  }
  const j = JSON.parse(stdout);
  const formats: any[] = j.formats ?? [];
  return {
    code,
    url: reelUrl(code),
    author: j.uploader ?? undefined,
    handle: j.channel ?? undefined,
    caption: (j.description ?? "").trim(),
    likes: typeof j.like_count === "number" ? j.like_count : undefined,
    commentCount: typeof j.comment_count === "number" ? j.comment_count : undefined,
    published: j.timestamp ? new Date(j.timestamp * 1000) : undefined,
    thumbnail: j.thumbnail ?? undefined,
    audio: pickAudio(formats),
    video: pickVideo(formats),
    comments: (j.comments ?? []).map((c: any) => ({
      author: c.author ?? "",
      text: (c.text ?? "").trim(),
      likes: typeof c.like_count === "number" ? c.like_count : undefined,
      date: c.timestamp ? new Date(c.timestamp * 1000) : undefined,
    })),
  };
}

export const getReel = memo("reel", lookup);
