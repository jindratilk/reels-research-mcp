# Reel hooks

A Reel hook happens in the first 1–3 seconds, in three channels at once: what is said, what is written on screen, and what is shown. Capture all three.

## Fetch

```
reels_fetch {
  "reels": ["<url>", "<url>", ...],          // 5–10 per call
  "parts": ["details", "transcript", "frames"],
  "start": 0, "end": 5,
  "frames": 3                                // 0:00, ~0:01.7, ~0:03.3
}
```
- On-screen text and burned-in subtitles: read them from the frames. For fast-cut openings use `"frameAt": [0, 0.5, 1, 1.5, 2]`.
- No speech in 0–5 s (music, sound effect, trending audio): the hook is visual and on-screen text. Say "no spoken hook".
- Speech starts late: refetch with `end: 10`.

## Record

| Column | How |
|---|---|
| spoken hook | Verbatim first sentence(s) from the transcript, up to ~30 words |
| on-screen text | Verbatim text visible in the first frames, or "none" |
| visual | One line: framing, motion, setting, props, cut speed (from frames) |
| hook type | Primary type from the list below (+ optional secondary) |
| likes/day | From the header; normalises for age |
| cite | `@handle · Reel URL · 0:00` |

## Hook types

1. **Bold claim / contrarian**: "Stop posting at 9 am."
2. **Result first**: shows or states the outcome before the method.
3. **Pain callout**: "If your Reels die at 200 views…"
4. **Question**: "Why do your Reels stop at 3 seconds?"
5. **Curiosity gap**: "Nobody talks about this setting."
6. **Story in motion**: starts mid-scene, often without words.
7. **Visual pattern interrupt**: unexpected motion, transformation, before/after.
8. **List / promise**: "3 apps that…"
9. **Direct address to a niche**: "Small bakery owners, listen."
10. **Trend / sound-led**: the trending audio or format is the hook.

Classify by the dominant move in the first second or two.
