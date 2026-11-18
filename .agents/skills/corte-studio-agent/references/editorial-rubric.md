# Viral Editorial, Visual & SEO Rubric

## 1. Clip Selection Rules
- **Self-contained arc**: Never start mid-sentence or cut off a punchline. Prefer segments with `pauseBefore >= 0.4s` at the start and crisp resolution at the end.
- **Duration sweet spot**: Aim for **22s–58s** (strictly constrained between `8s` and `90s` by Corte Studio's validator).
- **Signal synergy**: Combine transcript hooks (controversy, confession, surprise twist, tutorial payoff, heated reaction) with high acoustic `energy` (`>= 6.5`) and `wps` bursts (`>= 2.8`).
- **Avoid overlap**: Space clips cleanly across the timeline (`< 35%` overlap automatically enforced).

## 2. Massive Kinetic Hook (`onScreenHook`)
- Appears cleanly on top of normal/fit/split videos in giant bold `Arial Black` ASS typography.
- **3 to 6 words**, immediate tension/curiosity, native video language:
  - Good: `"CASI PIERDE 10 HORAS AQUÍ"`, `"ESTO CAMBIÓ TODO EL DIRECTO"`, `"EL TRUCO QUE NADIE USA"`
  - Bad: `"Momento divertido del vídeo"`, `"Resumen de la partida"`

## 3. Per-Clip Visual Framing Rules
Always evaluate each clip **independently** (a long stream or podcast often mixes talking intros, two-person debates, gameplay, and desktop reactions!):
- **`gameplay`**: Clear rectangular webcam overlay + full game HUD (`EmbeddingGemma 2` scene `'gameplay'` + `inset`). Ensure `cameraBox` fits the cam frame cleanly without slicing the face, and `screenBox` stays disjoint from `cameraBox`.
- **`shared`**: Facecam + browser/slides/article/react player.
- **`split`**: Two distinct speakers horizontally separated (`faces.length >= 2`, horizontal gap `> 0.25`).
- **`fill`**: Single speaker/podcaster/vlog where vertical crop flatters the subject.
- **`fit`**: Wide multi-subject scenes, rapid edits, overlays/charts across full 16:9 width, or memes where cropping hides punchlines.

## 4. SEO & Publication Package Checklist
- `game`: Exact videogame name when the clip shows gameplay (e.g., `GTA 6`, `Valorant`, `Minecraft`, `EA FC`, `Fortnite`, `Call of Duty`). Leave empty `""` for non-gaming clips.
- `query`: Exact YouTube/TikTok search phrase viewers type.
- `seoKeywords`: 5–8 natural long-tail + niche keywords (lowercase).
- `coverText`: 2–4 explosive thumbnail words (all caps).
- `pinnedComment`: Engaging question to trigger replies within the first 5 seconds of reading.
- `youtubeTitle`: Curiosity/search hybrid under 75 chars + crisp `#Shorts` in description.
- `tiktokText`: Native spoken hook + fast CTA + 3–5 relevant `#hashtags`.

### Gameplay / Videogame SEO Rules (Required for Gaming Clips)
- **Identify the exact game**: Read HUD, video title, transcript, and game visuals to pass `game` in `studio_save_seo_package`.
- **Name + mechanic/context in copy**: Mention the game explicitly in `youtubeTitle`, `youtubeText`, and `tiktokText`, plus specific context of what happens in that game (map, weapon, mode, mission, bug, clutch, boss, car, or mechanic).
- **Game hashtags first**: Put `#NombreDelJuego` (e.g., `#GTA6`, `#Valorant`, `#Minecraft`, `#EAFC`) and `#Gameplay` / `#Gaming` ahead of generic tags in `youtubeHashtags` and `tiktokHashtags`.
- **Game search keywords**: Include game-prefixed long-tail terms in `seoKeywords` (e.g., `"gta 6 detalles español"`, `"valorant mejores jugadas"`).
