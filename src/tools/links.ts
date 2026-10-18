import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractReelLinks, reelUrl } from "../parse.js";
import { lenientArray, READ_ONLY } from "../schema.js";
import { errorText } from "./common.js";

const DESCRIPTION = `Collect Instagram Reel links from web pages (articles, newsletters, "best Reels" lists, creator websites, link-in-bio pages). Instagram has no anonymous search, so this is the keyless way to turn web research into Reels you can read with reels_fetch.

Best for: after a web search for a topic, pull every embedded or linked Reel out of the result pages in one call.
Returns: unique Reel URLs per page, with "post" links listed separately (a /p/ post may be a video or images).`;

export function registerLinksTool(server: McpServer): void {
  server.registerTool(
    "reels_links",
    {
      title: "Find Reel links in web pages",
      description: DESCRIPTION,
      inputSchema: {
        pages: lenientArray(z.string().url())
          .refine((a) => a.length >= 1 && a.length <= 15, "Send 1–15 page URLs")
          .describe("1–15 web page URLs to scan for Instagram Reel links."),
        includePosts: z.boolean().optional().describe("Also list /p/ post links (default true)."),
      },
      annotations: { title: "Find Reel links in web pages", ...READ_ONLY },
    },
    async (args) => {
      try {
        return { content: [{ type: "text" as const, text: await runLinks(args) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: errorText(e) }], isError: true };
      }
    },
  );
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export async function runLinks(a: { pages: string[]; includePosts?: boolean }): Promise<string> {
  const includePosts = a.includePosts ?? true;
  const seen = new Set<string>();
  const lines: string[] = [];
  let reels = 0;
  let posts = 0;
  const results = await Promise.allSettled(
    a.pages.map(async (page) => {
      const res = await fetch(page, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return extractReelLinks(await res.text());
    }),
  );
  results.forEach((r, i) => {
    const page = a.pages[i];
    if (r.status === "rejected") {
      lines.push(`## ${page}\nError: ${errorText(r.reason)}`, "");
      return;
    }
    const fresh = r.value.filter((l) => !seen.has(l.code) && (includePosts || l.kind === "reel"));
    fresh.forEach((l) => seen.add(l.code));
    const rs = fresh.filter((l) => l.kind === "reel");
    const ps = fresh.filter((l) => l.kind === "post");
    reels += rs.length;
    posts += ps.length;
    lines.push(`## ${page}`);
    lines.push(rs.length ? `Reels (${rs.length}):\n${rs.map((l) => reelUrl(l.code)).join("\n")}` : "Reels: none found");
    if (includePosts && ps.length) lines.push(`Posts (${ps.length}, may be videos or images):\n${ps.map((l) => `https://www.instagram.com/p/${l.code}/`).join("\n")}`);
    lines.push("");
  });
  lines.push("---", `${reels} unique Reels and ${posts} posts from ${a.pages.length} pages. Read them with reels_fetch (up to 20 per call).`);
  return lines.join("\n");
}
