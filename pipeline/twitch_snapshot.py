"""Resolve Twitch live streams, live RECORDING VODs, recorded VODs, and clips.

For active Twitch broadcasts with an exposed archive VOD, freezes the growing
HLS EVENT playlist up to the current moment by rewriting segment URIs to
absolute URLs and appending #EXT-X-ENDLIST so yt-dlp downloads cleanly from
t=0 to the current second and terminates instead of tailing indefinitely.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import yt_dlp

TWITCH_GQL_URL = "https://gql.twitch.tv/gql"
TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"
MAX_HEIGHT = 1440


def query_twitch_gql(query: str) -> dict:
    payload = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        TWITCH_GQL_URL,
        data=payload,
        headers={"Client-ID": TWITCH_CLIENT_ID, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_iso_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def pick_channel_live_target(channel: str) -> dict:
    clean = re.sub(r"[^a-zA-Z0-9_]", "", channel).lower()
    gql = query_twitch_gql(f"""query {{
      user(login: "{clean}") {{
        displayName
        broadcastSettings {{ title }}
        stream {{
          id
          title
          createdAt
          archiveVideo {{ id title lengthSeconds createdAt status }}
        }}
        videos(first: 4, type: ARCHIVE) {{
          edges {{ node {{ id title lengthSeconds createdAt status }} }}
        }}
      }}
    }}""")
    user = (gql.get("data") or {}).get("user")
    if not user:
        return {"ok": False, "code": "NOT_FOUND", "channel": clean}

    edges = ((user.get("videos") or {}).get("edges")) or []
    latest_vods = [
        {
            "id": n["id"],
            "url": f"https://www.twitch.tv/videos/{n['id']}",
            "title": n.get("title") or "",
            "lengthSeconds": n.get("lengthSeconds") or 0,
            "createdAt": n.get("createdAt") or "",
            "status": n.get("status") or "",
        }
        for n in (e.get("node") for e in edges)
        if n and n.get("id")
    ]

    stream = user.get("stream")
    if not stream:
        return {"ok": False, "code": "OFFLINE", "channel": clean, "latestVods": latest_vods}

    title = stream.get("title") or ((user.get("broadcastSettings") or {}).get("title")) or f"Directo de {user.get('displayName') or clean}"
    archive = stream.get("archiveVideo")
    vod_id = archive.get("id") if isinstance(archive, dict) else None

    if not vod_id:
        stream_ts = parse_iso_ts(stream.get("createdAt"))
        for vod in latest_vods:
            vod_ts = parse_iso_ts(vod.get("createdAt"))
            if vod.get("status") == "RECORDING" or (stream_ts and vod_ts and vod_ts >= stream_ts - 300):
                vod_id = vod["id"]
                break

    if not vod_id:
        return {
            "ok": False,
            "code": "LIVE_VOD_UNAVAILABLE",
            "channel": clean,
            "streamId": stream.get("id"),
            "title": title,
            "startedAt": stream.get("createdAt"),
            "latestVods": latest_vods,
        }

    return {
        "ok": True,
        "vodId": vod_id,
        "targetUrl": f"https://www.twitch.tv/videos/{vod_id}",
        "title": title,
        "channel": clean,
        "startedAt": stream.get("createdAt"),
    }


def select_best_2k_format(formats: list[dict]) -> dict | None:
    playable = [
        f for f in (formats or [])
        if f.get("url") and f.get("vcodec") != "none" and (f.get("height") or 0) <= MAX_HEIGHT
    ]
    if not playable:
        playable = [f for f in (formats or []) if f.get("url") and f.get("vcodec") != "none"]
    if not playable:
        return None
    playable.sort(
        key=lambda f: (
            1 if (f.get("acodec") not in (None, "none")) else 0,
            f.get("height") or 0,
            f.get("fps") or 0,
            f.get("tbr") or 0,
        )
    )
    return playable[-1]


def freeze_m3u8_snapshot(m3u8_url: str, raw_text: str, out_dir: str) -> tuple[str, int, float]:
    out_lines = []
    segments = 0
    total_duration = 0.0
    for line in raw_text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#EXT-X-MAP:") or stripped.startswith("#EXT-X-KEY:"):
            line = re.sub(
                r'URI="([^"]+)"',
                lambda m: f'URI="{urllib.parse.urljoin(m3u8_url, m.group(1))}"',
                line,
            )
        elif stripped.startswith("#EXTINF:"):
            try:
                total_duration += float(stripped.split(":", 1)[1].split(",", 1)[0])
            except ValueError:
                pass
        elif not stripped.startswith("#"):
            line = urllib.parse.urljoin(m3u8_url, stripped)
            segments += 1
        out_lines.append(line)

    if "#EXT-X-ENDLIST" not in out_lines:
        out_lines.append("#EXT-X-ENDLIST")

    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "live-snapshot.m3u8")
    with open(snap_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out_lines) + "\n")
    return snap_path, segments, round(total_duration, 2)


def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "code": "USAGE", "message": "Usage: twitch_snapshot.py <url> <out_dir>"}))
        return 1

    raw_url = sys.argv[1].strip()
    out_dir = sys.argv[2].strip()
    parsed = urllib.parse.urlparse(raw_url)
    host = parsed.hostname.lower() if parsed.hostname else ""
    parts = [p for p in parsed.path.split("/") if p]

    if host == "clips.twitch.tv" or (len(parts) >= 3 and parts[1] == "clip"):
        print(json.dumps({"ok": True, "mode": "direct", "downloadUrl": raw_url, "isLive": False}))
        return 0

    override_title = None
    target_url = raw_url
    vod_id = None

    if len(parts) >= 2 and parts[0] == "videos" and parts[1].isdigit():
        vod_id = parts[1]
        target_url = f"https://www.twitch.tv/videos/{vod_id}"
    elif len(parts) >= 3 and parts[1] == "video" and parts[2].isdigit():
        vod_id = parts[2]
        target_url = f"https://www.twitch.tv/videos/{vod_id}"
    elif len(parts) == 1:
        live_res = pick_channel_live_target(parts[0])
        if not live_res.get("ok"):
            print(json.dumps(live_res))
            return 2
        target_url = live_res["targetUrl"]
        vod_id = live_res["vodId"]
        override_title = live_res.get("title")

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(target_url, download=False)
    except Exception as exc:
        print(json.dumps({"ok": False, "code": "EXTRACTOR_ERROR", "message": str(exc)}))
        return 3

    title = (override_title or info.get("title") or "Vídeo de Twitch").strip()
    channel = info.get("channel") or info.get("uploader")
    is_live = bool(info.get("is_live")) or info.get("live_status") == "is_live"
    fmt = select_best_2k_format(info.get("formats") or [])

    if fmt and "m3u8" in (fmt.get("protocol") or ""):
        try:
            with urllib.request.urlopen(fmt["url"], timeout=15) as resp:
                m3u8_text = resp.read().decode("utf-8", errors="ignore")
            if is_live or "#EXT-X-ENDLIST" not in m3u8_text:
                snap_path, segments, elapsed = freeze_m3u8_snapshot(fmt["url"], m3u8_text, out_dir)
                file_url = "file:///" + snap_path.replace("\\", "/")
                print(json.dumps({
                    "ok": True,
                    "mode": "snapshot",
                    "downloadUrl": file_url,
                    "snapshotPath": snap_path,
                    "targetUrl": target_url,
                    "vodId": vod_id or info.get("id"),
                    "title": title,
                    "channel": channel,
                    "isLive": True,
                    "segments": segments,
                    "elapsedSeconds": elapsed,
                }))
                return 0
        except Exception as exc:
            if is_live:
                print(json.dumps({"ok": False, "code": "SNAPSHOT_ERROR", "message": str(exc)}))
                return 4

    print(json.dumps({
        "ok": True,
        "mode": "direct",
        "downloadUrl": target_url,
        "vodId": vod_id or info.get("id"),
        "title": title,
        "channel": channel,
        "isLive": False,
        "duration": info.get("duration"),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
