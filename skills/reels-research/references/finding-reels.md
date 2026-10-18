# Finding Reels without an Instagram login

Instagram offers anonymous clients no search, no hashtag pages and no profile listings. The keyless route is the open web: many pages embed or link Reels.

## Where Reels live on the web

| Source | Search for |
|---|---|
| Roundups and listicles | "best Instagram Reels about <topic>", "<topic> reels examples", "viral reels <topic> 2026" |
| Marketing blogs (case studies) | "<topic> Instagram Reels examples brand", "reel hook examples <niche>" |
| News articles | "<creator or brand> Instagram reel" (news sites embed the Reel they report on) |
| Newsletters and Substack posts | "<topic> reels" site:substack.com |
| Creator websites and link-in-bio pages | the creator's site, Linktree, Beacons pages |
| Reddit threads | "<topic> reel" site:reddit.com (people paste Reel links) |

## Steps

1. Run 4–8 web searches from different angles (examples, case studies, news, a specific creator), in the user's language and in English.
2. Pick the 5–15 most promising result pages and call `reels_links` once with all of them.
3. Merge and de-duplicate. Keep `/p/` post links only if you also want carousels or older videos; `reels_fetch` tells you if a post has no video.
4. If the user wanted a specific number of Reels and the web yields fewer, say so. Do not pad with off-topic Reels.

## Judging relevance before fetching

Links alone carry no titles. Fetch `details` only (fast: no transcript, no frames) for a candidate batch, drop off-topic Reels by caption and hashtags, then fetch transcripts and frames for the keepers.
