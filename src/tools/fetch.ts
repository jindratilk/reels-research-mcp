import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getReel, type ReelInfo } from "../instagram.js";
import { grabFrames, probeDuration } from "../media.js";
import { transcriptFor } from "../transcribe.js";
import { findHighlights } from "../highlights.js";
import { ReelsError } from "../errors.js";
import { compactNumber, formatClock, isoDay, parseShortcode, type Segment } from "../parse.js";
import { lenientArray, lenientNumber, READ_ONLY, timeValue } from "../schema.js";
import { errorText } from "./common.js";

const PARTS = ["details", "transcript", "frames", "comments", "cover"] as const;
type Part = (typeof PARTS)[number];

const DESCRIPTION = `Read Instagram Reels from their URLs, without a login: details (author, caption, likes, comment count, date), a timestamped transcript of what is said (local speech-to-text, Parakeet Redux, 25 European languages), real video frames, preview comments and the cover image. Batch up to 20 Reels per call.

Best for: hooks (what is said and shown in the first seconds), quoting what creators say, comparing how Reels open, reading on-screen text from frames.
Returns: per Reel a header and the requested parts; per-Reel failures are reported inline with a reason code, never dropped.

Tips:
- Hooks: start=0, end=5 (or 0–10) with parts ["details","transcript","frames"] and frames=3. Many Reels burn subtitles into the video: frames show them.
- Instagram has no anonymous search: get Reel URLs from the user, or from web pages with reels_links.
- Instagram links cannot jump to a second, so cite as "@handle, Reel URL, at 0:03".`;

export function registerFetchTool(server: McpServer): void {
  server.registerTool(
    "reels_fetch",
    {
      title: "Read Instagram Reels",
      description: DESCRIPTION,
      inputSchema: {
        reels: lenientArray(z.string().min(1))
          .refine((a) => a.length >= 1 && a.length <= 20, "Send 1–20 Reels")
          .describe("1–20 Reel URLs (instagram.com/reel/…, /reels/…, /p/…) or shortcodes."),
        parts: lenientArray(z.enum(PARTS))
          .optional()
          .describe(`Any of ${PARTS.join(", ")}. Default ["details","transcript"].`),
        start: timeValue().optional().describe("Range start for transcript and frames: seconds or 'm:ss'."),
        end: timeValue().optional().describe("Range end for transcript and frames: seconds or 'm:ss'."),
        query: lenientArray(z.string())
          .optional()
          .describe("Return only transcript passages matching these phrases instead of the full transcript."),
        frames: lenientNumber().optional().describe("With part frames: how many, evenly spaced over the range (default 4, max 12 per Reel, 36 per call)."),
        frameAt: lenientArray(timeValue()).optional().describe("With part frames: exact seconds instead of even spacing, e.g. [0, 1.5, 3]."),
        frameWidth: lenientNumber().optional().describe("Frame width in px (default 480, max 1080). Reels are vertical; 480 keeps on-screen text readable."),
        commentsLimit: lenientNumber().optional().describe("Preview comments per Reel (default 10). Instagram exposes only a handful without login."),
      },
      annotations: { title: "Read Instagram Reels", ...READ_ONLY },
    },
    async (args) => {
      try {
        return { content: await runFetch(args) };
      } catch (e) {
        return { content: [{ type: "text" as const, text: errorText(e) }], isError: true };
      }
    },
  );
}

type Args = {
  reels: string[];
  parts?: Part[];
  start?: number;
  end?: number;
  query?: string[];
  frames?: number;
  frameAt?: number[];
  frameWidth?: number;
  commentsLimit?: number;
};

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const MAX_FRAMES_PER_CALL = 36;

