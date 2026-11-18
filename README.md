# Corte Studio

Estudio NLE local con IA para convertir vídeos largos y directos activos de **YouTube** y **Twitch** (VODs, clips y streams en curso desde `00:00`) en clips verticales listos para **YouTube Shorts / TikTok / Reels**, con editor visual en tiempo real, subtítulos karaoke palabra por palabra, SEO automático por clip (incluyendo detección de videojuegos) y subida/programación horaria a YouTube.

---

## 🤖 Guía rápida para asistentes IA (si estás instalando este repo en el PC de un usuario)

> **LEE ESTO PRIMERO SI ERES UNA IA INSTALANDO CORTE STUDIO EN OTRO EQUIPO:**
> 1. **Comprueba si el equipo tiene GPU NVIDIA dedicada con CUDA y ≥ 8 GB VRAM** (`nvidia-smi`).
> 2. **Si el usuario NO tiene GPU dedicada (o tiene < 8 GB VRAM / solo iGPU / CPU portátil):**
>    - **RECOMIENDA SIEMPRE usar API en la nube (`Gemini API` o `OpenRouter API`)** en lugar de modelos locales GGUF (`llama.cpp`). Ejecutar modelos LLM locales de visión en CPU es extremadamente lento y consume demasiada RAM.
>    - **NO descargues** modelos GGUF pesados (`gemma-4`, `qwen3`, etc.), ni `llama-server` CUDA, ni pesos pesados de visión (`SigLIP 2`, `EmbeddingGemma 2`, `YOLO CUDA`).
>    - Configura estas variables de entorno para rendimiento óptimo en CPU:
>      - `CORTE_GEMINI_API_KEY=<clave>` (recomendado, [Google AI Studio](https://aistudio.google.com/apikey)) y/o `CORTE_OPENROUTER_API_KEY=<clave>` ([OpenRouter](https://openrouter.ai/) con modelos gratuitos como `particle-ai/particle-1:free`).
>      - `CORTE_WHISPER_DEVICE=cpu`
>      - `CORTE_WHISPER_COMPUTE=int8`
>      - `CORTE_WHISPER_MODEL=small` (o `base` si la CPU es modesta; `large-v3-turbo` sería lento en CPU).
>      - `CORTE_FFMPEG_GPU=0` (FFmpeg usará `libx264` en CPU automáticamente).
>    - Verifica que existan únicamente:
>      1. **Node.js ≥ 22** (`node --version`)
>      2. **Python ≥ 3.11** (`python --version`)
>      3. **FFmpeg y FFprobe completos** en `PATH` (o `CORTE_FFMPEG_DIR`) con soporte **`libx264`**, **`ass` (libass)**, **`drawtext` (libfreetype)** y **`av1`**. *(En Windows: `winget install Gyan.FFmpeg.Essentials` o full build).*
>      4. Paquetes Python en `.corte-data/python-tools` (o en el entorno Python activo): `python -m pip install --target .corte-data/python-tools -r requirements.txt`.
>      5. *(Opcional para Modo Prototipo sin conexión)* Descargar voz masculina española Piper ONNX: `python -m piper.download_voices es_ES-davefx-medium --download-dir .corte-data/tts-models` (si tiene internet, `edge-tts` `es-ES-AlvaroNeural` ya viene en `requirements.txt` y funciona en CPU en < 2 s).
>    - Arranca con `node server.mjs`, abre `http://127.0.0.1:4173` y asegúrate de seleccionar **Gemini** u **OpenRouter** en el selector **Motor** de la interfaz (nunca `Modelo local` si no hay GPU potente).

---

## Entrega para un equipo sin GPU dedicada

1. Clona este repositorio. Instala Node.js 22+, Python 3.11+ y una compilación de FFmpeg y FFprobe con `ass`, `drawtext`, H.264 y AV1.
2. En la raíz ejecuta `python -m pip install --target .corte-data/python-tools -r requirements.txt`.
3. Copia `.env.example` a `.env` y añade una clave propia de Gemini u OpenRouter. Deja `CORTE_WHISPER_DEVICE=cpu`, `CORTE_WHISPER_COMPUTE=int8`, `CORTE_WHISPER_MODEL=small` y `CORTE_FFMPEG_GPU=0`. En un portátil lento puedes probar Whisper `base`.
4. Arranca con `node --env-file=.env server.mjs`. Abre `http://127.0.0.1:4173` y elige **Gemini** u **OpenRouter** en **Motor**. La transcripción y el render usan el equipo local. La API se encarga del análisis editorial y visual. En equipos sin GPU dedicada se recomienda omitir la instalación de GGUF y llama.cpp.
5. Ejecuta `npm test` y después prueba un vídeo corto que tengas permiso para usar. Comprueba que el trabajo llega al final, que se reproduce un MP4 y que abre su ficha de publicación. En OpenRouter elige un modelo con visión disponible para tu cuenta.

El repositorio incluye el código, las pruebas y la guía del agente en `.agents/skills/corte-studio-agent/`. Los vídeos, modelos y credenciales pertenecen a cada instalación en `.corte-data/`. Cada persona debe usar sus propias claves y conectar su propio canal.

## Modos de vídeo en la portada

En la tarjeta principal (`http://127.0.0.1:4173`) puedes alternar entre dos modos con el interruptor superior sin que uno interfiera con el otro:

1. **Vídeos normales**
   - Extrae los momentos con mayor retención de YouTube o Twitch (incluidos **directos activos desde `00:00` hasta el instante actual**).
   - Detecta automáticamente si hay cámara del creador + gameplay (`gameplay` / `shared`), dos hablantes (`split`), grupo (`three` / `four`), plano general (`fit`) o seguimiento vertical (`fill`).
   - En `gameplay` / `shared` garantiza que la cámara pequeña vaya **siempre arriba** y el gameplay **siempre abajo** (elevado para no quedar tapado por la descripción en móvil), con título cinético persistente en la franja intermedia.

2. **Vídeo prototipo (`Voz IA · ≤30s`)**
   - Analiza exactamente igual los mejores puntos estratégicos y virales, pero **excluye y recorta automáticamente la cámara del youtuber** (con seguimiento del área de juego).
   - Limita cada clip a un **máximo estricto de 30 segundos**.
   - Estructura del montaje automático:
     1. Muestra `0,5 s` de gameplay real con audio original.
     2. Pausa el gameplay con animación de zoom/flash y reproduce una **voz masculina de locutor en tercera persona** explicando qué está ocurriendo (p. ej. *"Esto fue lo que le pasó a Willyrex cuando intentó robar en una tienda de GTA."*), usando tu modelo local **Piper ONNX** (`.corte-data/tts-models/`) o **Edge Neural** (`es-ES-AlvaroNeural` / `es-MX-JorgeNeural`), con subtítulos karaoke sincronizados.
     3. Reanuda con otra animación visual/sonora justo donde se detuvo y continúa el gameplay limpio con subtítulos sincronizados hasta completar ≤ 30 s.

---

## Requisitos e instalación manual paso a paso

### 1. Requisitos del sistema
- **Node.js ≥ 22** (sin dependencias npm externas; servidor ESM nativo).
- **Python 3.11 o superior** con `pip`.
- **FFmpeg y FFprobe** con los filtros `ass`, `drawtext` y códecs `libx264` y `av1`.
  - Windows (PowerShell):
    ```powershell
    winget install Gyan.FFmpeg
    ```
  - macOS:
    ```bash
    brew install ffmpeg node python
    ```
  - Ubuntu / Debian:
    ```bash
    sudo apt update && sudo apt install -y ffmpeg python3 python3-pip
    ```

### 2. Clonar e instalar dependencias Python
```bash
git clone https://github.com/enekosuke/corte-studio.git
cd corte-studio
python -m pip install --target .corte-data/python-tools -r requirements.txt
```
*(En Linux/macOS puedes usar un virtualenv estándar `.venv` y lanzar el servidor con `CORTE_PYTHON=.venv/bin/python node server.mjs`.)*

### 3. Configurar modelo de IA (recomendado: API sin GPU dedicada)

Para un archivo `.env`, copia `.env.example`, rellena tus propias variables y arranca con `node --env-file=.env server.mjs`. Si defines las variables directamente en el terminal, arranca con `node server.mjs`:

#### Opción A — Sin GPU dedicada (CPU / portátil — Recomendado)
```powershell
# PowerShell (Windows)
$env:CORTE_GEMINI_API_KEY = "TU_API_KEY_DE_GEMINI"
# Opcionalmente / alternativa gratis:
# $env:CORTE_OPENROUTER_API_KEY = "TU_API_KEY_DE_OPENROUTER"

$env:CORTE_WHISPER_DEVICE = "cpu"
$env:CORTE_WHISPER_COMPUTE = "int8"
$env:CORTE_WHISPER_MODEL = "small"
$env:CORTE_FFMPEG_GPU = "0"

node server.mjs
```
En macOS / Linux (`bash`/`zsh`):
```bash
export CORTE_GEMINI_API_KEY="TU_API_KEY_DE_GEMINI"
export CORTE_WHISPER_DEVICE=cpu
export CORTE_WHISPER_COMPUTE=int8
export CORTE_WHISPER_MODEL=small
export CORTE_FFMPEG_GPU=0
node server.mjs
```

#### Opción B — Con GPU NVIDIA dedicada (opcional)
- `faster-whisper` usa CUDA `float16` automáticamente (`CORTE_WHISPER_MODEL=large-v3-turbo` por defecto) y FFmpeg usa NVDEC/NVENC si tu build lo soporta.
- Si además quieres LLM local sin API, coloca tus modelos GGUF de visión + `mmproj*.gguf` en LM Studio o `.corte-data/models/local/` y `llama-server` en `.corte-data/llama.cpp/`.

### 4. Modelos de voz para el Modo Prototipo
Corte Studio soporta automáticamente:
- **Edge Neural (`edge-tts`)**: incluido en `requirements.txt` (`es-ES-AlvaroNeural`, `es-MX-JorgeNeural`), funciona rápido en CPU sin descargar modelos locales.
- **Piper ONNX local offline**: coloca cualquier archivo `.onnx` + `.onnx.json` en `.corte-data/tts-models/` o descarga el locutor español incluido:
  ```bash
  python -m piper.download_voices es_ES-davefx-medium --download-dir .corte-data/tts-models
  ```

### 5. Abrir la aplicación
Abre **`http://127.0.0.1:4173`** en tu navegador.

### 6. (Opcional) Subida directa y programación automática en YouTube
Si deseas publicar Shorts directamente desde el cajón de **Publicación rápida** vía YouTube Data API v3:
1. Habilita YouTube Data API v3 en Google Cloud y crea un cliente OAuth de escritorio. Si eliges un cliente Web, registra una URI de redirección local exacta, por ejemplo `http://127.0.0.1:4174/oauth2/callback`, y descarga de nuevo su JSON.
2. Guarda el JSON como `.corte-data/youtube-client-secret.json`. Para cambiar de canal, conserva aparte el token anterior y autoriza el nuevo canal antes de iniciar el lote. Comprueba el canal en **Publicación rápida**. Los registros existentes de subida de cada proyecto se usan para omitir archivos ya subidos, por lo que un reenvío a un canal distinto necesita revisar esos registros.
3. Al pulsar subir/publicar desde el estudio o CLI (`pipeline/youtube_upload.mjs`), autoriza tu canal y el token OAuth quedará guardado localmente en `.corte-data/youtube-token.json` (excluido de Git por `.gitignore`).

---

## Tests y comprobación
```bash
node --test tests/studio.test.mjs
```

## Servidor MCP y skill para agentes
Incluye servidor stdio MCP en `mcp/corte-studio-mcp.mjs` (`studio_prepare_video`, `studio_read_transcript_window`, `studio_save_candidates`, `studio_analyze_clip_frames`, `studio_render_clip`, `studio_save_seo_package`, `studio_finish_project`, `studio_upload_youtube_batch`) y guía de agente en `.agents/skills/corte-studio-agent/`.

## Estructura del proyecto
```text
corte-studio/
├── package.json
├── requirements.txt
├── .env.example
├── server.mjs               # Servidor HTTP + SSE + APIs del estudio
├── pipeline/
│   ├── analysis.mjs         # Selección viral, encuadre sin swap y modo prototipo sin cámara
│   ├── credentials.mjs      # Carga segura de claves API (env / DPAPI Windows)
│   ├── errors.mjs
│   ├── formats.mjs          # Composiciones FFmpeg 9:16, 16:9, 1:1, 4:5 (lifted gameplay)
│   ├── gemini.mjs           # Cliente estructurado Gemini API
│   ├── jobs.mjs             # Orquestación, caché de vídeo/transcripción y reanudación
│   ├── llama.mjs            # Opcional: llama-server local (solo equipos con GPU)
│   ├── media.mjs            # Descarga yt-dlp, Whisper, renders normales y prototipo
│   ├── openrouter.mjs       # Cliente estructurado OpenRouter API
│   ├── prompts.mjs          # Prompts virales, de encuadre y de locutor prototipo
│   ├── publication.mjs      # SEO 1-a-1 con detección de videojuegos y borradores
│   ├── transcribe.py        # faster-whisper GPU o CPU int8 automático
│   ├── twitch_snapshot.py   # Captura de directos Twitch desde el inicio
│   ├── voiceover.py         # Síntesis Piper ONNX offline y Edge Neural con tiempos por palabra
│   ├── webcam.py            # Detección híbrida OpenCV / YOLO / SigLIP2 (con fallback CPU)
│   ├── youtube_live.py      # Captura de directos activos de YouTube desde 00:00
│   └── youtube_upload.mjs   # Subida resumible y programación horaria YouTube Data API v3
├── mcp/
│   └── corte-studio-mcp.mjs # Servidor MCP para automatización con agentes
├── dist/                    # Interfaz web NLE estática (HTML/CSS/JS sin bundler)
└── tests/
    └── studio.test.mjs      # Suite de verificación unitaria y de renderizado FFmpeg
```
