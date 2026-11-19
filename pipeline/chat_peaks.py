#!/usr/bin/env python3
"""Picos de chat de un directo o estreno de YouTube ya grabado.

Entrada: el archivo de chat que descarga yt-dlp (`--write-subs --sub-langs live_chat`, un objeto JSON por línea) y el
transcript.json del proyecto. Cuenta los mensajes por ventana de 10 s, puntúa cada ventana de 1 a 10 respecto al ritmo
normal del chat y anota `chatSpike` en cada segmento de la transcripción (el máximo de las ventanas que toca).

Los picos de chat marcan risas y momentos virales en directos largos con mucha más precisión que el volumen del micrófono.
Con menos de MIN_MESSAGES mensajes no se anota nada: un chat casi vacío no distingue momentos.

Uso: chat_peaks.py <live_chat.json> <transcript.json> [--window 10]
Salida (stdout, JSON): {"messages", "windows", "annotated", "peak"}
"""
import argparse
import json
import os
import sys
import tempfile

MIN_MESSAGES = 30


def offsets_ms(path):
    """Instante (ms desde el inicio del vídeo) de cada mensaje de chat de texto, pagos o pegatinas."""
    found = []
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            action = item.get("replayChatItemAction") or {}
            actions = action.get("actions") or []
            if not any("addChatItemAction" in entry for entry in actions):
                continue
            raw = action.get("videoOffsetTimeMsec", item.get("videoOffsetTimeMsec"))
            try:
                found.append(int(raw))
            except (TypeError, ValueError):
                continue
    return [value for value in found if value >= 0]


def histogram(offsets, window):
    if not offsets:
        return []
    size = int(max(offsets) / 1000 // window) + 1
    counts = [0] * size
    for value in offsets:
        counts[int(value / 1000 // window)] += 1
    return counts


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round((len(ordered) - 1) * fraction)))]


def scores(counts):
    """1-10 por ventana: 1 es el ritmo normal o menos y 10 el pico más alto del chat."""
    if not counts:
        return []
    base = percentile(counts, 0.5)
    top = percentile(counts, 0.98)
    span = max(1.0, top - base)
    return [int(max(1, min(10, round(1 + 9 * (count - base) / span)))) if count > base else 1 for count in counts]


def annotate(transcript, spikes, window):
    annotated = 0
    for segment in transcript.get("segments", []):
        first = int(segment["start"] // window)
        last = int(max(segment["start"], segment["end"] - 1e-6) // window)
        window_scores = [spikes[i] for i in range(first, min(last, len(spikes) - 1) + 1) if i < len(spikes)]
        if window_scores:
            segment["chatSpike"] = max(window_scores)
            annotated += 1
    return annotated


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("chat")
    parser.add_argument("transcript")
    parser.add_argument("--window", type=float, default=10.0)
    args = parser.parse_args()

    offsets = offsets_ms(args.chat)
    result = {"messages": len(offsets), "windows": 0, "annotated": 0, "peak": 0}
    if len(offsets) >= MIN_MESSAGES:
        counts = histogram(offsets, args.window)
        spikes = scores(counts)
        with open(args.transcript, encoding="utf-8") as handle:
            transcript = json.load(handle)
        result["annotated"] = annotate(transcript, spikes, args.window)
        result["windows"] = len(counts)
        result["peak"] = max(spikes)
        directory = os.path.dirname(os.path.abspath(args.transcript))
        handle, staging = tempfile.mkstemp(suffix=".tmp", dir=directory)
        with os.fdopen(handle, "w", encoding="utf-8") as out:
            json.dump(transcript, out, ensure_ascii=False)
        os.replace(staging, args.transcript)
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
