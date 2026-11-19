import { randomUUID } from 'node:crypto';
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import youtube from '../dist/youtube.js';
import { RequestError } from './errors.mjs';
import { renameWithRetry } from './fsx.mjs';
import { brandTag, getBrand } from './brands.mjs';

const platforms = ['youtube', 'tiktok'];
const limits = { youtube: 1200, tiktok: 1000 };
const tagPattern = /^#?[\p{L}\p{N}_]{2,32}$/u;
const genericTags = new Set(['fyp', 'foryou', 'foryoupage', 'parati', 'viral', 'trending', 'shorts', 'tiktok']);

const publicationSystem = (brand) => `# Función
Eres director de SEO en vídeo vertical (YouTube Shorts + TikTok Search) y copywriter para ${brand.name}. Voz de la marca: ${brand.seoVoice}. Escribes como un creador humano con instinto algorítmico, nunca como una IA corporativa. Preparas el paquete completo de publicación y SEO de cada recorte usando exclusivamente lo que ocurre en él, el título del vídeo fuente y su contexto.

# Reglas anti-IA (OBLIGATORIAS)
- PROHIBIDO sonar a bot o blog: nada de "Descubre...", "La eterna duda...", "El debate de...", "La leyenda de...", "El origen de...", "La regla de oro...", "Prepárate para...", "Te sorprenderá", "Sin palabras" o "Dime que... sin decir que...".
- Escribe en español natural y directo, con verbos activos, nombres reales y datos concretos del clip. Máximo 1 emoji solo si suma ritmo.
- No hagas spoiler del remate si arruina ver el clip hasta el final.

# Paquete SEO y Retención (NIVEL PRO)
- query: consulta EXACTA con mayor volumen de búsqueda real que escribiría un usuario en YouTube Shorts o TikTok sobre este momento (4–7 palabras).
- seoKeywords: lista de 6 a 8 frases clave long-tail reales en español combinando entidad/juego/tema + acción del clip (para indexación total).
- seoScore: puntuación exigente de potencial de búsqueda y descubrimiento (70 a 99) evaluando claridad de entidad, gancho y búsqueda.
- hook: frase gancho magnética de 1 línea para retener en los primeros 2 segundos sin spoiler del remate.
- coverText: texto ultra corto de portada/miniatura (2 a 4 palabras en MAYÚSCULAS, máx. 26 caracteres, ej: "FINAL IMPOSIBLE", "30.000€ EN JUEGO").
- pinnedComment: primer comentario listo para fijar en el vídeo que provoque respuestas, debate o menciones de amigos.

# YouTube Shorts
- youtubeTitle: título de alto CTR (42–68 caracteres, máx. 85) colocando la palabra clave principal y el conflicto en los primeros 42 caracteres. Usa si aporta 1 emoji expresivo.
- youtubeText: descripción estructurada en 2 frases cortas naturales integrando de forma orgánica 2–3 keywords de búsqueda y llamada sutil a comentar.
- youtubeHashtags: hasta 4 hashtags específicos de alto alcance del tema/nicho (nunca genéricos como #viral o #parati).

# TikTok
- tiktokText: primera línea gancho directa al grano (<= 95 caracteres) + segunda línea con pregunta corta para comentarios.
- tiktokHashtags: hasta 5 hashtags específicos de nicho y formato.

# Si el vídeo es Gameplay / Videojuegos (MUY IMPORTANTE)
- Identifica el juego exacto en el campo \`game\` (ej: "GTA 6", "EA FC 27", "Minecraft", "Fortnite", "Valorant", "Arc Raiders"; o "" si no es un videojuego). Usa título, transcripción, layout y fotogramas (HUD, minimapa, armas, personajes) para reconocerlo con total precisión.
- Cuando sea gameplay o trate sobre un videojuego concreto:
  1. Incluye el nombre del juego (o acrónimo buscado como "GTA 6") dentro de \`youtubeTitle\` y \`query\`.
  2. En \`youtubeText\`, explica en una frase natural qué ocurre en ese juego/mecánica/modo concreto (p. ej. mundo abierto, armas, físicas, personajes, mapa) integrando palabras clave del juego.
  3. En \`seoKeywords\`, añade al menos 3–4 búsquedas específicas con el nombre del juego (ej: "gta 6 gameplay español", "gta 6 detalles mundo abierto").
  4. En \`youtubeHashtags\` y \`tiktokHashtags\`, coloca **primero** los hashtags oficiales y más buscados de ese juego (ej: "#GTA6", "#GTAVI", "#Valorant", "#Minecraft", "#Fortnite", "#EAFC27") seguidos de "#Gameplay" o "#Gaming".

# Contrato
Si recibes fotogramas del clip junto a la transcripción, analiza lo que VES en pantalla (gestos, objetos, interfaces, juego, escena) para enriquecer título y keywords con máxima precisión. Devuelve una idea por ID de entrada. Textos, hashtags, keywords y títulos van en campos separados. El servidor añade los enlaces y #Shorts. Entrega únicamente el JSON del esquema.`;

