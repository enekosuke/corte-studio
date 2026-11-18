"""Local and neural Spanish male announcer voiceover generator for Corte Studio Prototype mode."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import wave
from pathlib import Path


def _word_timings_proportional(text: str, duration: float) -> list[dict]:
    tokens = re.findall(r"\S+", text.strip())
    if not tokens or duration <= 0:
        return []
    weights = [max(1, len(re.sub(r"[^\wáéíóúüñ]", "", t, flags=re.I))) for t in tokens]
    total_w = sum(weights) or len(tokens)
    cursor = 0.0
    out = []
    for token, weight in zip(tokens, weights):
        span = duration * (weight / total_w)
        out.append({
            "start": round(cursor, 3),
            "end": round(cursor + span, 3),
            "text": token,
        })
        cursor += span
    return out


def list_voices(models_dir: Path) -> list[dict]:
    voices = []
    if models_dir.is_dir():
        for onnx_path in sorted(models_dir.glob("*.onnx")):
            stem = onnx_path.stem
            voices.append({
                "id": f"piper:{stem}",
                "label": f"Piper Local · {stem} (Offline)",
                "engine": "piper",
                "local": True,
                "path": str(onnx_path),
            })
    voices.extend([
        {
            "id": "edge:es-ES-AlvaroNeural",
            "label": "Álvaro Neural · Locutor TV (ES)",
            "engine": "edge",
            "local": False,
        },
        {
            "id": "edge:es-MX-JorgeNeural",
            "label": "Jorge Neural · Locutor (LATAM)",
            "engine": "edge",
            "local": False,
        },
    ])
    return voices


def _wav_duration(wav_path: Path) -> float:
    with wave.open(str(wav_path), "rb") as wf:
        sr = wf.getframerate() or 22050
        return round(wf.getnframes() / sr, 3)


def _trim_wav_silence(ffmpeg_bin: str, raw_wav: Path, out_wav: Path) -> float:
    cmd = [
        ffmpeg_bin,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(raw_wav),
        "-af",
        "silenceremove=start_periods=1:start_threshold=-42dB,areverse,silenceremove=start_periods=1:start_threshold=-42dB,areverse,apad=pad_dur=0.06,loudnorm=I=-16:TP=-1.5:LRA=7",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        str(out_wav),
    ]
    subprocess.run(cmd, check=True)
    return _wav_duration(out_wav)


def _synthesize_piper(text: str, voice_name: str, models_dir: Path, raw_wav: Path, length_scale: float = 0.94) -> None:
    from piper import PiperVoice
    from piper.config import SynthesisConfig

    onnx_path = Path(voice_name) if voice_name.endswith(".onnx") and Path(voice_name).exists() else models_dir / f"{voice_name}.onnx"
    if not onnx_path.exists():
        candidates = sorted(models_dir.glob("*.onnx")) if models_dir.is_dir() else []
        if not candidates:
            raise FileNotFoundError(f"No hay modelo Piper .onnx en {models_dir}")
        onnx_path = candidates[0]

    voice = PiperVoice.load(str(onnx_path), use_cuda=False)

    syn_cfg = SynthesisConfig(length_scale=length_scale)
    with wave.open(str(raw_wav), "wb") as wf:
        voice.synthesize_wav(text, wf, syn_config=syn_cfg)


async def _synthesize_edge_async(text: str, voice_name: str, raw_mp3: Path) -> list[dict]:
    import edge_tts

    comm = edge_tts.Communicate(text, voice_name, rate="+7%", pitch="-2Hz", boundary="WordBoundary")
    words: list[dict] = []
    with open(raw_mp3, "wb") as f:
        async for chunk in comm.stream():
            ctype = chunk.get("type")
            if ctype == "audio":
                f.write(chunk["data"])
            elif ctype == "WordBoundary":
                offset_s = float(chunk.get("offset", 0)) / 10_000_000.0
                dur_s = float(chunk.get("duration", 0)) / 10_000_000.0
                word = str(chunk.get("text", "")).strip()
                if word:
                    words.append({
                        "start": round(offset_s, 3),
                        "end": round(offset_s + max(0.08, dur_s), 3),
                        "text": word,
                    })
    return words


def synthesize(text: str, out_wav: Path, voice_spec: str, models_dir: Path, ffmpeg_bin: str) -> dict:
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    tmp_raw = out_wav.with_suffix(".raw.wav")
    tmp_mp3 = out_wav.with_suffix(".raw.mp3")
    used_voice = voice_spec
    used_engine = "piper"
    words: list[dict] = []

    try:
        if voice_spec.startswith("edge:"):
            edge_name = voice_spec.split(":", 1)[1] or "es-ES-AlvaroNeural"
            try:
                words = asyncio.run(_synthesize_edge_async(text, edge_name, tmp_mp3))
                subprocess.run(
                    [ffmpeg_bin, "-hide_banner", "-loglevel", "error", "-y", "-i", str(tmp_mp3), "-ar", "44100", "-ac", "2", str(tmp_raw)],
                    check=True,
                )
                used_engine = "edge"
            except Exception:
                # Fallback offline automatically to downloaded local Piper model
                piper_fallback = "es_ES-davefx-medium"
                _synthesize_piper(text, piper_fallback, models_dir, tmp_raw)
                used_voice = f"piper:{piper_fallback}"
                used_engine = "piper"
                words = []
        else:
            piper_name = voice_spec.split(":", 1)[1] if voice_spec.startswith("piper:") else (voice_spec or "es_ES-davefx-medium")
            _synthesize_piper(text, piper_name, models_dir, tmp_raw)
            used_voice = f"piper:{piper_name}"
            used_engine = "piper"

        duration = _trim_wav_silence(ffmpeg_bin, tmp_raw, out_wav)
        if not words:
            words = _word_timings_proportional(text, duration)
        else:
            t0 = max(0.0, words[0]["start"] - 0.03)
            span = max(0.15, words[-1]["end"] - t0)
            scale = min(1.0, max(0.2, duration - 0.05) / span)
            words = [
                {
                    "start": round(max(0.0, (w["start"] - t0) * scale), 3),
                    "end": round(min(duration, max(0.05, (w["end"] - t0) * scale)), 3),
                    "text": w["text"],
                }
                for w in words
            ]
        return {
            "path": str(out_wav),
            "duration": duration,
            "voice": used_voice,
            "engine": used_engine,
            "words": words,
        }
    finally:
        for p in (tmp_raw, tmp_mp3):
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Corte Studio announcer voiceover generator.")
    parser.add_argument("--list", action="store_true", help="List available local and neural announcer voices.")
    parser.add_argument("--text", default="", help="Narration text to synthesize.")
    parser.add_argument("--out", default="", help="Destination WAV file path.")
    parser.add_argument("--voice", default="piper:es_ES-davefx-medium", help="Voice specifier (piper:<model> or edge:<name>).")
    parser.add_argument("--models-dir", default=str(Path(__file__).resolve().parent.parent / ".corte-data" / "tts-models"))
    parser.add_argument("--ffmpeg", default=os.environ.get("CORTE_FFMPEG", "ffmpeg"))
    args = parser.parse_args()

    models_dir = Path(args.models_dir)
    if args.list:
        print(json.dumps(list_voices(models_dir), ensure_ascii=False))
        return 0

    if not args.text.strip() or not args.out.strip():
        parser.error("--text and --out are required unless --list is set.")

    result = synthesize(args.text.strip(), Path(args.out), args.voice.strip(), models_dir, args.ffmpeg)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
