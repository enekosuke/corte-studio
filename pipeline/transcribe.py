import argparse
import importlib.util
import json
import os
import re
from pathlib import Path


def _cuda_dll_directories():
    candidates = [Path(entry) for entry in os.environ.get("CORTE_CUDA_DLL_DIRS", "").split(os.pathsep) if entry]
    torch_spec = importlib.util.find_spec("torch")
    if torch_spec and torch_spec.submodule_search_locations:
        candidates.append(Path(torch_spec.submodule_search_locations[0]) / "lib")
    nvidia_spec = importlib.util.find_spec("nvidia")
    if nvidia_spec and nvidia_spec.submodule_search_locations:
        nvidia_root = Path(nvidia_spec.submodule_search_locations[0])
        candidates.extend([nvidia_root / "cublas" / "bin", nvidia_root / "cudnn" / "bin"])
    seen = set()
    directories = []
    for path in candidates:
        resolved = str(path)
        if path.is_dir() and resolved not in seen:
            seen.add(resolved)
            directories.append(resolved)
    return directories


def _configure_cuda_dlls():
    directories = _cuda_dll_directories()
    if not directories:
        return
    if hasattr(os, "add_dll_directory"):
        for directory in directories:
            os.add_dll_directory(directory)
    current_path = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join([*directories, *([current_path] if current_path else [])])


_configure_cuda_dlls()

import ctranslate2
from faster_whisper import BatchedInferencePipeline, WhisperModel

_SENTENCE_END = re.compile(r"[.?!…][\"'»)\]]*$")
_PUNCT_SPACE = re.compile(r"\s+([,.:!?;…])")


def _select_runtime(requested_device, requested_compute):
    cuda_count = ctranslate2.get_cuda_device_count()
    if requested_device == "cuda" and cuda_count <= 0:
        raise RuntimeError("No se detectó ninguna GPU CUDA disponible para Whisper.")
    use_cuda = requested_device == "cuda" or (requested_device == "auto" and cuda_count > 0)
    if use_cuda:
        return True, "cuda", requested_compute or "float16", {}
    return False, "cpu", requested_compute or "int8", {"cpu_threads": min(8, os.cpu_count() or 4)}


def _join_words(words):
    return _PUNCT_SPACE.sub(r"\1", " ".join(word["text"] for word in words)).strip()


def _split_segment(segment):
    words = [
        {"start": round(word.start, 3), "end": round(word.end, 3), "text": word.word.strip()}
        for word in (segment.words or [])
        if word.word.strip() and word.end > word.start
    ]
    if not words:
        text = segment.text.strip()
        if segment.end > segment.start and text:
            return [{"start": round(segment.start, 3), "end": round(segment.end, 3), "text": text, "words": []}]
        return []

    chunks = []
    current = []
    for index, word in enumerate(words):
        current.append(word)
        duration = word["end"] - current[0]["start"]
        next_word = words[index + 1] if index + 1 < len(words) else None
        pause_after = (next_word["start"] - word["end"]) if next_word else 0.0
        sentence_break = bool(_SENTENCE_END.search(word["text"])) and (len(current) >= 3 or duration >= 1.5)
        pause_break = next_word is not None and pause_after >= 0.45 and duration >= 1.4
        clause_break = duration >= 6.0 and word["text"].endswith((",", ";", ":")) and len(current) >= 10
        length_break = duration >= 8.0 or len(current) >= 26
        if sentence_break or pause_break or clause_break or length_break:
            text = _join_words(current)
            if text and current[-1]["end"] > current[0]["start"]:
                chunks.append({"start": current[0]["start"], "end": current[-1]["end"], "text": text, "words": current})
            current = []
    if current:
        text = _join_words(current)
        if text and current[-1]["end"] > current[0]["start"]:
            chunks.append({"start": current[0]["start"], "end": current[-1]["end"], "text": text, "words": current})
    return chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--cache", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--device", default=os.environ.get("CORTE_WHISPER_DEVICE", "auto"))
    args = parser.parse_args()

    use_cuda, device, compute_type, extra = _select_runtime(
        args.device.strip().lower(),
        os.environ.get("CORTE_WHISPER_COMPUTE", "").strip() or None,
    )
    model = WhisperModel(
        args.model,
        device=device,
        compute_type=compute_type,
        download_root=args.cache,
        **extra,
    )
    if args.source is None:
        return

    if use_cuda:
        batch_size = max(1, int(os.environ.get("CORTE_WHISPER_BATCH", "16")))
        pipeline = BatchedInferencePipeline(model=model)
        raw_segments, info = pipeline.transcribe(
            args.source,
            batch_size=batch_size,
            beam_size=2,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )
    else:
        raw_segments, info = model.transcribe(
            args.source,
            beam_size=3,
            word_timestamps=True,
            vad_filter=True,
            condition_on_previous_text=False,
        )

    segments = []
    for raw in raw_segments:
        for chunk in _split_segment(raw):
            segments.append({"id": len(segments) + 1, **chunk})

    result = {"language": info.language, "segments": segments}
    output = Path(args.output)
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    temporary.replace(output)


if __name__ == "__main__":
    main()
