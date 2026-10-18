import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getReel, ytDlpVersion } from "../instagram.js";
import { ffmpegVersion, probeDuration } from "../media.js";
import { pythonPath, sttCheck, sttInstalled } from "../stt.js";
import { READ_ONLY } from "../schema.js";
import { errorText } from "./common.js";

// Instagram's own public announcement Reel, used as a canary.
const CANARY = "DO_T5qAEdmo";

export function registerDoctorTool(server: McpServer): void {
  server.registerTool(
    "reels_doctor",
    {
      title: "Check Reels setup",
      description:
        "Check everything this server needs on this machine, with timings: yt-dlp, ffmpeg, anonymous Reel access, the video stream, and local speech-to-text (Parakeet Redux). Run it after installing or when reels_fetch fails.",
      inputSchema: {},
      annotations: { title: "Check Reels setup", ...READ_ONLY },
    },
    async () => ({ content: [{ type: "text" as const, text: await runDoctor() }] }),
  );
}

export async function runDoctor(): Promise<string> {
  const checks: Array<[string, () => Promise<string>]> = [
    ["yt-dlp", async () => (await ytDlpVersion()) ?? Promise.reject(new Error("not installed (brew install yt-dlp)"))],
    ["ffmpeg", async () => (await ffmpegVersion()) ?? Promise.reject(new Error("not installed (brew install ffmpeg)"))],
    ["Reel access", async () => {
      const r = await getReel(CANARY);
      return `@${r.handle}, ${r.likes ?? "?"} likes, audio ${r.audio ? "yes" : "no"}, video ${r.video ? "yes" : "no"}`;
    }],
    ["video stream", async () => {
      const r = await getReel(CANARY);
      const d = r.video ? await probeDuration(r.video) : undefined;
      if (!d) throw new Error("could not read the stream");
      return `${d.toFixed(1)} s`;
    }],
    ["speech-to-text", async () => {
      if (!sttInstalled()) throw new Error(`not set up (${pythonPath()} missing). Run: npx -y github:jindratilk/reels-research-mcp --setup`);
      return await sttCheck();
    }],
  ];
  const lines: string[] = [];
  let failures = 0;
  for (const [name, fn] of checks) {
    const t0 = Date.now();
    try {
      lines.push(`✓ ${name}: ${await fn()} (${Date.now() - t0} ms)`);
    } catch (e) {
      failures++;
      lines.push(`✗ ${name}: ${errorText(e)} (${Date.now() - t0} ms)`);
    }
  }
  lines.push("", failures ? "Some checks failed; each line says what to do." : "All checks passed.");
  return lines.join("\n");
}
