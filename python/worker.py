"""Speech-to-text worker for reels-research-mcp.

Loads Moondream Parakeet Redux once through Photon and answers JSON lines on
stdin: {"id": 1, "audio": "/tmp/x.wav"} -> {"id": 1, "ok": true, "segments": [...]}.
Everything runs locally; nothing is sent anywhere.
"""

import json
import os
import sys

MODEL = os.environ.get("REELS_STT_MODEL", "moondream/parakeet-redux")
DEVICE = os.environ.get("REELS_STT_DEVICE") or None


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    try:
        import moondream as md
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": f"moondream is not installed: {e}"})
        return
    kwargs = {"device": DEVICE} if DEVICE else {}
    try:
        engine = md.photon(MODEL, **kwargs)
        speech = engine.__enter__()
    except Exception as e:  # noqa: BLE001
        emit({"ready": False, "error": f"could not load {MODEL}: {e}"})
        return
    emit({"ready": True, "model": MODEL})
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            req = json.loads(line)
            try:
                r = speech.transcribe(audio=req["audio"], timestamps="segment")
                segs = [
                    {"start": float(s["start"]), "end": float(s["end"]), "text": s["text"].strip()}
                    for s in r.get("segments") or []
                    if s.get("text", "").strip()
                ]
                emit({"id": req["id"], "ok": True, "segments": segs, "language": r.get("language"),
                      "duration": r.get("source_duration_seconds") or r.get("duration_seconds")})
            except Exception as e:  # noqa: BLE001
                emit({"id": req.get("id"), "ok": False, "error": str(e)[:300]})
    finally:
        engine.__exit__(None, None, None)


if __name__ == "__main__":
    main()
