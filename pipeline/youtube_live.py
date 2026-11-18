"""Download an active YouTube live stream from its beginning (00:00 / earliest
DVR segment) up to the exact current live edge (X-Head-Seqnum) and stop cleanly.
"""
import argparse
import json
import os
import sys
import urllib.request

import yt_dlp
from yt_dlp.utils import update_url_query


def probe_seq(base_url: str, seq: int) -> bool:
    url = update_url_query(base_url, {"sq": str(seq)})
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            return 200 <= resp.status < 400
    except Exception:
        return False


def get_head_seq(base_url: str) -> int:
    req = urllib.request.Request(base_url, method="HEAD")
    with urllib.request.urlopen(req, timeout=12) as resp:
        raw = resp.headers.get("X-Head-Seqnum")
    if raw is None or not str(raw).isdigit():
        raise RuntimeError("YouTube no devolvió X-Head-Seqnum para el directo.")
    return int(raw)


def find_earliest_seq(base_url: str, head_seq: int) -> int:
    if probe_seq(base_url, 0):
        return 0
    lo, hi = 1, max(1, head_seq)
    earliest = head_seq
    while lo <= hi:
        mid = (lo + hi) // 2
        if probe_seq(base_url, mid):
            earliest = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return earliest


def fmt_size(num_bytes: float | None) -> str:
    if not num_bytes or num_bytes <= 0:
        return "—"
    mib = num_bytes / (1024 * 1024)
    return f"{mib:.1f} MiB" if mib >= 1 else f"{num_bytes / 1024:.0f} KiB"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("out_dir")
    parser.add_argument("ffmpeg_dir")
    parser.add_argument("--max-fragments", type=int, default=0)
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    os.chdir(args.out_dir)
    last_emit = [0.0]

    def on_hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        import time
        now = time.time()
        if now - last_emit[0] < 0.35:
            return
        last_emit[0] = now
        frag_idx = d.get("fragment_index") or 0
        frag_tot = d.get("fragment_count") or 0
        pct = f"{min(99.0, (frag_idx / frag_tot) * 100):.1f}%" if frag_tot else "0.0%"
        spd = d.get("_speed_str") or (f"{(d.get('speed') or 0) / 1048576:.2f} MiB/s" if d.get("speed") else "—")
        dl = d.get("_downloaded_bytes_str") or fmt_size(d.get("downloaded_bytes"))
        eta = d.get("_eta_str") or "—"
        print(f"download:{pct}|{spd}|{dl}|{eta}", flush=True)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "live_from_start": True,
        "concurrent_fragment_downloads": 6,
        "retries": 8,
        "fragment_retries": 8,
        "skip_unavailable_fragments": True,
        "socket_timeout": 25,
        "ffmpeg_location": args.ffmpeg_dir,
        "js_runtimes": {"node": {}},
        "outtmpl": "source.%(ext)s",
        "format": "bv*[height<=1080][vcodec^=avc1]+ba/bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
        "merge_output_format": "mkv",
        "progress_hooks": [on_hook],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(args.url, download=False)
        if not info.get("is_live"):
            print(json.dumps({"ok": False, "code": "NOT_LIVE", "title": info.get("title")}), flush=True)
            return 2

        live_formats = [f for f in (info.get("formats") or []) if f.get("is_from_start") and f.get("url")]
        if not live_formats:
            print(json.dumps({"ok": False, "code": "NO_DVR", "message": "Este directo de YouTube no tiene rebobinado DVR habilitado."}), flush=True)
            return 3

        # Snapshot head sequence & earliest available DVR sequence once across formats.
        sample_url = live_formats[-1]["url"]
        head_seq = get_head_seq(sample_url)
        start_seq = find_earliest_seq(sample_url, head_seq)
        end_seq = head_seq
        if args.max_fragments > 0:
            end_seq = min(head_seq, start_seq + args.max_fragments - 1)

        if end_seq < start_seq:
            print(json.dumps({"ok": False, "code": "EMPTY_DVR", "message": "El directo acaba de empezar y aún no tiene fragmentos listos."}), flush=True)
            return 4

        target_dur = live_formats[-1].get("target_duration") or 1
        for f in live_formats:
            base = f["url"]
            f["fragments"] = [{"url": update_url_query(base, {"sq": str(i)})} for i in range(start_seq, end_seq + 1)]
            f["protocol"] = "http_dash_segments"
            f["is_live"] = False
            f.pop("is_from_start", None)

        info["is_live"] = False
        info["live_status"] = "was_live"
        ydl.process_ie_result(info, download=True)

        elapsed_seconds = round((end_seq - start_seq + 1) * float(target_dur), 2)
        title = (info.get("title") or "Directo de YouTube").strip()
        print("\nCORTE_LIVE_META:" + json.dumps({
            "ok": True,
            "title": title,
            "isLive": True,
            "startSeq": start_seq,
            "endSeq": end_seq,
            "headSeq": head_seq,
            "fragments": end_seq - start_seq + 1,
            "elapsedSeconds": elapsed_seconds,
        }), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
