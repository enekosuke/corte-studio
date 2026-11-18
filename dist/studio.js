const byId = (id) => document.getElementById(id);

function time(seconds) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
  const remainder = String(whole % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

if (byId('demo-editor')) {
const transcriptList = byId('transcript-list');
const search = byId('transcript-search');
const clipList = byId('clip-list');
const frameList = byId('frames');
const portrait = byId('portrait');
const caption = byId('caption');
const captions = byId('captions');
const seek = byId('seek');
const play = byId('play');
const crop = byId('crop');

let clip = demo.clips[0];
let position = 0;
let playing = null;
let frameTimes = [];
let lastCaption = '';
let activeSegment = null;
let frameButtons = [];

const frameStyles = [
  { x: 52, y: 46, scale: 101 },
  { x: 42, y: 40, scale: 125 },
  { x: 68, y: 45, scale: 144 },
  { x: 60, y: 51, scale: 115 },
];

function normalized(text) {
  return text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function renderTranscript() {
  const query = normalized(search.value);
  const segments = demo.transcript.filter((segment) => normalized(segment.text).includes(query));
  const metadata = query ? `${segments.length} de ${demo.transcript.length} segmentos` : `${demo.transcript.length} segmentos`;
  byId('transcript-meta').textContent = `${metadata} · ${time(demo.duration)}`;
  transcriptList.replaceChildren(...segments.map(({ start, end, text }) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'segment';
    row.classList.toggle('in-clip', start < clip.end && end > clip.start);
    row.dataset.start = start;
    row.setAttribute('aria-label', `${time(start)} a ${time(end)}. ${text}`);
    const stamp = document.createElement('span');
    stamp.className = 'segment-time';
    stamp.textContent = time(start);
    const line = document.createElement('span');
    line.textContent = text;
    row.append(stamp, line);
    return row;
  }));
  if (!segments.length) transcriptList.innerHTML = '<p class="empty">No hay coincidencias.</p>';
  activeSegment = null;
}

function renderClips() {
  clipList.replaceChildren(...demo.clips.map(({ id, title, start, end, crop: thumb }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'clip-button';
    button.dataset.clip = id;
    button.setAttribute('aria-pressed', String(clip.id === id));
    button.innerHTML = `
      <span class="clip-image"><span class="clip-duration"></span></span>
      <span class="clip-copy"><strong></strong><span class="clip-range"></span></span>
      <svg class="clip-arrow" aria-hidden="true"><use href="#i-chevron"/></svg>
    `;
    button.querySelector('.clip-image').style.setProperty('--thumb-position', `${thumb}%`);
    button.querySelector('.clip-duration').textContent = `${end - start} s`;
    button.querySelector('.clip-copy strong').textContent = title;
    button.querySelector('.clip-range').textContent = `${time(start)}–${time(end)}`;
    return button;
  }));
  byId('clip-count').textContent = `${demo.clips.length} sugeridos`;
  byId('nav-count').textContent = demo.clips.length;
}

function renderFrames() {
  const duration = clip.end - clip.start;
  frameTimes = frameStyles.map((_, index) => Math.floor(index * duration / frameStyles.length));
  frameList.innerHTML = frameTimes.map((offset, index) => {
    const { x, y, scale } = frameStyles[index];
    const stamp = time(clip.start + offset);
    return `<button type="button" class="frame-button" data-offset="${offset}" aria-label="Fotograma en ${stamp} del vídeo de origen" aria-pressed="false" style="--frame-x:${x}%;--frame-y:${y}%;--frame-size:${scale}%"><span class="frame-time">${stamp}</span></button>`;
  }).join('');
  frameButtons = [...frameList.querySelectorAll('button')];
  byId('frame-count').textContent = `${frameTimes.length} muestras`;
}

function renderCaption(segment, timestamp) {
  const chunks = (segment?.text.split(/(?<=[.!?])\s+/) ?? []).flatMap((sentence) => {
    const words = sentence.split(' ');
    return Array.from({ length: Math.ceil(words.length / 5) }, (_, index) => words.slice(index * 5, index * 5 + 5));
  });
  const elapsed = segment ? (timestamp - segment.start) / (segment.end - segment.start) : 0;
  const phrase = [...(chunks[Math.floor(elapsed * chunks.length)] ?? [])];
  const text = phrase.join(' ');
  if (text === lastCaption) return;
  lastCaption = text;
  const emphasis = document.createElement('strong');
  emphasis.textContent = phrase.pop() ?? '';
  caption.replaceChildren(`${phrase.join(' ')} `, emphasis);
}

function updatePosition(value) {
  const duration = clip.end - clip.start;
  position = Math.max(0, Math.min(value, duration));
  seek.value = position;
  byId('play-time').textContent = time(position);
  seek.setAttribute('aria-valuetext', `${time(position)} de ${time(duration)}`);

  // Keep the final subtitle visible when playback reaches the end of the clip.
  const timestamp = clip.start + Math.min(position, duration - 0.001);
  const segment = demo.transcript.find(({ start, end }) => timestamp >= start && timestamp < end);
  const row = transcriptList.querySelector(`[data-start="${segment?.start}"]`);
  if (activeSegment !== row) {
    activeSegment?.removeAttribute('aria-current');
    row?.setAttribute('aria-current', 'true');
    activeSegment = row;
  }

  const frameIndex = frameTimes.findLastIndex((offset) => position >= offset);
  frameButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(frameIndex === index)));
  renderCaption(segment, timestamp);
}

