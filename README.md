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
   - En gameplay, el rótulo se afina con el diálogo y fotogramas del corte. Busca una acción concreta y lo que está en juego. Puede usar el nombre del jugador si la fuente permite identificarlo. El render reserva una franja entre la cámara y la partida y ajusta el rótulo a una o dos líneas. El rótulo se graba en el MP4. El título de publicación se gestiona en su ficha.

2. **Vídeo prototipo (`Voz IA · ≤30s`)**
   - El motor elegido busca cortes de unos 10 a 24 s con un rótulo breve, una frase de locución y un desenlace visible. Revisa el rótulo y la locución con fotogramas del propio clip. La visión y OpenCV buscan la webcam para retirar esa región del encuadre.
   - El primer plano entra en movimiento con el rótulo, los subtítulos de la fuente y un sonido breve. El montaje busca un hueco entre palabras entre 0,55 y 1,1 s. Si no encuentra uno, pausa a los 0,8 s.
   - FFmpeg congela un solo fotograma, acerca el plano, atenúa el color y dibuja una barra que acompaña la pausa. **Piper ONNX** local o **Edge Neural** sintetiza la frase. El montaje destaca la palabra que está sonando y ajusta la velocidad de un guion largo para reservar como máximo 4,1 s de voz. Edge entrega marcas de palabras. Piper estima esas marcas con la duración de la voz y la longitud de cada palabra.
   - El gameplay se reanuda desde el fotograma congelado. Los subtítulos de la fuente se desplazan el tiempo exacto de la pausa. Si la transcripción y la energía del audio coinciden en una reacción posterior, el montaje la acentúa con un acercamiento breve. La voz y los efectos se mezclan con el audio del vídeo. Los fundidos suavizan el corte y la mezcla apunta a −17 LUFS con un techo de −2 dBTP antes de codificar AAC. El rótulo se retira al continuar la acción para dejar sitio al desenlace. El máster queda por debajo de 30 s.
   - El montaje usa tres efectos de [Interface Sounds de Kenney](https://kenney.nl/assets/interface-sounds), con licencia CC0. Se incluyen en el repositorio y FFmpeg los carga localmente. El archivo `pipeline/assets/prototype-sfx/LICENSE.txt` conserva su licencia. Los originales `pluck_002.wav`, `minimize_004.wav` y `maximize_004.wav` se obtuvieron del [espejo de Calinou](https://github.com/Calinou/kenney-interface-sounds) y se convirtieron a Ogg Vorbis.

3. **Resumen (`Largo · 16:9`)**
   - Convierte un vídeo largo en una versión condensada de la duración que elijas (3 a 45 min, o automática, un 25 % del original). Genera un único `clip-1.mp4` 16:9 con capítulos incrustados.
   - La selección va en tres pasos. Primero el motor marca pasajes completos por ventanas de unos 18 min, con importancia, atractivo y tipo. Después un director global elige cuáles entran, en qué capítulo y con qué frase de tarjeta. Por último, un ajuste determinista llena o recorta hasta el objetivo con un margen de −3 % / +5 %. Si el director falla, se elige por valor.
   - Los cortes caen en pausas naturales: se entra 0,2 s antes de la primera palabra, se deja 0,38 s de cola tras la última y se eliminan las pausas internas mayores de 1,1 s. Los pasajes separados por menos de 1,6 s se unen sin corte. Todas las duraciones se ajustan a fotogramas exactos.
   - **Tarjetas de contexto:** al inicio y en los cambios de capítulo (o tras 5 min sin tarjeta, en la siguiente transición) los primeros 3,4 s del tramo se ven desenfocados, oscurecidos y con el volumen al 12 %. Encima aparece una frase corta de lo que va a pasar, como «Aquí intenta robar una tienda». Después la imagen se aclara y el sonido sube. Las tarjetas guardan al menos 90 s de separación entre sí.
   - Cada tramo se codifica por separado con caché, así que una interrupción se reanuda sin repetir los ya hechos. Se unen por copia y el audio se normaliza a −16 LUFS. Opcionalmente se graban subtítulos. El borrador de YouTube incluye título, descripción y lista de capítulos, y no añade `#Shorts`.
   - El plan se guarda en `summary-plan-<segundos>-v2.json` dentro del proyecto. «Buscar más clips» no aplica a este modo.

Cuando un proyecto llega a la **fase 05**, usa **Buscar más clips** en la cabecera del editor. El estudio reutiliza el vídeo fuente y la transcripción, vuelve a la fase 03 y excluye del análisis los fragmentos que se solapan con cualquier clip ya exportado. Los nuevos clips pasan por encuadre, render y SEO y se añaden al mismo proyecto con su propia numeración. Si cancelas o se interrumpe la búsqueda, **Terminar vídeo** reanuda esa pasada desde el punto guardado. Si la IA no encuentra más momentos, el proyecto vuelve a la fase 05 con los clips anteriores.

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

En Windows, `scripts/Start-CorteStudio.ps1` arranca el servidor en segundo plano y abre el navegador predeterminado. Si el servidor ya responde, reutiliza la instancia. El acceso directo del escritorio, si está instalado, ejecuta ese mismo script.

Para acceder desde otro equipo, vincula los dos dispositivos con la misma cuenta de Tailscale y habilita MagicDNS y los certificados HTTPS. Después, ejecuta el acceso directo en el PC que aloja el estudio y abre la dirección de `.corte-data/remote-url.txt` en el otro equipo. La dirección depende del nombre del dispositivo y de su red Tailscale. El PC que aloja el estudio debe seguir encendido y conectado. El acceso remoto requiere una conexión privada de Tailscale con la identidad de la cuenta vinculada. Si el túnel no se activa, consulta `.corte-data/remote-start.log`. La autorización inicial de YouTube se completa en el equipo que aloja el servidor.

El proxy (`scripts/corte-tailnet-proxy.mjs`) no necesita cambios cuando se añade una función al estudio: reenvía `GET`, `HEAD`, `POST`, `DELETE` y `PATCH` y todas las cabeceras salvo las del túnel y las credenciales (cookies, `Authorization`, `Tailscale-*`, `X-Forwarded-*`). Todo lo que modifica datos exige la cuenta de Tailscale vinculada y el origen del propio túnel. La interfaz se sirve desde disco en cada petición, así que sus cambios se ven al recargar; los del servidor, tras reiniciarlo. Solo si se edita el propio proxy hay que reiniciarlo (`node scripts/corte-tailnet-proxy.mjs`); la configuración de Tailscale Serve se conserva.

### 6. (Opcional) Subida directa y programación automática en YouTube
Si deseas publicar Shorts directamente desde el cajón de **Publicación rápida** vía YouTube Data API v3:
1. Habilita YouTube Data API v3 en Google Cloud y crea un cliente OAuth de escritorio. Si eliges un cliente Web, registra una URI de redirección local exacta, por ejemplo `http://127.0.0.1:4174/oauth2/callback`, y descarga de nuevo su JSON.
2. Guarda el JSON como `.corte-data/youtube-client-secret.json`. Para cambiar de canal, conserva aparte el token anterior y autoriza el nuevo canal antes de iniciar el lote. Comprueba el canal en **Publicación rápida**. Los registros existentes de subida de cada proyecto se usan para omitir archivos ya subidos, por lo que un reenvío a un canal distinto necesita revisar esos registros.
3. Al pulsar subir/publicar desde el estudio o CLI (`pipeline/youtube_upload.mjs`), autoriza tu canal y el token OAuth quedará guardado localmente en `.corte-data/youtube-token.json` (excluido de Git por `.gitignore`).

En **Publicación rápida**, selecciona el **Canal de YouTube** antes de subir un clip o un lote. Para incorporar otro, pulsa **Conectar otro canal** y autorízalo en el navegador del PC que aloja el estudio. Cada autorización adicional se guarda aparte en `.corte-data/youtube-channels/`. La cadencia consulta las publicaciones del canal elegido. Los clips ya subidos se saltan aunque elijas otro canal para los clips pendientes.

Si YouTube devuelve `uploadLimitExceeded`, el lote se detiene en ese clip y puedes retomarlo con el mismo botón cuando el canal vuelva a admitir subidas. La hora de publicación y el límite de subida se aplican por separado.

En **Publicación rápida → Cadencia → Añadir a la cola · Cada 2 horas**, el primer clip pendiente del proyecto se programa dos horas después de la última publicación futura del canal. Se tienen en cuenta los vídeos programados desde Corte Studio y desde YouTube Studio. Los siguientes clips del lote se separan otras dos horas. Si la cola está vacía, se parte de la próxima hora en punto que deje al menos quince minutos de margen.

---

## Cuántos clips salen: los que haya, sin tope

El número de clips lo decide el contenido. No hay cuota ni máximo: un vídeo con 30 momentos buenos da 30 clips y uno con 5 da 5.

- **Selección por ventanas:** el motor analiza el vídeo por ventanas y se le pide que devuelva todos los momentos fuertes de cada una (0, 3 o 15). Un momento solo entra si pasa el listón de calidad (gancho, claridad y puntuación por encima de 7); la cantidad no se recorta para llegar a ninguna cifra.
- **Revisión por lotes:** los candidatos se revisan en lotes de 25 (12 con un modelo local, para no desbordar su contexto). Después, una pasada ligera quita solo los clips que cuentan exactamente lo mismo; dos momentos distintos sobre un mismo tema se conservan. Si esa pasada falla o devuelve una lista absurda (menos del 60 % de los clips), se conservan todos.
- **Lo que sí cuesta más:** con 30 clips el proyecto tarda más (cada clip se encuadra, se renderiza y se audita) y gasta más llamadas al motor. La subida a YouTube sigue limitada por la cuota diaria de tu canal, no por la aplicación.
- **«Buscar más clips»** sigue buscando momentos fuera de los ya exportados.

## Edición viral de clips cortos (playbook de retención)

Los clips normales (no el modo prototipo ni el resumen) aplican estas técnicas. La lógica pura está en `pipeline/clipfx.mjs` (cortes, zoom, adelanto) y `pipeline/audio.mjs` (censura, efectos, música), y el montaje en `renderClip()`.

| Técnica | Cómo funciona | Cuándo se aplica |
|---|---|---|
| **Cortes de silencio y muletillas** | Quita las pausas de más de 0,45 s y los sonidos de duda («eeeh», «mmm») y los arranques vacíos («bueno», «pues») seguidos de pausa, con 0,12 s de cola y 0,08 s de entrada. Recorta el silencio final (0,22 s de cola) para favorecer el bucle. Micro-fundido de 20 ms en cada unión. Los subtítulos se recolocan y no muestran muletillas. | Layouts de charla (`fill`, `fit`, `split`, `three`, `four`). **No** en `gameplay` ni `shared`: ahí el vídeo sigue teniendo acción aunque nadie hable. Solo si quita al menos 0,35 s. |
| **Cold open** | Si la IA marca `hasColdOpenHook` y un `peakSegmentId` que llega más de 3 s después del inicio, antepone 1,6 s de ese pico con whoosh, más contraste y saturación, zoom del 10 % y un oscurecimiento seco de 0,15 s justo antes del arranque real. | Con esos campos del motor. |
| **Zoom por frase y punch-in** | Alterna plano medio y primer plano (9 %) en cada frase, con un cambio como mucho cada 3 s. En los picos de energía (`energy >= 8`, separados 4 s, máx. 6) añade empuje con retorno suave y 0,22 s de temblor. Los subtítulos y el gancho no se mueven. | La alternancia, en layouts de charla; el empuje, siempre que haya señales acústicas. |
| **Subtítulos** | Duración mínima de 90 ms por palabra y cierre de huecos de menos de 120 ms. Las palabras de `highlightWords` salen en el color de acento de la marca. `hormozi-pop`: 1 a 3 palabras, mayúsculas, pop elástico y, si la IA no marcó claves, la palabra más larga de cada frase en color. `classic-karaoke` (por defecto) conserva el estilo anterior. | Siempre. `gaming-neon`, `editorial-clean` y `podcast-speaker` aún usan el estilo clásico. |
| **Censura (bleep)** | Detecta palabrotas en español en la transcripción, silencia la voz en esa palabra y la tapa con un pitido de 1 kHz. El subtítulo sale censurado («j***r»). | Por defecto **activada**. Se desactiva con `"bleepProfanity": false` en la marca. |
| **Efectos** | Biblioteca de 6 sonidos generados con FFmpeg en `pipeline/assets/sfx/` (`scripts/generate-sfx.mjs`, dominio público): whoosh al arrancar, pop al aparecer el rótulo y golpe en los picos. `riser`, `bleep` y `record_scratch` están disponibles. | Por defecto activados. Se desactivan con `"sfx": false` en la marca. |
| **Música de fondo** | Si la marca tiene `bgmFolder` con pistas (`.ogg`, `.mp3`, `.wav`, `.m4a`, `.flac`), se reparte una por clip, con bucle, paso alto a 80 Hz, `sidechaincompress` con la voz como control y silencio de 0,35 s justo antes del momento de más energía. | Solo si hay pistas. No se incluye ninguna. |
| **Sonido final** | Cada clip se normaliza a −16 LUFS. | Siempre, salvo prototipo. |
| **Hablante activo** | `pipeline/active_speaker.py` (solo OpenCV) mide el movimiento de la boca de cada persona y `pipeline/asd.mjs` lo cruza con la voz: si el encuadre es una charla de dos personas (`split` o `fill`) y `fill` está permitido, corta limpio (`cutBefore`) a quien habla. Con más de un 45 % de solape conserva la pantalla dividida. | Con cámara fija y dos personas visibles. Un fallo del análisis deja el encuadre como estaba. |
| **Picos de chat** | Para vídeos de YouTube que fueron directo, `yt-dlp` baja el chat y `pipeline/chat_peaks.py` anota `chatSpike` (1-10, ventanas de 10 s) en cada segmento. El motor lo recibe junto a `energy` y en el resumen sube el valor de un pasaje. | Solo YouTube con chat grabado. Con menos de 30 mensajes no se anota nada. |
| **Auditoría** | Al terminar cada clip se comprueban la sonoridad (−17 a −13,5 LUFS), la pista de audio, que los fotogramas de 0,5 s, mitad y final no sean negros y que los subtítulos no invadan la zona de botones. Se guarda en `clip.audit` (`ok`, `issues`, `lufs`, `frames`). | Siempre, salvo prototipo. |

**Prompts y esquema.** El motor apunta a 18 a 32 s en entretenimiento y gaming (30 a 45 s solo para historias con giro) y devuelve, de forma opcional, `peakSegmentId`, `hasColdOpenHook`, `highlightWords` y `loopScore`. La revisión final penaliza los cierres con despedida o silencio y prefiere los que enlazan con el inicio. Un motor que no devuelva esos campos sigue funcionando igual.

**Pendiente de ese playbook:** J-cuts y L-cuts, pausa congelada antes del clímax en gameplay, enlace de música entre final e inicio, picos de chat de Twitch y un detector de hablante activo con modelo (TalkNet). El actual se basa en el movimiento de la boca y funciona con cámara fija.

## Marcas, carpeta de vídeos y gestor de disco

**Perfiles de marca** (`.corte-data/brands.json`, se crea solo con una marca genérica). Cada marca define nombre, `@handle`, logo PNG, posición de la marca de agua, estilo de subtítulos, color de acento, tono SEO (`seoVoice`), hashtags por defecto, canal de YouTube enlazado y música de fondo. El handle y el tono salen de la marca del proyecto en el render y en el SEO: no hay ninguna marca fija en el código. Un archivo ausente o dañado equivale a la marca genérica, sin marca de agua.

| Endpoint | Qué hace |
|---|---|
| `GET /api/brands` | Lista las marcas y la predeterminada. |
| `POST /api/brands` | Crea o edita una marca (cuerpo `{ brand: {...}, makeDefault? }`). Una edición parcial conserva el resto de campos. |
| `DELETE /api/brands/:id` | Borra una marca. No se puede borrar la única. |
| `POST /api/brands/:id/logo` | Sube un logo PNG (máx. 1 MB, `Content-Type: image/png`). |
| `POST /api/jobs` | Acepta `brandId` (si no existe, usa la predeterminada). Se guarda en `job.brandId`. |

**Gestor de disco** (`pipeline/storage.mjs`).

| Endpoint | Qué hace |
|---|---|
| `GET /api/system/storage` | Tamaño por proyecto separado en fuente, clips, temporales y otros, más el espacio libre del disco. |
| `POST /api/system/storage/prune` | `{ olderThanDays = 14, keepClips = true }`. Con `keepClips` quita solo el vídeo fuente y los temporales de proyectos terminados o con error. Sin él, borra los proyectos completos. Nunca toca el trabajo activo. Un archivo con enlaces duros solo cuenta como liberado si no queda otro enlace. |
| `DELETE /api/jobs/:id?keepClips=true` | Borra un proyecto o, con `keepClips=true`, solo su fuente y temporales. Detiene antes el trabajo si es el activo. |
| `GET /api/health` | Comprobación de vida y trabajo activo. |

Las acciones que modifican datos exigen `Origin` local, validan los identificadores y limitan el tamaño del cuerpo.

**Carpeta de vídeos.** Cada proyecto terminado se copia, con enlaces duros cuando es posible, a `Descargas\Vídeos\<proyecto>\` con solo los MP4. Al arrancar el servidor se rellena con los proyectos existentes. Se cambia con `CORTE_EXPORT_DIR`. `POST /api/export` fuerza la sincronización.

**Python.** `pipeline/runtime.mjs` busca el intérprete en este orden: `CORTE_PYTHON`, `.venv/bin/python`, `.venv/Scripts/python.exe` y después `python3` y `python` (en Windows, `python` va antes). Lo valida ejecutándolo y guarda el resultado. Las fuentes empaquetadas irán en `pipeline/assets/fonts/`.

## Panel móvil de clips con enlace temporal

`scripts/clip-panel.mjs` crea una página pensada para el móvil con los mejores clips de un proyecto y la comparte con un túnel temporal. **No expone el estudio**: un servidor aparte sirve solo la página, las portadas y los MP4 bajo una ruta con un código aleatorio, y se apaga solo.

```powershell
node scripts/clip-panel.mjs build <proyecto|prefijo> --count 6
node scripts/clip-panel.mjs serve .corte-data/panels/<código> --ttl 90 --tunnel cloudflared
```

`build` re-renderiza los clips con el pipeline actual (efectos, zoom, censura, auditoría) y anota qué se aplicó a cada uno. `serve` acepta `--tunnel ngrok` (por defecto) o `--tunnel cloudflared`, que no necesita cuenta. Con una cuenta gratuita de ngrok solo hay un dominio: si ya tienes otro túnel de ngrok abierto, usa `cloudflared`. El campo `fx` de cada clip del proyecto guarda lo aplicado (`cutSeconds`, `coldOpen`, `punches`, `bleeps`, `sfx`...).

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
├── routes/                  # Rutas por dominio: marcas, sistema y disco
├── pipeline/
│   ├── active_speaker.py    # Movimiento de boca por persona (OpenCV)
│   ├── asd.mjs              # Decisión de hablante activo y cortes a su cara
│   ├── audio.mjs            # Censura, efectos, música con ducking y mezcla
│   ├── chat_peaks.py        # Picos de chat de directos de YouTube
│   ├── clipfx.mjs           # Cortes de silencio, cold open, punch-in y filtros de montaje
│   ├── brands.mjs           # Perfiles de marca (.corte-data/brands.json)
│   ├── export.mjs           # Copia de vídeos terminados a Descargas\Vídeos
│   ├── runtime.mjs          # Resolución multiplataforma de Python y fuentes
│   ├── storage.mjs          # Escaneo, purga y borrado de proyectos
│   ├── summary.mjs          # Modo Resumen: selección, presupuesto de tiempo, cortes, capítulos y tarjetas
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

## Novedades de Corte Studio v3 (Pro NLE & Escala)

- **Fase 03 en paralelo (`mapLimit`):** las ventanas de análisis y lotes de auditoría viral se ejecutan en paralelo (concurrencia 3 por defecto en Gemini/OpenRouter, configurable con `CORTE_AI_CONCURRENCY`, y 1 en local).
- **Cola FIFO persistente (`/api/queue`):** encola múltiples vídeos o directos sin bloqueos 409; al terminar un proyecto arranca automáticamente el siguiente.
- **Ingesta local (`POST /api/jobs/upload`):** arrastra archivos `.mp4`, `.mkv`, `.mov` o `.webm` (grabaciones de OBS o podcasts) directamente en la portada para entrar directo a Fase 02 (Whisper).
- **Inspector NLE y re-render individual (`PATCH/POST /api/jobs/:id/clips/:file/rerender`):** ajusta `trimStart`/`trimEnd`, `onScreenHook`, preset de subtítulos (`hormozi-pop`, `gaming-neon`, `editorial-clean`, `podcast-speaker`, `classic-karaoke`) y *jump cuts*, y re-renderiza solo ese clip en segundos.
- **Hablante activo compensado (`pipeline/active_speaker.py`):** descuenta el movimiento de frente/ojos al medir la boca para evitar falsos cortes al asentir o reír en silencio.
- **Interfaz Pro NLE (`dist/pro-studio.css` + `dist/pro-studio.js`):** estética grafito/obsidiana de estudio profesional, gestores visuales de **Marcas**, **Cola** y **Almacenamiento**, overlay de **Safe Zones** (Shorts / TikTok / Reels), **Modo Eco** y atajos de teclado (`Space`, `J/K/L`, `I/O`, `S`, `⌘/Ctrl+K`).
