import json
import os
import sys

from kokoro_onnx import Kokoro
import soundfile as sf

def main():
    request = json.load(sys.stdin)
    text = str(request.get("text", "")).strip()
    output = request["outputPath"]
    model = request["modelPath"]
    voices = request["voicesPath"]
    voice = request.get("voice", "af_heart")
    if len(text) < 20:
        raise ValueError("Narration text must contain at least 20 characters.")
    language = "en-gb" if voice.startswith("b") else "en-us"
    tts = Kokoro(model, voices)
    try:
        samples, sample_rate = tts.create(text, voice=voice, speed=float(request.get("speed", 1.0)), lang=language)
        if samples is None or len(samples) < sample_rate:
            raise RuntimeError("Kokoro returned empty or implausibly short audio.")
        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
        sf.write(output, samples, sample_rate, subtype="PCM_16")
    finally:
        close = getattr(getattr(tts, "voices", None), "close", None)
        if callable(close):
            close()
    print(json.dumps({"status": "generated", "provider": "kokoro-onnx", "voice": voice, "sampleRate": sample_rate, "samples": int(len(samples)), "outputPath": output}))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
