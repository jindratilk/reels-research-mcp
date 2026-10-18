import { rm } from "node:fs/promises";
import { memo } from "./cache.js";
import { ReelsError } from "./errors.js";
import { getReel } from "./instagram.js";
import { audioToWav } from "./media.js";
import { transcribeWav, type SttResult } from "./stt.js";

/** Reel shortcode -> timestamped transcript (cached for the session). */
export const transcriptFor = memo("transcript", async (code: string): Promise<SttResult> => {
  const reel = await getReel(code);
  if (!reel.audio) throw new ReelsError("This Reel has no separate audio track to transcribe", "no_audio");
  const wav = await audioToWav(reel.audio);
  try {
    const r = await transcribeWav(wav.path);
    return { ...r, duration: r.duration ?? wav.duration };
  } finally {
    await rm(wav.dir, { recursive: true, force: true });
  }
});
