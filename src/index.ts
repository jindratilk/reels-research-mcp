#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFetchTool } from "./tools/fetch.js";
import { registerLinksTool } from "./tools/links.js";
import { registerDoctorTool, runDoctor } from "./tools/doctor.js";
import { runSetup } from "./setup.js";

const VERSION = "0.1.1";

// CLI helpers for humans and installing agents.
if (process.argv.includes("--version")) {
  console.log(`reels-research-mcp ${VERSION}`);
  process.exit(0);
}
if (process.argv.includes("--setup")) process.exit(runSetup());
if (process.argv.includes("--doctor")) {
  console.log(await runDoctor());
  process.exit(0);
}

const ALL = {
  reels_fetch: registerFetchTool,
  reels_links: registerLinksTool,
  reels_doctor: registerDoctorTool,
} as const;

const wanted = (process.env.REELS_MCP_TOOLS ?? Object.keys(ALL).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const server = new McpServer(
  { name: "reels-research", version: VERSION },
  {
    instructions:
      "Keyless Instagram Reels research. Instagram has no anonymous search: get Reel URLs from the user or pull them out of web pages with reels_links, then read them with reels_fetch (details, timestamped transcript via local speech-to-text, real frames). For hooks use start=0, end=5. If calls fail, run reels_doctor.",
  },
);

for (const name of wanted) {
  const register = ALL[name as keyof typeof ALL];
  if (register) register(server);
  else console.error(`[reels-research] unknown tool in REELS_MCP_TOOLS: ${name}`);
}

await server.connect(new StdioServerTransport());
