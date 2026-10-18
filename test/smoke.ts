// End-to-end: spawns the built server over stdio like a real MCP client and
// reads live Reels (details, transcript, frames) plus Reel links from a web page.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeFileSync, mkdirSync } from "node:fs";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"] }));
mkdirSync("test/out", { recursive: true });
let img = 0;
const call = async (name: string, args: any) => {
  const t0 = Date.now();
  const r: any = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000 });
  console.log(`\n========== ${name} ${JSON.stringify(args).slice(0, 140)} — ${Date.now() - t0} ms ${r.isError ? "(ERROR)" : ""}`);
  for (const c of r.content) {
    if (c.type === "text") console.log(c.text);
    else { const f = `test/out/frame${img++}.jpg`; writeFileSync(f, Buffer.from(c.data, "base64")); console.log(`[image → ${f}]`); }
  }
};
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
await call("reels_links", { pages: ["https://blog.hootsuite.com/instagram-reels/"] });
await call("reels_fetch", {
  reels: ["https://www.instagram.com/reel/DNkpzuaRy-5/", "https://www.instagram.com/reel/DO_T5qAEdmo/", "DS2nRTmDMfM"],
  parts: ["details", "transcript", "frames"], start: 0, end: 6, frames: 3,
});
await call("reels_fetch", { reels: ["DNkpzuaRy-5"], parts: ["transcript", "comments"], query: ["drop-off rate", "insights"], commentsLimit: 3 });
await client.close();
