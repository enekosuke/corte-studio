---
name: corte-studio-agent
description: Extract viral vertical/square clips (9:16, 4:5, 1:1, 16:9) from any YouTube or Twitch URL (live streams captured from start up to right now, VODs, or clips) using Corte Studio's local MCP server, acting as the editorial, visual framing, and SEO LLM directly without external API keys or rate limits. Use whenever the user gives a YouTube or Twitch URL/ID or asks to generate Shorts, TikToks, Reels, or viral clips with Corte Studio.
---

# Corte Studio Agent Playbook

You are the **editorial, visual framing, and viral SEO brain** driving Corte Studio via the `corte-studio` MCP server. Local GPU compute (`yt-dlp` up to 2K, Whisper GPU, `EmbeddingGemma 2`, `SigLIP 2`, `YOLOv8 Face`, `YOLO11 Pose`, OpenCV `snap_webcam_box`, `FFmpeg`/`h264_nvenc` + massive kinetic `Arial Black` ASS subtitles) runs locally on the user's machine; **you** make all creative decisions directly—do not call paid external LLM APIs.

## Quick Execution Loop (6 Phases)

1. **Discover formats or existing work**
   - Call `studio_inspect_formats` if you need valid `ratio` (`9:16`, `4:5`, `1:1`, `16:9`), `layouts`, `fitCrop`, or `contentCrop` options.
   - Optionally call `studio_list_projects` to see if the video is already processed.

2. **Prepare video & transcribe on GPU**
   - Call `studio_prepare_video({ url, format })` with YouTube (`watch`, `youtu.be`, `shorts`, `live`) **or Twitch** (`twitch.tv/<channel>` live stream captured from `00:00` up to now when live VOD is enabled, `twitch.tv/videos/<id>` VOD, or `clips.twitch.tv/<slug>`).
   - It automatically reuses local 2K source caches for finished videos/VODs, freezes live Twitch streams up to the present moment cleanly, runs GPU Whisper + acoustic energy analysis, builds the timeline waveform, and registers the project in Corte Studio Web UI (`http://127.0.0.1:4173/?job=<jobId>`).

3. **Act as Viral Editor (select clips from transcript windows)**
   - Read the entire video cleanly in pages with `studio_read_transcript_window({ jobId, offsetSegmentIndex, maxSegments: 80 })` until `hasMore === false`.
   - Score moments using `energy` (0–10), `wps` (words/sec), `pauseBefore`, and semantic payoff. See [editorial-rubric.md](references/editorial-rubric.md).
   - Select **3 to 8** self-contained viral clips (**15s–75s ideal**, hard bounds 8s–90s) matching the video's native language.
   - For each clip, craft:
     - `title`: High-curiosity native title (max 120 chars; never start with boring prefixes like `"Resumen:"`).
     - `onScreenHook`: **3–6 uppercase/punchy words** (max 72 chars) for massive kinetic top overlay (e.g. `"NO TE IMAGINAS LO QUE DIJO"`, `"CASI SE CARGA LA PARTIDA"`).
     - `category`: e.g. `"Clímax"`, `"Polémica"`, `"Gameplay"`, `"Humor"`, `"Revelación"`.
     - `reason`, `score`, `hookScore`, `retentionScore`, `shareScore`, `clarityScore`.
   - Persist selections with `studio_save_candidates({ jobId, clips })`. Note the returned `clipIndex` (`1..N`).

4. **Act as Visual Director (inspect frames per clip)**
   - For each `clipIndex`, call `studio_analyze_clip_frames({ jobId, clipIndex })`.
   - This runs the local GPU stack (`EmbeddingGemma 2` + `SigLIP 2` + `YOLOv8 Face` + `YOLO11 Pose` + OpenCV webcam snapping), returns `sceneSummary` + `suggestedFraming`, and saves raw `.jpg` frames on disk.
   - **Important**: Read 1–3 representative `.jpg` paths via `read_file` whenever:
     - `sceneSummary` is mixed/uncertain,
     - a webcam might overlap gameplay (`gameplay` / `shared`),
     - you want to verify per-clip switches between gameplay and full-camera talking segments!
   - Pick the best layout (`gameplay`, `shared`, `split`, `fill`, or `fit`) and precise `[0..1]` boxes (`cameraBox`, `screenBox`, `focusBox`)—or omit `framing` to accept `suggestedFraming` when telemetry is already sharp.

5. **Render MP4 + Massive Kinetic Subtitles**
   - Call `studio_render_clip({ jobId, clipIndex, framing, title, onScreenHook })` for each clip.
   - Corte Studio renders cleanly with word-synced kinetic ASS captions, non-overlapping webcam/gameplay panels, and optional blurred aesthetic `fit` backdrop.

6. **Write Full SEO & Publication Package, then Finalize**
   - For each rendered clip, write high-CTR native metadata via `studio_save_seo_package({ jobId, clipIndex, seo })` covering `query`, `hook`, `seoKeywords` (4–8 tags), `coverText` (2–4 punchy cover words), `pinnedComment`, `seoScore` (1–100), `youtubeTitle`, `youtubeText`, `youtubeHashtags`, `tiktokText`, `tiktokHashtags`.
   - Call `studio_finish_project({ jobId })` when all clips finish so the GPU vision worker shuts down cleanly and the Web UI marks the project `done`.
   - Present the clickable `file:///` paths of the rendered MP4s and the `studioUrl` to the user.

## Detailed Reference Files

- [mcp-workflow.md](references/mcp-workflow.md) — Exact schemas, coordinate conventions `[0..1]`, and JSON examples for every MCP tool.
- [editorial-rubric.md](references/editorial-rubric.md) — Clip duration rules, hook writing patterns, per-scene layout rules, and SEO scoring checklist.
