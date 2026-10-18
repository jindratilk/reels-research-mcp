// Local speech-to-text with Moondream Parakeet Redux (178 MB, 25 European
// languages). A long-lived Python worker keeps the model loaded: ~3 s warm
// start, then roughly 50x real time on Apple silicon. Stops after idling.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ReelsError } from "./errors.js";
import type { Segment } from "./parse.js";

export const VENV_DIR = process.env.REELS_VENV ?? join(homedir(), ".cache", "reels-research-mcp", "venv");
const IDLE_MS = Number(process.env.REELS_STT_IDLE_MS ?? 10 * 60_000);

export function pythonPath(): string {
  return process.env.REELS_PYTHON ?? join(VENV_DIR, "bin", "python");
}

/** worker.py ships next to dist/ (and next to src/ when running from source). */
export function workerScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "..", "python", "worker.py"), join(here, "..", "..", "python", "worker.py")]) {
    if (existsSync(p)) return p;
  }
  throw new ReelsError("python/worker.py is missing from the install", "setup");
}

export function sttInstalled(): boolean {
  return existsSync(pythonPath());
}

const SETUP_HINT =
  "Speech-to-text is not set up. Run `npx -y github:jindratilk/reels-research-mcp --setup` once (installs Moondream Photon with Parakeet Redux into ~/.cache/reels-research-mcp, ~1 GB with PyTorch).";

type Pending = { resolve: (v: any) => void; reject: (e: unknown) => void };

let proc: ChildProcess | undefined;
let ready: Promise<void> | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
let idleTimer: NodeJS.Timeout | undefined;

function stop(): void {
  proc?.kill();
  proc = undefined;
  ready = undefined;
  for (const p of pending.values()) p.reject(new ReelsError("speech-to-text worker stopped", "failed"));
  pending.clear();
}

function touchIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!pending.size) stop();
  }, IDLE_MS);
  idleTimer.unref();
}

function start(): Promise<void> {
  if (ready) return ready;
  if (!sttInstalled()) return Promise.reject(new ReelsError(SETUP_HINT, "setup"));
  ready = new Promise<void>((resolve, reject) => {
    const p = spawn(pythonPath(), ["-I", workerScript()], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TOKENIZERS_PARALLELISM: "false" } });
    proc = p;
    let stderr = "";
    p.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const lines = createInterface({ input: p.stdout! });
    lines.on("line", (line) => {
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // library chatter on stdout
      }
      if ("ready" in msg) {
        if (msg.ready) resolve();
        else reject(new ReelsError(`${msg.error}. ${SETUP_HINT}`, "setup"));
        return;
      }
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.ok) job.resolve(msg);
      else job.reject(new ReelsError(`Transcription failed: ${msg.error}`, "failed"));
      touchIdle();
    });
    p.on("exit", (code) => {
      const err = new ReelsError(`speech-to-text worker exited (${code}): ${stderr.trim().split("\n").pop() ?? ""}`, "failed");
      reject(err);
      for (const job of pending.values()) job.reject(err);
      pending.clear();
      proc = undefined;
      ready = undefined;
    });
  });
  return ready;
}

export interface SttResult {
  segments: Segment[];
  language?: string;
  duration?: number;
}

/** Transcribe a 16 kHz WAV file. Requests are answered in order by one worker. */
export async function transcribeWav(path: string): Promise<SttResult> {
  await start();
  const id = nextId++;
  const msg: any = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    proc!.stdin!.write(JSON.stringify({ id, audio: path }) + "\n");
  });
  touchIdle();
  return {
    segments: msg.segments.map((s: any) => ({ start: s.start, dur: Math.max(0, s.end - s.start), text: s.text })),
    language: msg.language ?? undefined,
    duration: msg.duration ?? undefined,
  };
}

/** For the doctor: start the worker and report whether the model loaded. */
export async function sttCheck(): Promise<string> {
  await start();
  return "Parakeet Redux loaded";
}

process.on("exit", () => proc?.kill());
