#!/usr/bin/env python3
"""CPU Whisper transcription with word-level timestamps for authorised source media."""
import argparse
import json
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("output")
    parser.add_argument("--model", default="base")
    args = parser.parse_args()
    source = Path(args.video)
    if not source.is_file():
        raise SystemExit(f"Source video does not exist: {source}")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit("Missing faster-whisper. Install requirements/repurposing.txt first.") from exc

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        str(source), beam_size=5, word_timestamps=True, vad_filter=True
    )
    words = []
    for segment in segments:
        for item in (segment.words or []):
            token = (item.word or "").strip()
            if not token:
                continue
            words.append({
                "word": token,
                "start": round(float(item.start), 3),
                "end": round(float(item.end), 3),
                "probability": round(float(item.probability), 4) if item.probability is not None else None,
            })
    if not words:
        raise SystemExit("Whisper returned no word-level timestamps; no edit was produced.")
    payload = {
        "status": "transcribed",
        "engine": "faster-whisper",
        "model": args.model,
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 4),
        "wordCount": len(words),
        "words": words,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("status", "engine", "model", "language", "wordCount")}))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Transcription failed: {exc}", file=sys.stderr)
        raise
