// `--setup`: create a private Python environment with Moondream Photon and
// pre-download Parakeet Redux, so the first transcription is fast.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pythonPath, VENV_DIR, workerScript } from "./stt.js";

function findPython(): string | undefined {
  for (const bin of [process.env.REELS_BOOTSTRAP_PYTHON, "python3.12", "python3.11", "python3.13", "python3.10", "python3"]) {
    if (!bin) continue;
    try {
      const v = execFileSync(bin, ["-c", "import sys;print(sys.version_info[0]*100+sys.version_info[1])"], { encoding: "utf8" }).trim();
      if (+v >= 310) return bin;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export function runSetup(): number {
  const log = (s: string) => console.log(s);
  if (!existsSync(pythonPath())) {
    const py = findPython();
    if (!py) {
      log("✗ Python 3.10+ is required for speech-to-text (brew install python@3.12).");
      return 1;
    }
    log(`→ creating ${VENV_DIR} with ${py}`);
    mkdirSync(dirname(VENV_DIR), { recursive: true });
    if (spawnSync(py, ["-m", "venv", VENV_DIR], { stdio: "inherit" }).status !== 0) return 1;
  }
  log("→ installing moondream (Photon runtime, includes PyTorch; ~1 GB)");
  const pip = spawnSync(pythonPath(), ["-m", "pip", "install", "--quiet", "--upgrade", "moondream>=2.4.0"], { stdio: "inherit" });
  if (pip.status !== 0) return 1;
  log("→ downloading Parakeet Redux (178 MB) and test-loading it");
  const probe = spawnSync(pythonPath(), ["-I", workerScript()], { input: "", encoding: "utf8" });
  const ok = /"ready": true/.test(probe.stdout ?? "");
  log(ok ? "✓ speech-to-text ready" : `✗ model failed to load:\n${(probe.stdout ?? "") + (probe.stderr ?? "").slice(-800)}`);
  return ok ? 0 : 1;
}
