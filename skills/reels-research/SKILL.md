---
name: reels-research
description: "Research Instagram Reels with the reels_* MCP tools: read Reels from their URLs (details, timestamped transcript, real frames), extract hooks, quotes and on-screen text across many Reels, compare how creators open their Reels, and collect Reel links from web pages. Use for requests like 'analyze the hooks of these Reels', 'what do these creators say about X', 'find Reels about Y and break down how they open'."
---

# Reels Research Orchestrator

You run the research; the reels_* tools fetch. No login is used, so know the limits up front:

- **No search inside Instagram.** Reels come from the user's links, or from web pages via `reels_links`.
- **Transcripts are local speech-to-text** (Parakeet Redux, 25 European languages) of the Reel's audio. Music-only Reels have no speech; their message is in on-screen text, so use frames.
- **No deep links to a second.** Cite as `@handle · Reel URL · 0:03`.

Tools:
- `reels_fetch`: up to 20 Reels per call; parts `details`, `transcript`, `frames`, `comments`, `cover`; `start`/`end` range; `query` for matching passages; `frames`/`frameAt` for real frames.
- `reels_links`: Reel links from 1–15 web pages.
- `reels_doctor`: run it once if anything fails.

## Step 1: Get the Reels

- **User gave links:** use them. De-duplicate by shortcode.
- **User gave a topic:** read [references/finding-reels.md](references/finding-reels.md). In short: web-search for pages that embed or list Reels on the topic (articles, "best Reels" roundups, newsletters, creator sites), then `reels_links` on the best 5–15 pages.
- **User gave creators:** Instagram does not list a profile's Reels without login. Ask the user for the Reel links, or search the web for pages that embed that creator's Reels. Say this limit plainly.

## Step 2: Define the result

Decide the row and the columns before fetching. For hooks: Reel, creator, likes/day, spoken hook (verbatim), on-screen text, visual, hook type, timestamp. State what qualifies (language, recency, minimum likes).

## Step 3: Read

- Hooks: [references/hooks.md](references/hooks.md).
- What people say: `parts: ["transcript"]` with `query` for the theme, then confirm the exact wording with a tight `start`/`end`.
- Batches of 5–10 Reels per call. Instagram rate-limits anonymous lookups; the server spaces them, but don't fire many big batches in parallel.

For more than ~15 Reels, split them across up to 3 parallel subagents (Agent tool, `model: "haiku"`), each with its exact Reel URLs, the row schema, the reference file path, and these closing lines verbatim:
```
reels_reviewed: N
skipped: <url: reason>, ... (or "none")
```

## Step 4: Verify and deliver

- Quotes are verbatim from the transcript or from on-screen text in a frame (say which). Speech-to-text can mishear names and brands: fix obvious ones in [brackets].
- Spot-check 2–3 rows per subagent with a narrow `start`/`end` fetch.
- End with coverage: pages scanned, Reels found, Reels read, skipped and why (`login_required`, `not_found`, `rate_limited`, music-only).
- Write-up rules: [references/synthesis.md](references/synthesis.md).

## Failures

- `[rate_limited]`: Instagram is throttling this IP. Pause a few minutes, retry the failed Reels once in a small batch, report the rest as skipped.
- `[login_required]`: private, age-restricted or region-blocked Reel. Skip it and say so.
- `[setup]`: tell the user the exact command from the message (usually `npx -y github:jindratilk/reels-research-mcp --setup`).