export async function runFetch(a: Args): Promise<Content[]> {
  const parts = new Set<Part>(a.parts?.length ? a.parts : ["details", "transcript"]);
  let note = "";
  if (parts.has("frames")) {
    const wanted = a.frameAt?.length ? a.frameAt.length : Math.max(1, Math.min(12, Math.round(a.frames ?? 4)));
    const per = Math.max(1, Math.min(wanted, Math.floor(MAX_FRAMES_PER_CALL / a.reels.length)));
    if (per < wanted) note = `\nFrames capped at ${per} per Reel (${MAX_FRAMES_PER_CALL} per call); send fewer Reels for more frames each.`;
    a = { ...a, frames: per, frameAt: a.frameAt?.slice(0, per) };
  }
  const results = await Promise.all(a.reels.map((r, i) => fetchOne(r, i + 1, parts, a)));
  const content: Content[] = [];
  let ok = 0;
  const reasons: Record<string, number> = {};
  for (const r of results) {
    if (r.ok) ok++;
    for (const why of r.reasons) reasons[why] = (reasons[why] ?? 0) + 1;
    content.push({ type: "text", text: r.text }, ...r.media);
  }
  const rl = reasons.rate_limited
    ? "\nInstagram is rate-limiting this IP. Wait a few minutes before retrying the failed Reels, in smaller batches."
    : "";
  content.push({
    type: "text",
    text: `---\nFetched ${ok}/${a.reels.length} Reels fully.` + (ok < a.reels.length ? " See per-Reel notes for what failed and why." : "") + note + rl,
  });
  return content;
}