const textField = { type: 'string' };
const tagList = { type: 'array', items: textField };

function suggestionSchema(ids) {
  const properties = {
    id: { type: 'integer', minimum: 1, maximum: ids.length },
    game: textField,
    query: textField,
    seoKeywords: tagList,
    seoScore: { type: 'integer', minimum: 1, maximum: 100 },
    hook: textField,
    coverText: textField,
    pinnedComment: textField,
    youtubeTitle: textField,
    youtubeText: textField,
    youtubeHashtags: tagList,
    tiktokText: textField,
    tiktokHashtags: tagList,
  };
  return {
    type: 'object', properties: {
      ideas: { type: 'array', items: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } },
    }, required: ['ideas'], additionalProperties: false,
  };
}

function text(value, max) {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '';
}

function hashtags(values, max, generated = false) {
  const tags = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().normalize('NFC').replace(/^#/, '');
    const key = tag.toLowerCase();
    if (tagPattern.test(tag) && (!generated || !genericTags.has(key)) && !tags.has(key)) tags.set(key, `#${tag}`);
    if (tags.size === max) break;
  }
  return [...tags.values()];
}

function generatedText(value, max) {
  return text(value, max).replace(/https?:\/\/\S+|#[\p{L}\p{N}_]+/giu, '').trim();
}

function cleanKeywords(values, max = 8) {
  const seen = new Set();
  const out = [];
  for (const val of Array.isArray(values) ? values : []) {
    if (typeof val !== 'string') continue;
    const item = generatedText(val, 60).toLowerCase();
    if (item.length >= 3 && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
    if (out.length === max) break;
  }
  return out;
}

const GAME_SIGNATURES = [
  { pattern: /\b(gta\s*(6|vi)|grand\s*theft\s*auto\s*(6|vi)|leonida)\b/i, name: 'GTA 6', hashtags: ['#GTA6', '#GTAVI', '#GrandTheftAutoVI', '#Gameplay'], keywords: ['gta 6 gameplay español', 'gta 6 mundo abierto', 'gta vi detalles'] },
  { pattern: /\b(gta\s*(5|v)|grand\s*theft\s*auto\s*(5|v)|gta\s*online)\b/i, name: 'GTA V', hashtags: ['#GTAV', '#GTA5', '#GTAOnline', '#Gameplay'], keywords: ['gta 5 gameplay español', 'gta v clips'] },
  { pattern: /\b(ea\s*fc\s*2[4-9]|fc\s*2[4-9]|fut\s*champions|ultimate\s*team|fifa)\b/i, name: 'EA FC', hashtags: ['#EAFC', '#FIFA', '#UltimateTeam', '#Gaming'], keywords: ['ea fc gameplay español', 'fut champions'] },
  { pattern: /\bminecraft\b/i, name: 'Minecraft', hashtags: ['#Minecraft', '#MinecraftEspañol', '#Gameplay', '#Gaming'], keywords: ['minecraft gameplay español', 'minecraft clips'] },
  { pattern: /\bfortnite\b/i, name: 'Fortnite', hashtags: ['#Fortnite', '#FortniteClips', '#Gameplay', '#Gaming'], keywords: ['fortnite gameplay español', 'fortnite mejores jugadas'] },
  { pattern: /\bvalorant\b/i, name: 'Valorant', hashtags: ['#Valorant', '#ValorantClips', '#Gameplay', '#Gaming'], keywords: ['valorant gameplay español', 'valorant jugadas'] },
  { pattern: /\bleague\s*of\s*legends|\blol\b/i, name: 'League of Legends', hashtags: ['#LeagueOfLegends', '#LoL', '#Gameplay', '#Gaming'], keywords: ['league of legends español', 'lol clips'] },
  { pattern: /\b(warzone|call\s*of\s*duty|black\s*ops|modern\s*warfare)\b/i, name: 'Call of Duty', hashtags: ['#CallOfDuty', '#Warzone', '#Gameplay', '#Gaming'], keywords: ['call of duty warzone español', 'warzone clips'] },
  { pattern: /\b(cs2|counter[\s-]*strike)\b/i, name: 'CS2', hashtags: ['#CS2', '#CounterStrike2', '#Gameplay', '#Gaming'], keywords: ['cs2 gameplay español', 'counter strike 2 clips'] },
  { pattern: /\bred\s*dead\b/i, name: 'Red Dead Redemption 2', hashtags: ['#RDR2', '#RedDeadRedemption2', '#Gameplay', '#Gaming'], keywords: ['red dead redemption 2 detalles', 'rdr2 gameplay español'] },
  { pattern: /\b(tarkov|escape\s*from\s*tarkov)\b/i, name: 'Escape from Tarkov', hashtags: ['#EscapeFromTarkov', '#Tarkov', '#Gameplay', '#Gaming'], keywords: ['escape from tarkov español', 'tarkov clips'] },
  { pattern: /\belden\s*ring\b/i, name: 'Elden Ring', hashtags: ['#EldenRing', '#Souls', '#Gameplay', '#Gaming'], keywords: ['elden ring gameplay español', 'elden ring clips'] },
  { pattern: /\broblox\b/i, name: 'Roblox', hashtags: ['#Roblox', '#RobloxEspañol', '#Gameplay', '#Gaming'], keywords: ['roblox español', 'roblox clips'] },
  { pattern: /\bcyberpunk\b/i, name: 'Cyberpunk 2077', hashtags: ['#Cyberpunk2077', '#Gameplay', '#Gaming'], keywords: ['cyberpunk 2077 gameplay', 'cyberpunk 2077 detalles'] },
];

export function inferGameContext(sourceTitle = '', clip = {}, spoken = '', modelGame = '') {
  const haystack = `${modelGame} ${sourceTitle} ${clip.title || ''} ${clip.onScreenHook || ''} ${spoken.slice(0, 600)}`;
  for (const sig of GAME_SIGNATURES) {
    if (sig.pattern.test(haystack)) return sig;
  }
  const cleanGame = text(modelGame, 48).replace(/[#@]/g, '').trim();
  if (cleanGame.length >= 2) {
    const compact = cleanGame.replace(/[^\p{L}\p{N}]/gu, '');
    const gameTag = compact.length >= 2 ? `#${compact}` : '#Gameplay';
    const lower = cleanGame.toLowerCase();
    return {
      name: cleanGame,
      hashtags: [gameTag, '#Gameplay', '#Gaming'],
      keywords: [`${lower} gameplay español`, `${lower} clips`],
    };
  }
  if (clip.framing?.layout === 'gameplay' || /^gameplay$/i.test(clip.category || '')) {
    return { name: '', hashtags: ['#Gameplay', '#Gaming'], keywords: ['gameplay español', 'mejores clips gaming'] };
  }
  return null;
}

function normalizeSuggestion(idea, gameContext = null) {
  const game = text(idea.game || gameContext?.name || '', 48);
  const query = generatedText(idea.query, 100);
  const hook = generatedText(idea.hook, 120);
  const seoKeywords = cleanKeywords([...(Array.isArray(idea.seoKeywords) ? idea.seoKeywords : []), ...(gameContext?.keywords ?? [])], 8);
  const coverText = generatedText(idea.coverText, 40).toUpperCase();
  const pinnedComment = generatedText(idea.pinnedComment, 240);
  const seoScore = Number.isFinite(idea.seoScore) ? Math.max(1, Math.min(100, Math.round(idea.seoScore))) : undefined;
  const ytTagSeeds = [...(gameContext?.hashtags ?? []), ...(Array.isArray(idea.youtubeHashtags) ? idea.youtubeHashtags : [])];
  const ttTagSeeds = [...(gameContext?.hashtags ?? []), ...(Array.isArray(idea.tiktokHashtags) ? idea.tiktokHashtags : [])];
  const youtube = { title: generatedText(idea.youtubeTitle, 100), text: generatedText(idea.youtubeText, 500), hashtags: hashtags(ytTagSeeds, 5, true) };
  const tiktok = { text: generatedText(idea.tiktokText, 350), hashtags: hashtags(ttTagSeeds, 5, true) };
  if (!query || !hook || !youtube.title || !youtube.text || !tiktok.text || !youtube.hashtags.length || !tiktok.hashtags.length) return null;
  return {
    ...(game ? { game } : {}),
    query,
    hook,
    ...(seoKeywords.length ? { seoKeywords } : {}),
    ...(coverText ? { coverText } : {}),
    ...(pinnedComment ? { pinnedComment } : {}),
    ...(seoScore !== undefined ? { seoScore } : {}),
    platforms: { youtube, tiktok },
  };
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeJson(path, value) {
  const staging = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(staging, JSON.stringify(value, null, 2), 'utf8');
    await renameWithRetry(staging, path);
  } finally {
    await rm(staging, { force: true }).catch(() => {});
  }
}

function buildFallbackSeo(sourceTitle, clip, spoken, brand) {
  const cleanTitle = text(clip.title || 'Momento destacado', 72);
  const hook = text(clip.onScreenHook || cleanTitle, 110);
  const gameCtx = inferGameContext(sourceTitle, clip, spoken);
  const topicWords = `${sourceTitle} ${cleanTitle}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !genericTags.has(w))
    .slice(0, 6);
  const brandTags = [...brand.defaultHashtags.map((tag) => tag.replace(/^#/, '')), ...(brand.handle ? [brandTag(brand)] : [])];
  const tagSeeds = [...new Set([...(gameCtx?.hashtags ?? []), ...topicWords, ...brandTags])].slice(0, 5);
  const gameTitleSuffix = gameCtx?.name && !cleanTitle.toLowerCase().includes(gameCtx.name.toLowerCase())
    ? ` en ${gameCtx.name}`
    : '';
  const youtubeTitle = `${text(`${cleanTitle}${gameTitleSuffix}`, 90)} #Shorts`;
  const contextLine = gameCtx?.name ? `Gameplay de ${gameCtx.name}: ` : '';
  return normalizeSuggestion({
    game: gameCtx?.name || '',
    query: text(`${gameCtx?.name || ''} ${topicWords.slice(0, 4).join(' ')} ${cleanTitle}`.trim(), 90) || cleanTitle,
    hook,
    seoKeywords: [...(gameCtx?.keywords ?? []), cleanTitle.toLowerCase(), ...topicWords.slice(0, 5)],
    coverText: text((clip.onScreenHook || cleanTitle).split(/\s+/).slice(0, 3).join(' '), 28).toUpperCase(),
    pinnedComment: gameCtx?.name
      ? `¿Qué te parece esto que pasó jugando a ${gameCtx.name}? 👇`
      : `¿Qué os parece este momento de ${text(sourceTitle, 40)}? 👇`,
    seoScore: gameCtx?.name ? 84 : 76,
    youtubeTitle,
    youtubeText: `${contextLine}${hook}. ${text(spoken || sourceTitle, 220)}`,
    youtubeHashtags: tagSeeds,
    tiktokText: `${hook} ¿Tú qué harías${gameCtx?.name ? ` en ${gameCtx.name}` : ''}?`,
    tiktokHashtags: [...tagSeeds, 'gaming'].slice(0, 5),
  }, gameCtx);
}

async function loadClipFrameParts(directory, clipNumber, maxImages = 3) {
  const candidates = [];
  const frameDir = join(directory, 'frames');
  const subNames = (await readdir(frameDir).catch(() => []))
    .filter((name) => new RegExp(`^clip-${clipNumber}-f\\d+\\.jpg$`, 'i').test(name))
    .sort((a, b) => Number(a.match(/-f(\d+)/)?.[1] ?? 0) - Number(b.match(/-f(\d+)/)?.[1] ?? 0));
  for (const name of subNames) candidates.push(join(frameDir, name));
  if (!candidates.length) {
    const rootNames = (await readdir(directory).catch(() => []))
      .filter((name) => new RegExp(`^frame-${clipNumber}-\\d+\\.jpg$`, 'i').test(name))
      .sort((a, b) => Number(a.match(/-(\d+)\.jpg$/)?.[1] ?? 0) - Number(b.match(/-(\d+)\.jpg$/)?.[1] ?? 0));
    for (const name of rootNames) candidates.push(join(directory, name));
  }
  if (!candidates.length) return [];
  const chosen = candidates.length <= maxImages
    ? candidates
    : [candidates[0], candidates[Math.floor(candidates.length / 2)], candidates[candidates.length - 1]];
  const parts = [];
  for (const fullPath of [...new Set(chosen)]) {
    const data = await readFile(fullPath).catch(() => null);
    if (data) parts.push({ inline_data: { mime_type: 'image/jpeg', data: data.toString('base64') } });
  }
  return parts;
}

/**
 * Analyze a single rendered clip one-by-one (spoken transcript + extracted JPEG
 * frames when available) to author and save pro search-optimized SEO metadata.
 */
export async function analyzeAndSaveClipSeo(infer, directory, sourceTitle, transcript, clip, clipNumber, { force = false, signal, brand: brandInput } = {}) {
  const brand = brandInput ?? await getBrand();
  const path = join(directory, 'publication-suggestions.json');
  const saved = (await readJson(path)) ?? {};
  // Un vídeo largo (resumen) no usa el SEO de Shorts: su título y descripción se guardan en el borrador de YouTube.
  if (clip.longForm) return saved[clip.file] ?? null;
  if (!force && saved[clip.file]?.seoKeywords?.length >= 4 && saved[clip.file]?.coverText) {
    return saved[clip.file];
  }
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const spoken = segments
    .filter((segment) => segment.start < clip.end && segment.end > clip.start)
    .map(({ text: line }) => line)
    .join(' ')
    .slice(0, 2400);

  const preGameCtx = inferGameContext(sourceTitle, clip, spoken);
  const payload = {
    id: 1,
    title: clip.title,
    isGameplay: clip.framing?.layout === 'gameplay' || Boolean(preGameCtx?.name),
    ...(preGameCtx?.name ? { detectedGame: preGameCtx.name } : {}),
    ...(clip.onScreenHook ? { onScreenHook: clip.onScreenHook } : {}),
    ...(clip.category ? { category: clip.category } : {}),
    ...(clip.reason ? { reason: clip.reason.slice(0, 240) } : {}),
    ...(clip.framing?.layout ? { layout: clip.framing.layout } : {}),
    duration: Math.round(clip.end - clip.start),
    spoken,
  };
  let suggestion = null;
  if (typeof infer === 'function') {
    const frameNumber = Number(/^clip-(\d+)\.mp4$/.exec(clip.file)?.[1]) || clipNumber;
    const frameParts = await loadClipFrameParts(directory, frameNumber, 3);
    const requestBase = {
      system: publicationSystem(brand),
      schema: suggestionSchema([1]),
      maxOutputTokens: 2200,
    };
    const contextText = JSON.stringify({ sourceTitle, language: transcript?.language || 'es', clips: [payload] });
    const tryInfer = async (parts) => {
      const res = await infer({ ...requestBase, parts, signal });
      const idea = Array.isArray(res?.ideas) ? res.ideas[0] : null;
      if (!idea) return null;
      const mergedGameCtx = inferGameContext(sourceTitle, clip, spoken, idea.game);
      return normalizeSuggestion(idea, mergedGameCtx);
    };
    try {
      suggestion = await tryInfer([{ text: contextText }, ...frameParts]);
    } catch (error) {
      if (error?.code === 'CANCELLED') throw error;
      if (frameParts.length) {
        try {
          suggestion = await tryInfer([{ text: contextText }]);
        } catch (fallbackErr) {
          if (fallbackErr?.code === 'CANCELLED') throw fallbackErr;
        }
      }
    }
  }
  suggestion ??= buildFallbackSeo(sourceTitle, clip, spoken, brand);
  if (suggestion) {
    saved[clip.file] = suggestion;
    await writeJson(path, saved);
  }
  return suggestion;
}

export async function generatePublicationSuggestions(infer, directory, sourceTitle, transcript, clips, { force = false, signal, onProgress, brand } = {}) {
  let completed = 0;
  for (const [index, clip] of clips.entries()) {
    onProgress?.({ index: index + 1, total: clips.length, clip });
    const suggestion = await analyzeAndSaveClipSeo(infer, directory, sourceTitle, transcript, clip, index + 1, { force, signal, brand });
    if (suggestion) completed++;
  }
  return completed;
}

function draftPath(directory, clip, platform) {
  return join(directory, `${clip.file.slice(0, -4)}-${platform}-draft.json`);
}

export async function loadPublication(directory, job, clip) {
  const suggestions = await readJson(join(directory, 'publication-suggestions.json'));
  const suggestion = suggestions?.[clip.file];
  const drafts = await Promise.all(platforms.map(async (platform) => {
    const saved = await readJson(draftPath(directory, clip, platform));
    const proposed = suggestion?.platforms[platform] ?? {
      ...(platform === 'youtube' ? { title: text(clip.title, 100) } : {}), text: clip.title, hashtags: [],
    };
    return [platform, saved ?? { ...proposed, status: 'suggested' }];
  }));
  const seconds = Math.max(0, Math.floor(clip.start));
  const resolvedSource = youtube.sourceFromJob(job);
  const brand = await getBrand(job.brandId);
  const sourceUrl = resolvedSource.platform === 'twitch'
    ? (resolvedSource.kind === 'clip' ? resolvedSource.url : `${resolvedSource.url}?t=${seconds}s`)
    : `https://www.youtube.com/watch?v=${encodeURIComponent(job.videoId)}&t=${seconds}s`;
  return {
    clip: { title: clip.title, file: clip.file, start: clip.start, end: clip.end, ratio: clip.ratio ?? '9:16', longForm: Boolean(clip.longForm), duration: clip.duration ?? null, url: `/media/${job.id}/${clip.file}` },
    source: { title: job.title, videoId: job.videoId, platform: resolvedSource.platform, url: sourceUrl },
    publisher: { brandId: brand.id, name: brand.name, handle: brand.handle, url: brand.handle ? `https://www.youtube.com/${brand.handle}` : '' },
    query: suggestion?.query ?? '',
    hook: suggestion?.hook ?? '',
    game: suggestion?.game ?? '',
    seoKeywords: suggestion?.seoKeywords ?? [],
    coverText: suggestion?.coverText ?? '',
    pinnedComment: suggestion?.pinnedComment ?? '',
    seoScore: suggestion?.seoScore ?? null,
    platforms: Object.fromEntries(drafts),
  };
}

/**
 * Persist an AI-agent-authored SEO & social copy suggestion for a rendered clip
 * using the same normalization schema as automatic publication generation.
 */
export async function saveAgentSeoSuggestion(directory, clipFile, idea, context = {}) {
  const gameContext = inferGameContext(context.sourceTitle || '', context.clip || {}, context.spoken || '', idea?.game || '');
  const suggestion = normalizeSuggestion(idea ?? {}, gameContext);
  if (!suggestion) {
    throw new RequestError(400, 'SEO inválido: se requieren query, hook, youtubeTitle, youtubeText, tiktokText y hashtags.');
  }
  const path = join(directory, 'publication-suggestions.json');
  const saved = (await readJson(path)) ?? {};
  saved[clipFile] = suggestion;
  await writeJson(path, saved);
  return suggestion;
}

export async function savePublicationDraft(directory, clip, body) {
  const { platform } = body;
  if (!platforms.includes(platform)) throw new RequestError(400, 'Elige una plataforma de publicación.');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.text === 'string' ? body.text.trim() : '';
  if ((platform === 'youtube' && (!title || title.length > 100)) || !description || description.length > limits[platform]) {
    throw new RequestError(400, 'Revisa los campos de texto y su longitud.');
  }
  const draft = {
    ...(platform === 'youtube' ? { title } : {}), text: description,
    hashtags: hashtags(body.hashtags, 5), status: 'draft', updatedAt: new Date().toISOString(),
  };
  await writeJson(draftPath(directory, clip, platform), draft);
  return draft;
}
