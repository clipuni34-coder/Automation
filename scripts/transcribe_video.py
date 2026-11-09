#!/usr/bin/env python3
"""CPU Whisper transcription with validated word-level timestamps for authorised source media."""
import argparse
import json
import math
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument("output")
    parser.add_argument("--model", default="base")
    # Narrated scripts have a known language; callers can specify it without
    # changing language detection for ordinary source-media transcription.
    parser.add_argument("--language", default=None)
    args = parser.parse_args()
    source = Path(args.video)
    if not source.is_file():
        raise SystemExit(f"Source video does not exist: {source}")
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SystemExit("Missing faster-whisper. Install requirements/repurposing.txt first.") from exc

    # Fail cleanly (not with a PyAV traceback) on silent/video-only sources:
    # there is nothing to transcribe, and callers treat this as a rejection.
    try:
        import av
        with av.open(str(source)) as container:
            if not container.streams.audio:
                raise SystemExit("Source video has no audio stream; nothing to transcribe.")
    except ImportError:
        pass  # faster-whisper import below will surface the real dependency error
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    try:
        segments, info = model.transcribe(
            str(source), beam_size=5, word_timestamps=True, vad_filter=True, language=args.language
        )
        segment_list = list(segments)  # decoding happens lazily during iteration
    except Exception as exc:
        raise SystemExit(f"Audio decoding/transcription failed for this source: {exc}") from exc
    words = []
    dropped_word_count = 0
    last_start = -1.0
    for segment in segment_list:
        for item in (segment.words or []):
            token = (item.word or "").strip()
            try:
                start = float(item.start)
                end = float(item.end)
            except (TypeError, ValueError):
                dropped_word_count += 1
                continue
            if not token or not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or start < last_start:
                dropped_word_count += 1
                continue
            probability = float(item.probability) if item.probability is not None else None
            words.append({
                "word": token,
                "start": round(start, 3),
                "end": round(end, 3),
                "probability": round(probability, 4) if probability is not None and math.isfinite(probability) else None,
            })
            last_start = start
    if not words:
        raise SystemExit("Whisper returned no valid word-level timestamps; no edit was produced.")
    payload = {
        "status": "transcribed",
        "engine": "faster-whisper",
        "model": args.model,
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 4),
        "wordCount": len(words),
        "droppedWordCount": dropped_word_count,
        "words": words,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in ("status", "engine", "model", "language", "wordCount", "droppedWordCount")}))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Transcription failed: {exc}", file=sys.stderr)
        raise