async function fetchOne(input: string, n: number, parts: Set<Part>, a: Args): Promise<{ ok: boolean; text: string; media: Content[]; reasons: string[] }> {
  const code = parseShortcode(input);
  if (!code) return { ok: false, text: `## [${n}] ${input}\nError: not an Instagram Reel URL or shortcode.`, media: [], reasons: ["failed"] };
  const out: string[] = [];
  const problems: string[] = [];
  const reasons: string[] = [];
  const media: Content[] = [];
  const fail = (what: string, e: unknown) => {
    problems.push(`${what}: ${errorText(e)}`);
    reasons.push(e instanceof ReelsError ? e.reason : "failed");
  };

  let reel: ReelInfo;
  try {
    reel = await getReel(code);
  } catch (e) {
    fail("reel", e);
    return { ok: false, text: `## [${n}] ${input}\nNotes: ${problems.join(" | ")}\n`, media, reasons };
  }

  let transcript: Awaited<ReturnType<typeof transcriptFor>> | undefined;
  if (parts.has("transcript")) {
    try {
      transcript = await transcriptFor(code);
    } catch (e) {
      fail("transcript", e);
    }
  }
  // Duration for the header and for spacing frames over the whole Reel.
  const duration = transcript?.duration ?? (reel.video ? await probeDuration(reel.video) : undefined);

  out.push(`## [${n}] ${reel.handle ? "@" + reel.handle : reel.author ?? code}: ${firstLine(reel.caption) || "(no caption)"}`);
  out.push(header(reel, duration));

  if (parts.has("details")) {
    if (reel.caption) out.push(`Caption:\n${reel.caption.length > 1500 ? reel.caption.slice(0, 1500) + "…" : reel.caption}`);
    const tags = [...reel.caption.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
    if (tags.length) out.push(`Hashtags: ${[...new Set(tags)].join(" ")}`);
  }

  const start = a.start ?? 0;
  const end = a.end ?? Infinity;

  if (parts.has("transcript") && transcript) {
    out.push(transcriptSection(transcript.segments, transcript.language, start, end, a.query));
  }

  if (parts.has("frames")) {
    if (!reel.video) {
      fail("frames", new ReelsError("no video stream found", "unavailable"));
    } else {
      const times = frameTimes(a, start, end, duration);
      if (!times.length) {
        problems.push("frames: no timestamps inside the Reel (pass end or frameAt)");
      } else {
        try {
          const width = Math.max(160, Math.min(1080, Math.round(a.frameWidth ?? 480)));
          const { frames, failed } = await grabFrames(reel.video, times, width);
          out.push(`Frames (${frames.length}, ${width}px wide): attached below at ${frames.map((f) => formatClock(f.at)).join(", ")}`);
          for (const f of frames) {
            media.push(
              { type: "text", text: `[${n}] frame ${formatClock(f.at)} (${f.at.toFixed(1)} s)` },
              { type: "image", data: f.jpeg.toString("base64"), mimeType: "image/jpeg" },
            );
          }
          if (failed.length) problems.push(`frames: ${failed.length} failed (${failed.map((f) => `${formatClock(f.at)}: ${f.error}`).join("; ")})`);
        } catch (e) {
          fail("frames", e);
        }
      }
    }
  }

  if (parts.has("comments")) {
    const limit = Math.max(1, Math.min(50, a.commentsLimit ?? 10));
    const cs = reel.comments.slice(0, limit);
    out.push(
      cs.length
        ? `Preview comments (${cs.length}${reel.commentCount ? ` of ${compactNumber(reel.commentCount)}` : ""}; Instagram shows only a few without login):\n` +
            cs.map((c) => `- @${c.author}${c.likes ? ` (${compactNumber(c.likes)}♥)` : ""}: ${c.text.replace(/\n+/g, " ⏎ ")}`).join("\n")
        : "Comments: none exposed without login",
    );
  }

  if (parts.has("cover")) {
    if (!reel.thumbnail) problems.push("cover: none");
    else {
      try {
        const res = await fetch(reel.thumbnail, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        media.push({ type: "text", text: `[${n}] cover image` }, { type: "image", data: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: "image/jpeg" });
        out.push("Cover: attached below");
      } catch (e) {
        fail("cover", e);
      }
    }
  }

  if (problems.length) out.push(`Notes: ${problems.join(" | ")}`);
  return { ok: problems.length === 0, text: out.join("\n") + "\n", media, reasons };
}

function firstLine(s: string): string {
  const l = s.split("\n")[0].trim();
  return l.length > 90 ? l.slice(0, 88) + "…" : l;
}

function header(r: ReelInfo, duration?: number): string {
  const ageDays = r.published ? Math.max(1, (Date.now() - r.published.getTime()) / 86400_000) : undefined;
  return [
    r.url,
    r.author && r.handle ? `${r.author} (@${r.handle})` : r.author ?? (r.handle ? "@" + r.handle : undefined),
    r.published ? `published ${isoDay(r.published)}` : undefined,
    r.likes != null ? `${compactNumber(r.likes)} likes` : undefined,
    r.likes != null && ageDays ? `~${compactNumber(Math.round(r.likes / ageDays))} likes/day` : undefined,
    r.commentCount != null ? `${compactNumber(r.commentCount)} comments` : undefined,
    duration ? formatClock(duration) : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function transcriptSection(segs: Segment[], language: string | undefined, start: number, end: number, query?: string[]): string {
  const label = `Transcript (speech-to-text${language ? `, ${language}` : ""})`;
  const inRange = segs.filter((s) => s.start + s.dur > start && s.start < end);
  const rangeText = start > 0 || end !== Infinity ? ` ${formatClock(start)}–${end === Infinity ? "end" : formatClock(end)}` : "";
  if (!segs.length) return `${label}: no speech detected (music-only or silent Reel).`;
  if (!inRange.length) return `${label}${rangeText}: no speech in this range.`;
  if (query?.length) {
    const hits = findHighlights(inRange, query, { count: 6, windowSec: 12, maxChars: 400 });
    if (!hits.length) return `${label}${rangeText}: nothing matches ${JSON.stringify(query)}.`;
    return `${label}${rangeText}, passages matching ${JSON.stringify(query)}:\n` + hits.map((h) => `  [${formatClock(h.start)}] "${h.text}"`).join("\n");
  }
  return `${label}${rangeText}:\n` + inRange.map((s) => `[${formatClock(s.start)}] ${s.text}`).join("\n");
}

/** Explicit frameAt, else N frames evenly spaced from the range start. */
export function frameTimes(a: Pick<Args, "frameAt" | "frames">, start: number, end: number, duration?: number): number[] {
  const limit = duration ? duration - 0.2 : Infinity;
  if (a.frameAt?.length) return a.frameAt.filter((t) => t < limit);
  const stop = Math.min(end, duration ?? end);
  if (!Number.isFinite(stop) || stop <= start) return [];
  const n = Math.max(1, a.frames ?? 4);
  const step = (stop - start) / n;
  return Array.from({ length: n }, (_, i) => Math.round((start + i * step) * 10) / 10).filter((t) => t < limit);
}