function setCrop(value) {
  crop.value = value;
  crop.setAttribute('aria-valuetext', `${value} %`);
  portrait.style.setProperty('--crop', `${value}%`);
}

function setPlaying(enabled) {
  if (playing !== null) {
    window.clearInterval(playing);
    playing = null;
  }
  play.setAttribute('aria-label', enabled ? 'Pausar vista previa' : 'Reproducir vista previa');
  play.querySelector('use').setAttribute('href', enabled ? '#i-pause' : '#i-play');
  if (!enabled) return;

  const duration = clip.end - clip.start;
  if (position >= duration) updatePosition(0);
  let lastTick = performance.now();
  playing = window.setInterval(() => {
    const now = performance.now();
    updatePosition(position + (now - lastTick) / 1000);
    lastTick = now;
    if (position >= duration) setPlaying(false);
  }, 100);
}

function selectClip(nextClip, offset = 0) {
  setPlaying(false);
  clip = nextClip;
  const duration = clip.end - clip.start;
  byId('preview-meta').textContent = `${time(clip.start)}–${time(clip.end)} · ${duration} s`;
  byId('play-duration').textContent = time(duration);
  seek.max = duration;
  setCrop(clip.crop);
  clipList.querySelectorAll('[data-clip]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.clip === clip.id));
  });
  renderFrames();
  renderTranscript();
  updatePosition(offset);
}

search.addEventListener('input', () => {
  renderTranscript();
  transcriptList.scrollTop = 0;
  updatePosition(position);
});

transcriptList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-start]');
  if (!row) return;
  const start = Number(row.dataset.start);
  if (start >= clip.start && start < clip.end) {
    setPlaying(false);
    updatePosition(start - clip.start);
    return;
  }
  const candidate = demo.clips.find((item) => start >= item.start && start < item.end);
  const segment = demo.transcript.find((item) => item.start === start);
  selectClip(candidate ?? { id: null, start, end: segment.end, crop: 50 }, candidate ? start - candidate.start : 0);
  activeSegment?.focus({ preventScroll: true });
});

clipList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-clip]');
  if (!button) return;
  selectClip(demo.clips.find((item) => item.id === button.dataset.clip));
  if (activeSegment) transcriptList.scrollTop = activeSegment.offsetTop - 8;
  byId('vista-previa').scrollIntoView({ block: 'nearest' });
});

frameList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-offset]');
  if (!button) return;
  setPlaying(false);
  updatePosition(Number(button.dataset.offset));
});

seek.addEventListener('input', () => updatePosition(Number(seek.value)));
play.addEventListener('click', () => setPlaying(playing === null));
captions.addEventListener('change', () => { caption.hidden = !captions.checked; });
crop.addEventListener('input', () => setCrop(crop.value));
byId('reset-crop').addEventListener('click', () => setCrop(50));

function updateNavigation() {
  const current = window.location.hash || '#estudio';
  document.querySelectorAll('.nav a').forEach((link) => {
    if (link.hash === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

window.addEventListener('hashchange', updateNavigation);
updateNavigation();
renderClips();
selectClip(clip);
}
