// Small parsing and formatting helpers shared by the tools.

export interface Segment {
  start: number;
  dur: number;
  text: string;
}

/** Shortcode from a Reel/post URL or a bare shortcode. */
export function parseShortcode(input: string): string | undefined {
  const s = input.trim();
  const m = s.match(/instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,20})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{9,14}$/.test(s) ? s : undefined;
}

export const reelUrl = (code: string) => `https://www.instagram.com/reel/${code}/`;

/** "1:02:03" | "20:47" -> seconds */
export function parseClock(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const parts = String(s).trim().split(":").map((p) => parseFloat(p));
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return (h ? `${h}:` : "") + `${mm}:${String(sec).padStart(2, "0")}`;
}

export function compactNumber(n: number | undefined): string {
  if (n == null) return "?";
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function isoDay(d: Date | undefined): string | undefined {
  return d ? d.toISOString().slice(0, 10) : undefined;
}

/** Instagram shortcode and post links found anywhere in a page's HTML. */
export function extractReelLinks(html: string): Array<{ code: string; kind: "reel" | "post" }> {
  const out = new Map<string, "reel" | "post">();
  const text = html.replace(/\\\//g, "/").replace(/%2F/gi, "/");
  for (const m of text.matchAll(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]{9,14})/g)) {
    const kind = m[1] === "p" ? "post" : "reel";
    if (out.get(m[2]) !== "reel") out.set(m[2], kind);
  }
  return [...out].map(([code, kind]) => ({ code, kind }));
}
