# Corte Studio MCP Tool & Coordinate Reference

All MCP tools belong to the `corte-studio` server (`mcp/corte-studio-mcp.mjs`).

## Tool Sequence Overview

| Step | Tool | Purpose |
| --- | --- | --- |
| 0 | `studio_inspect_formats` | Get ratios (`9:16`, `4:5`, `1:1`, `16:9`), layouts, crop defaults |
| 0b | `studio_list_projects` | Browse existing jobs and URLs |
| 1 | `studio_prepare_video` | Download/cache 2K source + Whisper GPU + audio energy |
| 2 | `studio_read_transcript_window` | Paginate speech transcript + acoustic signals |
| 3 | `studio_save_candidates` | Validate word boundaries + save `candidates.json` |
| 4 | `studio_analyze_clip_frames` | Extract `.jpg` frames + run EmbeddingGemma 2 / SigLIP 2 / YOLO |
| 5 | `studio_render_clip` | Render `clip-N.mp4` + kinetic ASS subs + custom/CV framing |
| 6 | `studio_save_seo_package` | Save YouTube/TikTok copy + keywords + cover + pinned comment |
| 7 | `studio_finish_project` | Mark `done`, release GPU VRAM, return URLs & file paths |

## Normalized Bounding Boxes (`[0..1]`)

Whenever passing `cameraBox`, `screenBox`, `focusBox`, or `frames[].regions`, every edge uses normalized `[0.0 .. 1.0]` coordinates relative to the full source video frame:

```json
{
  "left": 0.02,
  "top": 0.04,
  "right": 0.27,
  "bottom": 0.36
}
```

- Origin `(0, 0)` is **top-left**, `(1, 1)` is **bottom-right**.
- For `gameplay` or `shared`:
  - `cameraBox`: Tight crop around the streamer's webcam rectangle **including shoulder/head headroom, excluding game UI outside the webcam border**.
  - `screenBox`: Main game/react region. Note that `chooseContentScreen` automatically adjusts `screenBox` when needed so ZERO pixels of `cameraBox` bleed into the gameplay panel!
- For `fill`: Use `focusBox` centered on the speaker/action subject; Corte Studio tracks and clamps smoothly within viewport bounds.
- For `fit`: Preserves wide cinematography cleanly (great for wide reaction shots, memes on full screen, or fast cuts) and pairs with large blurred framing and top kinetic `onScreenHook`.

## Example `studio_render_clip` with Custom Agent Framing

```json
{
  "jobId": "YOUR-UUID",
  "clipIndex": 1,
  "onScreenHook": "EL ERROR QUE NADIE VIO",
  "framing": {
    "layout": "gameplay",
    "reason": "Webcam fija arriba a la izquierda + HUD limpio centrado.",
    "cameraBox": { "left": 0.015, "top": 0.04, "right": 0.245, "bottom": 0.33 },
    "screenBox": { "left": 0.255, "top": 0.0, "right": 1.0, "bottom": 1.0 }
  }
}
```
