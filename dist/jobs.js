(() => {
  const serverAvailable = location.protocol === 'http:' || location.protocol === 'https:';
  const form = byId('source-form');
  const urlInput = byId('source-url');
  const note = byId('source-note');
  const continueButton = byId('continue-source');
  const cancelSourceButton = byId('cancel-source');
  const cancelJobButton = byId('cancel-job');
  const resumeJobBtn = byId('resume-job');
  const searchMoreBtn = byId('search-more-clips');
  const resumeJobLabel = byId('resume-job-label');
  const engineInput = byId('source-engine');
  const modelInput = byId('source-model');
  const voiceInput = byId('source-voice');
  const voiceField = byId('voice-model-field');
  const modeNormalBtn = byId('mode-normal-btn');
  const modePrototypeBtn = byId('mode-prototype-btn');
  const modeSummaryBtn = byId('mode-summary-btn');
  const summaryTargetField = byId('summary-target-field');
  const summaryTargetInput = byId('summary-target');
  const summaryCaptionsField = byId('summary-captions-field');
  const summaryCaptionsInput = byId('summary-captions');
  const sourceSubtitle = byId('source-subtitle');
  const jobModeBadge = byId('job-mode-badge');
  const formatMenu = byId('source-format');
  const formatInputs = [...formatMenu.querySelectorAll('input')];
  const layoutNames = { fill: 'Rellenar', fit: 'Ajustar', split: 'Dividir', three: 'Tres', four: 'Cuatro', shared: 'Compartir', gameplay: 'Gameplay' };

  const brandHomeBtn = byId('brand-home');
  const backToHomeBtn = byId('back-to-home');
  const activeJobBanner = byId('active-job-banner');
  const activeJobBannerText = byId('active-job-banner-text');

  const projectsDropdown = byId('projects-dropdown');
  const projectsBtn = byId('projects-dropdown-btn');
  const projectsMenu = byId('projects-dropdown-menu');
  const projectsFilter = byId('projects-filter');
  const projectsUrlCount = byId('projects-url-count');
  const historyList = byId('history-list');
  const historyStatus = byId('history-status');

  const viewEditor = byId('view-editor');
  const nleDeck = document.querySelector('.nle-deck');
  const spotlightPanel = byId('clip-spotlight');
  const closeSpotlightBtn = byId('close-clip-spotlight');
  const spotlightNum = byId('spotlight-num');
  const spotlightRatio = byId('spotlight-ratio');
  const spotlightScore = byId('spotlight-score');
  const spotlightCategory = byId('spotlight-category');
  const spotlightTimes = byId('spotlight-times');
  const spotlightTitle = byId('spotlight-title');
  const spotlightStage = byId('spotlight-stage');
  const spotlightVideo = byId('spotlight-video');
  const spotlightHook = byId('spotlight-hook');
  const spotlightReason = byId('spotlight-reason');
  const spotlightPubBtn = byId('spotlight-pub-btn');
  const spotlightMp4Btn = byId('spotlight-mp4-btn');
  const spotlightAssBtn = byId('spotlight-ass-btn');

  const jobUrlChip = byId('job-url-chip');
  const editorVersionWrap = byId('editor-version-wrap');
  const editorVersionSelect = byId('editor-version-select');
  const clipsStatus = byId('clips-status');
  const results = byId('job-clips');
  const transcriptDetails = byId('transcripcion-real');
  const transcriptList = byId('job-transcript');

  const projectMonitor = byId('project-monitor');
  const projectVideo = byId('project-source-video');
  const projectSpeedBadge = byId('project-speed-badge');
  const toggleSpeedButton = byId('toggle-monitor-speed');
  const projectTimecode = byId('project-timecode');
  const projectLoaderTitle = byId('project-loader-title');
  const projectLoaderSub = byId('project-loader-sub');
  const loaderElapsedEl = byId('loader-elapsed');
  const loaderCascadeCanvas = byId('loader-cascade-canvas');
  const loaderDataStream = byId('loader-data-stream');
  const dataPacketsTrack = byId('data-packets-track');
  const loaderSpeedMetric = byId('loader-speed-metric');
  const loaderPacketsMetric = byId('loader-packets-metric');
  const loaderPercentMetric = byId('loader-percent-metric');
  const loaderProgressFill = byId('loader-progress-fill');

  const timelineDock = byId('project-timeline-dock');
  const viralSearchScanner = byId('viral-search-scanner');
  const viralScannerTag = byId('viral-scanner-tag');
  const framingPopover = byId('framing-popover');
  const closeFramingPopoverBtn = byId('close-framing-popover');
  const popoverClipNum = byId('popover-clip-num');
  const popoverLayoutPill = byId('popover-layout-pill');
  const popoverStagePill = byId('popover-stage-pill');
  const popoverClipTitle = byId('popover-clip-title');
  const popoverMorphStage = byId('popover-morph-stage');
  const popoverVideo = byId('popover-source-video');
  const popoverMorphCanvas = byId('popover-morph-canvas');
  const popoverMorphPhase = byId('popover-morph-phase');
  const popoverCycleDots = byId('popover-cycle-dots');
  const popoverReason = byId('popover-reason');
  const waterDropTimerTrack = byId('water-drop-timer')?.parentElement;

  const timelineRulerEl = byId('timeline-ruler');
  const timelineTrackEl = byId('project-timeline');
  const waveformEl = byId('project-waveform');
  const voiceSegmentsEl = byId('project-voice-segments');
  const playheadEl = byId('timeline-playhead');
  const audioStatusEl = byId('audio-track-status');
  const audioMetaEl = byId('audio-track-meta');
  const audioDurationEl = byId('audio-track-duration');

  const publishDrawer = byId('auto-publish-drawer');
  const drawerClipList = byId('drawer-clip-list');
  const drawerClipCount = byId('drawer-clip-count');
  const drawerAutoNote = byId('drawer-auto-note');
  const publishAllButton = byId('publish-all-auto');
  const ytChannelPill = byId('yt-channel-pill');
  const connectChannelButton = byId('youtube-connect-channel');
  const publishIntervalSelect = byId('publish-interval');
  const publishReanalyzeCheck = byId('publish-reanalyze-seo');
  const toggleDrawerButton = byId('toggle-publish-drawer');
  const openDrawerButton = byId('open-publish-drawer');
  const closeDrawerButton = byId('close-publish-drawer');

  const historyDate = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });
  const engineStorage = 'corte-studio.engine';
  const formatStorage = 'corte-studio.format';
  const modeStorage = 'corte-studio.mode';
  const voiceStorage = 'corte-studio.voice';
  const baseNote = note.querySelector('span').textContent;
  const baseSubtitle = sourceSubtitle?.textContent || '';
  const stages = { downloading: 0, transcribing: 1, loading: 2, selecting: 2, framing: 3, rendering: 3, editorial: 4, done: 5 };
  const steps = [...byId('job-steps').children];

  let allJobs = [];
  let videoMode = 'normal';
  let currentView = 'home';
  let currentJob = null;
  let currentJobData = null;
  let currentStep = 0;
  let eventSource = null;
  let poll = null;
  let loaderTimer = null;
  let loaderStartedAt = 0;
  let submitting = false;
  let transcriptLoaded = false;
  let lastSegments = [];
  let loadedSourceJob = null;
  let materializedJob = null;
  let waveformRenderedJob = null;
  let waveBarEls = [];
  let renderedClipJobId = null;
  let revealJobId = null;
  let revealedClipCount = 0;
  let revealTimer = null;
  let renderedVoiceKey = '';
  let waveBuildTimer = null;
  let dataStreamTimer = null;
  let packetCount = 0;
  let cascadeRaf = null;
  let cascadeParticles = [];
  let cascadeSizeKey = '';
  let cascadeLastTime = 0;
  let viralHideTimer = null;
  let viralLockedUntil = 0;
  let spotlightIndex = null;
  let spotlightItem = null;
  const MORPH_CYCLE_MS = 2600;
  const MORPH_TOTAL_CYCLES = 3;
  const MORPH_TOTAL_MS = MORPH_CYCLE_MS * MORPH_TOTAL_CYCLES;
  let popoverItem = null;
  let popoverJobMeta = null;
  let popoverDismissedKey = '';
  let popoverRaf = null;
  let popoverAnimStart = 0;
  let lastMorphHudKey = '';
  let morphCanvasSize = '';
  const shownDropClips = new Set();
  const waterDropQueue = [];
  let waterDropActive = false;
  let waterDropHoldTimer = null;
  let waterDropCloseTimer = null;
  let waterDropNextTimer = null;
  const timelineBoxesMap = new Map();
  const clipCardElsMap = new Map();
  let drawerJobId = null;
  let drawerFiles = new Set();
  let drawerAutoOpenedFor = null;
  let pollingFailures = 0;
  let viewVersion = 0;
  let engines;
  let busy = false;
  let monitorSpeedMode = 'auto';
  let playheadRaf = null;

  // ---- Modo Resumen -------------------------------------------------------------------------
  const isSummary = (job) => job?.mode === 'summary';
  const summaryStepLabels = ['Importación', 'Whisper Audio', 'Selección de pasajes', 'Montaje y tarjetas', 'Publicación'];
  let labelsMode = '';
  let renderedSummaryKey = '';
  let renderedChaptersKey = '';
  let summaryAutoOpened = null;

  function longClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor(total / 60) % 60;
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function applyModeLabels(job) {
    const mode = isSummary(job) ? 'summary' : 'normal';
    if (labelsMode === mode) return;
    labelsMode = mode;
    const summary = mode === 'summary';
    for (const step of steps) {
      const textNode = step.lastChild;
      if (!step.dataset.label) step.dataset.label = textNode.textContent;
    }
    steps.forEach((step, index) => { step.lastChild.textContent = summary ? summaryStepLabels[index] : step.dataset.label; });
    byId('track-clips-tag').lastChild.textContent = summary ? 'Resumen' : 'Cortes';
    byId('clips-title').textContent = summary ? 'Resumen del proyecto' : 'Clips del proyecto';
    byId('drawer-title').textContent = summary ? 'Publicar resumen' : 'Publicar clips';
    byId('publish-all-label').textContent = summary ? 'Subir el resumen a YouTube' : 'Publicar todos automático';
    byId('publish-interval-row').hidden = summary;
    byId('publish-reanalyze-row').hidden = summary;
    byId('spotlight-pub-btn').textContent = summary ? 'Título y descripción' : 'Preparar publicación';
    byId('open-publish-drawer').lastElementChild.textContent = summary ? 'Publicar' : 'Publicación';
  }

  function seekSummary(outStart, sourceStart) {
    const job = currentJobData;
    if (!job) return;
    const item = getProjectClipItems(job)[0];
    if (item?.rendered) {
      openClipSpotlight(job, item);
      const jump = () => {
        spotlightVideo.currentTime = outStart;
        spotlightVideo.play().catch(() => {});
      };
      if (spotlightVideo.readyState >= 1) jump();
      else spotlightVideo.addEventListener('loadedmetadata', jump, { once: true });
    } else if (projectMonitor.classList.contains('has-video') && Number.isFinite(sourceStart)) {
      projectVideo.currentTime = sourceStart;
      syncPlayhead();
    }
  }

  function updateChapterHighlight() {
    const info = currentJobData?.summary;
    if (!info?.chapters?.length || spotlightIndex === null) return;
    const now = spotlightVideo.currentTime;
    let current = 0;
    info.chapters.forEach((chapter, index) => { if (now >= chapter.outStart - 0.2) current = index; });
    byId('summary-chapters').querySelectorAll('li').forEach((li, index) => li.classList.toggle('is-current', index === current));
  }

  function renderSummaryTimeline(job, duration) {
    timelineDock.classList.add('is-summary');
    timelineDock.classList.toggle('summary-done', job.stage === 'done');
    const info = job.summary;
    if (!info?.parts?.length) return;
    const key = `${job.id}:${info.parts.length}:${Math.round(duration)}:${info.chapters?.length ?? 0}`;
    if (renderedSummaryKey === key) return;
    renderedSummaryKey = key;
    for (const old of voiceSegmentsEl.querySelectorAll('.keep-block, .chapter-flag')) old.remove();
    const frag = document.createDocumentFragment();
    info.parts.forEach(([start, end, card], index) => {
      const block = document.createElement('button');
      block.type = 'button';
      block.className = card ? 'keep-block has-card' : 'keep-block';
      block.style.left = `${Math.max(0, (start / duration) * 100).toFixed(3)}%`;
      block.style.width = `${Math.max(0.25, ((end - start) / duration) * 100).toFixed(3)}%`;
      block.style.setProperty('--i', String(Math.min(index, 60)));
      block.title = `Tramo ${index + 1} · ${longClock(start)}–${longClock(end)} (${Math.round(end - start)} s)${card ? ' · con tarjeta de contexto' : ''}`;
      block.addEventListener('click', (event) => {
        event.stopPropagation();
        if (projectMonitor.classList.contains('has-video')) {
          projectVideo.currentTime = start;
          syncPlayhead();
        }
      });
      frag.append(block);
    });
    (info.chapters ?? []).forEach((chapter, index) => {
      const flag = document.createElement('span');
      flag.className = 'chapter-flag';
      flag.style.left = `${Math.max(0, (chapter.sourceStart / duration) * 100).toFixed(3)}%`;
      flag.innerHTML = '<i></i><b></b>';
      flag.firstChild.textContent = String(index + 1);
      flag.lastChild.textContent = chapter.title;
      frag.append(flag);
    });
    voiceSegmentsEl.append(frag);
  }

  function renderSummaryPanel(job) {
    const panel = byId('summary-panel');
    const active = isSummary(job);
    panel.hidden = !active;
    if (!active) return;
    const info = job.summary;
    const finished = job.stage === 'done';
    panel.dataset.state = info ? (finished ? 'done' : 'building') : (job.stage === 'error' ? 'error' : 'planning');
    byId('summary-output').textContent = info ? longClock(info.outputSeconds) : '--:--';
    byId('summary-source-label').textContent = `de ${longClock(info?.sourceSeconds ?? job.duration)}`;
    const keep = info && info.sourceSeconds ? Math.round((info.outputSeconds / info.sourceSeconds) * 100) : null;
    byId('summary-keep').textContent = keep === null ? '' : `${keep} % del original`;
    byId('summary-bar-fill').style.width = keep === null ? '0%' : `${Math.max(2, keep)}%`;
    byId('summary-phase').textContent = job.message || '';
    const progress = job.summaryProgress;
    const progressEl = byId('summary-progress');
    progressEl.hidden = !(progress && progress.total && !finished);
    if (!progressEl.hidden) byId('summary-progress-fill').style.width = `${Math.round((progress.done / progress.total) * 100)}%`;

    const stats = info ? [
      [info.partCount, info.partCount === 1 ? 'tramo' : 'tramos'],
      [info.chapters?.length ?? 0, 'capítulos'],
      [info.cardCount ?? 0, 'tarjetas'],
      [info.beatCount, 'pasajes clave'],
    ].filter(([count]) => count > 0) : [];
    byId('summary-stats').replaceChildren(...stats.map(([count, label]) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = String(count);
      li.append(strong, ` ${label}`);
      return li;
    }));

    const chapters = info?.chapters ?? [];
    byId('summary-chapters-title').hidden = !chapters.length;
    const chaptersKey = `${job.id}:${chapters.map((chapter) => `${chapter.title}@${chapter.outStart}`).join('|')}`;
    if (renderedChaptersKey !== chaptersKey) {
      renderedChaptersKey = chaptersKey;
      byId('summary-chapters').replaceChildren(...chapters.map((chapter, index) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const stamp = document.createElement('time');
        stamp.textContent = longClock(chapter.outStart);
        const label = document.createElement('span');
        label.textContent = chapter.title;
        button.append(stamp, label);
        button.title = `Ir al capítulo ${index + 1}`;
        button.addEventListener('click', () => seekSummary(chapter.outStart, chapter.sourceStart));
        li.append(button);
        return li;
      }));
    }
  }

  function clipCount(count) {
    return `${count} ${count === 1 ? 'clip' : 'clips'}`;
  }

  function setNote(message, { invalid = false, error = false } = {}) {
    note.querySelector('span').textContent = message;
    note.classList.toggle('error', error || invalid);
    if (invalid) urlInput.setAttribute('aria-invalid', 'true');
    else urlInput.removeAttribute('aria-invalid');
  }

  function setDropdownOpen(open) {
    projectsMenu.hidden = !open;
    projectsBtn.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => projectsFilter.focus(), 20);
  }

  function setDrawerOpen(open) {
    const allow = open && currentView === 'editor';
    publishDrawer.hidden = !allow;
    document.body.classList.toggle('drawer-open', allow);
  }

  function switchView(nextView) {
    currentView = nextView;
    document.body.dataset.view = nextView;
    viewEditor.hidden = nextView !== 'editor';
    backToHomeBtn.hidden = nextView !== 'editor';
    if (nextView === 'home') {
      setDrawerOpen(false);
      closeClipSpotlight();
      closeFramingPopover(false);
      stopDataStreamLoop();
      try { projectVideo.pause(); } catch { /* Ignore video pause error. */ }
      if (playheadRaf) { cancelAnimationFrame(playheadRaf); playheadRaf = null; }
      updateActiveBanner();
    } else {
      activeJobBanner.hidden = true;
      if (projectVideo.src && projectVideo.readyState >= 1 && projectMonitor.classList.contains('has-video')) {
        projectVideo.play().catch(() => {});
        startPlayheadLoop();
      }
      if (waterDropQueue.length && !waterDropActive) processWaterDropQueue();
    }
  }

  function updateActiveBanner() {
    const running = allJobs.find((job) => job.stage !== 'done' && job.stage !== 'error');
    if (currentView === 'home' && running) {
      activeJobBannerText.textContent = `En vivo: ${running.title || 'Proyecto activo'}`;
      activeJobBanner.dataset.jobId = running.id;
      activeJobBanner.hidden = false;
    } else {
      activeJobBanner.hidden = true;
    }
  }

  function setControls(inProgress) {
    busy = inProgress;
    const local = engineInput.value === 'local';
    const openrouter = engineInput.value === 'openrouter';
    const ready = local ? Boolean(modelInput.value) : (openrouter ? Boolean(engines?.openrouter) : Boolean(engines?.gemini));
    continueButton.disabled = busy || (serverAvailable && (!engines || !ready));
    cancelSourceButton.hidden = !busy;
    cancelSourceButton.disabled = !busy || !serverAvailable;
    cancelJobButton.hidden = !busy;
    cancelJobButton.disabled = !busy || !serverAvailable;
    const resumable = !busy && Boolean(currentJobData && (currentJobData.canResume || currentJobData.stage === 'error'));
    resumeJobBtn.hidden = !resumable;
    resumeJobBtn.disabled = !resumable || !serverAvailable;
    const canSearchMore = !busy && Boolean(currentJobData?.stage === 'done' && currentJobData.canSearchMore);
    searchMoreBtn.hidden = !canSearchMore;
    searchMoreBtn.disabled = !canSearchMore || !serverAvailable;
    if (resumable) {
      const rem = currentJobData.remainingClips || 0;
      resumeJobLabel.textContent = isSummary(currentJobData) ? 'Terminar resumen' : (rem > 0 ? `Terminar vídeo (${rem} clips restantes)` : 'Terminar vídeo');
    }
    urlInput.readOnly = busy;
    engineInput.disabled = busy || !engines;
    modelInput.disabled = busy || !modelInput.value;
    if (voiceInput) voiceInput.disabled = busy || videoMode !== 'prototype' || !voiceInput.options.length;
    if (modeNormalBtn) modeNormalBtn.disabled = busy;
    if (modePrototypeBtn) modePrototypeBtn.disabled = busy;
    if (modeSummaryBtn) modeSummaryBtn.disabled = busy;
    if (summaryTargetInput) summaryTargetInput.disabled = busy;
    if (summaryCaptionsInput) summaryCaptionsInput.disabled = busy;
    byId('local-model-field').hidden = !local;
    if (voiceField) voiceField.hidden = videoMode !== 'prototype';
    if (summaryTargetField) summaryTargetField.hidden = videoMode !== 'summary';
    if (summaryCaptionsField) summaryCaptionsField.hidden = videoMode !== 'summary';
    for (const input of formatInputs) input.disabled = busy;
  }

  function setVideoMode(nextMode) {
    videoMode = ['prototype', 'summary'].includes(nextMode) ? nextMode : 'normal';
    const isProto = videoMode === 'prototype';
    const isSummary = videoMode === 'summary';
    modeNormalBtn?.classList.toggle('is-active', videoMode === 'normal');
    modePrototypeBtn?.classList.toggle('is-active', isProto);
    modeSummaryBtn?.classList.toggle('is-active', isSummary);
    modeNormalBtn?.setAttribute('aria-checked', String(videoMode === 'normal'));
    modePrototypeBtn?.setAttribute('aria-checked', String(isProto));
    modeSummaryBtn?.setAttribute('aria-checked', String(isSummary));
    if (voiceField) voiceField.hidden = !isProto;
    if (voiceInput) voiceInput.disabled = busy || !isProto || !voiceInput.options.length;
    if (summaryTargetField) summaryTargetField.hidden = !isSummary;
    if (summaryCaptionsField) summaryCaptionsField.hidden = !isSummary;
    formatMenu.hidden = isSummary;
    if (sourceSubtitle) {
      sourceSubtitle.textContent = isProto
        ? 'Prototipo narrado: sin cámara del creador, pausa animada + voz locutor, clips máx. 30 s.'
        : (isSummary ? 'Resumen: conserva lo importante del vídeo en una versión más corta, con tarjetas de contexto y capítulos.' : baseSubtitle);
    }
    try { localStorage.setItem(modeStorage, videoMode); } catch { /* Ignore storage errors. */ }
    resetNote();
  }

  function currentFormat() {
    return {
      ratio: formatMenu.querySelector('[name="ratio"]:checked').value,
      layouts: formatInputs.filter((input) => input.name === 'layout' && input.checked).map(({ value }) => value),
      fitCrop: formatMenu.querySelector('[name="fit-crop"]:checked').value,
      contentCrop: formatMenu.querySelector('[name="content-crop"]:checked')?.value || 'auto',
    };
  }

  function updateFormatSummary() {
    const { ratio, layouts, contentCrop } = currentFormat();
    const contentLabel = contentCrop === 'side' ? ' · Lateral' : (contentCrop === 'below' ? ' · Franja' : '');
    byId('format-summary').textContent = `${ratio} · ${layouts.length} ${layouts.length === 1 ? 'diseño' : 'diseños'}${contentLabel}`;
  }

  function loadFormat() {
    try {
      const saved = JSON.parse(localStorage.getItem(formatStorage));
      if (!saved) return;
      const ratio = formatInputs.find((input) => input.name === 'ratio' && input.value === saved.ratio);
      const crop = formatInputs.find((input) => input.name === 'fit-crop' && input.value === saved.fitCrop);
      const contentCrop = formatInputs.find((input) => input.name === 'content-crop' && input.value === saved.contentCrop);
      const layouts = formatInputs.filter((input) => input.name === 'layout');
      if (ratio) ratio.checked = true;
      if (crop) crop.checked = true;
      if (contentCrop) contentCrop.checked = true;
      if (Array.isArray(saved.layouts) && layouts.some((input) => saved.layouts.includes(input.value))) {
        for (const input of layouts) input.checked = saved.layouts.includes(input.value);
      }
    } catch { /* Keep the visible defaults. */ }
  }

  function resetNote() {
    if (videoMode === 'summary') {
      setNote('Modo Resumen activo: la IA elige los pasajes clave, corta en pausas naturales, quita el aire muerto y añade tarjetas de contexto y capítulos. El resultado es un único vídeo 16:9.');
    } else if (videoMode === 'prototype') {
      setNote('Modo Prototipo activo: extrae solo gameplay sin cámara, pausa con voz de locutor y limita cada clip a 30 s.');
    } else if (engineInput.value === 'local') {
      setNote('El análisis se hace en tu PC. El modelo se carga al procesar y se cierra al terminar.');
    } else if (engineInput.value === 'openrouter') {
      setNote(`Whisper y FFmpeg corren en tu GPU. OpenRouter analiza con ${engines?.openrouterModel || 'Particle 1'} gratis.`);
    } else {
      setNote(baseNote);
    }
  }

  async function loadEngines() {
    try {
      const response = await fetch('/api/engines');
      if (!response.ok) throw new Error();
      engines = await response.json();
      engineInput.options[0].disabled = !engines.gemini;
      engineInput.options[1].disabled = !engines.openrouter;
      if (engines.openrouterModel) engineInput.options[1].textContent = `OpenRouter · ${engines.openrouterModel}`;
      engineInput.options[2].disabled = !engines.models.length;
      for (const { id, label } of engines.models) modelInput.add(new Option(label, id));
      if (voiceInput && Array.isArray(engines.voices)) {
        voiceInput.replaceChildren();
        for (const { id, label } of engines.voices) voiceInput.add(new Option(label, id));
        try {
          const savedVoice = localStorage.getItem(voiceStorage);
          if (savedVoice && engines.voices.some(({ id }) => id === savedVoice)) voiceInput.value = savedVoice;
        } catch { /* Ignore storage issues. */ }
      }
      let saved;
      try { saved = JSON.parse(localStorage.getItem(engineStorage)); } catch { /* Follow available engines. */ }
      if (saved?.model && engines.models.some(({ id }) => id === saved.model)) modelInput.value = saved.model;
      const available = { gemini: engines.gemini, openrouter: engines.openrouter, local: engines.models.length > 0 };
      const preferred = saved?.provider && available[saved.provider]
        ? saved.provider
        : (available.gemini ? 'gemini' : (available.openrouter ? 'openrouter' : 'local'));
      engineInput.value = preferred;
      try {
        const savedMode = localStorage.getItem(modeStorage);
        if (['prototype', 'normal', 'summary'].includes(savedMode)) setVideoMode(savedMode);
      } catch { /* Ignore storage issues. */ }
      setControls(busy);
      if (!available.gemini && !available.openrouter && !available.local) setNote('No hay ningún motor de análisis disponible en este PC.', { error: true });
      else resetNote();
    } catch {
      setNote('No se pudieron consultar los motores del estudio. Recarga esta página.', { error: true });
    }
  }

  function rememberEngine() {
    try { localStorage.setItem(engineStorage, JSON.stringify({ provider: engineInput.value, model: modelInput.value })); } catch { /* Keep current tab selection. */ }
    setControls(busy);
    resetNote();
  }

  function engineSummary(job) {
    if (job.localModel) return job.localModel;
    if (job.provider === 'openrouter') return `OpenRouter · ${job.engineLabel || 'Gratis'}`;
    if (job.provider === 'gemini') return 'Gemini 4 Hydrogen · Medium';
    return '';
  }

  function groupJobsByUrl(jobs) {
    const map = new Map();
    for (const job of jobs) {
      const key = job.videoId || job.url || job.id;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          videoId: job.videoId || '',
          url: job.url || sourceFromJob(job).url,
          label: sourceFromJob(job).label,
          versions: [],
        };
        map.set(key, group);
      }
      group.versions.push(job);
    }
    const groups = [...map.values()];
    for (const group of groups) {
      group.versions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const latest = group.versions[0];
      const titled = group.versions.find((v) => v.title && !/^V[ií]deo de (YouTube|Twitch)$|^Directo o v[ií]deo de Twitch$/i.test(v.title));
      group.title = titled?.title || latest.title || 'Proyecto de vídeo';
      group.updatedAt = latest.updatedAt;
      group.latest = latest;
    }
    return groups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function renderProjectsMenu() {
    const grouped = groupJobsByUrl(allJobs);
    projectsUrlCount.textContent = `${grouped.length} ${grouped.length === 1 ? 'URL' : 'URLs'}`;

    const query = projectsFilter.value.trim().toLowerCase();
    const filtered = !query
      ? grouped
      : grouped.filter((group) => (
        group.title.toLowerCase().includes(query)
        || group.url.toLowerCase().includes(query)
        || group.videoId.toLowerCase().includes(query)
      ));

    if (!grouped.length) {
      historyList.hidden = true;
      historyList.replaceChildren();
      historyStatus.textContent = 'Todavía no hay proyectos. Pega un enlace de YouTube o Twitch para crear el primero.';
      return;
    }
    if (!filtered.length) {
      historyList.hidden = true;
      historyList.replaceChildren();
      historyStatus.textContent = 'Ninguna URL coincide con tu búsqueda.';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const group of filtered) {
      const item = document.createElement('li');
      const isActiveGroup = currentJobData && (currentJobData.videoId === group.videoId || group.versions.some((v) => v.id === currentJobData.id));
      item.className = isActiveGroup ? 'project-group-item is-active' : 'project-group-item';

      const mainRow = document.createElement('div');
      mainRow.className = 'project-group-main';

      const copy = document.createElement('div');
      copy.className = 'project-group-copy';

      const heading = document.createElement('h3');
      heading.textContent = group.title;

      const urlPill = document.createElement('span');
      urlPill.className = 'project-url-badge';
      urlPill.textContent = group.label || sourceFromJob({ videoId: group.videoId, url: group.url }).label || group.url;

      const meta = document.createElement('p');
      meta.className = 'history-meta';
      const latest = group.latest;
      const metaParts = [
        group.versions.length > 1 ? `${group.versions.length} versiones` : '1 versión',
        clipCount(latest.clipCount),
        historyDate.format(new Date(latest.updatedAt)),
      ];
      const eng = engineSummary(latest);
      if (eng) metaParts.push(eng);
      if (latest.stage !== 'done') metaParts.push(latest.stage === 'error' ? 'Interrumpido' : 'En proceso');
      meta.textContent = metaParts.join(' · ');

      copy.append(heading, urlPill, meta);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'open-project-btn';
      openBtn.textContent = latest.stage !== 'done' && latest.stage !== 'error' ? 'Ver en vivo' : 'Abrir';
      openBtn.addEventListener('click', () => openProjectInEditor(latest.id));

      mainRow.append(copy, openBtn);
      item.append(mainRow);

      if (group.versions.length > 1) {
        const versionDetails = document.createElement('details');
        versionDetails.className = 'version-dropdown';
        if (isActiveGroup) versionDetails.open = true;

        const summary = document.createElement('summary');
        summary.innerHTML = `<span>Seleccionar versión (${group.versions.length})</span><svg><use href="#i-chevron-down"/></svg>`;

        const vList = document.createElement('div');
        vList.className = 'version-list';

        group.versions.forEach((ver, idx) => {
          const vNumber = group.versions.length - idx;
          const vBtn = document.createElement('button');
          vBtn.type = 'button';
          vBtn.className = ver.id === currentJob ? 'version-option is-current' : 'version-option';

          const left = document.createElement('span');
          const pill = document.createElement('span');
          pill.className = 'version-pill';
          pill.textContent = idx === 0 ? `v${vNumber} · Reciente` : `v${vNumber}`;
          const info = document.createElement('span');
          const statusLabel = ver.stage === 'done' ? clipCount(ver.clipCount) : (ver.stage === 'error' ? 'Interrumpido' : 'En vivo');
          info.textContent = [engineSummary(ver), statusLabel].filter(Boolean).join(' · ');
          left.append(pill, info);

          const right = document.createElement('span');
          right.className = 'version-right';
          right.textContent = historyDate.format(new Date(ver.updatedAt));

          vBtn.append(left, right);
          vBtn.addEventListener('click', () => openProjectInEditor(ver.id));
          vList.append(vBtn);
        });

        versionDetails.append(summary, vList);
        item.append(versionDetails);
      }

      fragment.append(item);
    }

    historyStatus.textContent = '';
    historyList.replaceChildren(fragment);
    historyList.hidden = false;
  }

  function updateEditorVersionSelector(job) {
    const key = job.videoId || job.url || job.id;
    const versions = allJobs
      .filter((item) => (item.videoId || item.url || item.id) === key)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const list = versions.length ? versions : [job];
    if (!list.some((item) => item.id === job.id)) list.unshift(job);

    editorVersionSelect.replaceChildren();
    list.forEach((ver, idx) => {
      const vNumber = list.length - idx;
      const clipsN = ver.clipCount ?? ver.clips?.length ?? 0;
      const opt = new Option(
        `v${vNumber}${idx === 0 ? ' (Reciente)' : ''} · ${engineSummary(ver) || 'Proyecto'} · ${clipCount(clipsN)}`,
        ver.id,
      );
      editorVersionSelect.add(opt);
    });
    editorVersionSelect.value = job.id;
    editorVersionWrap.hidden = list.length < 1;
  }

  function openProjectInEditor(jobId) {
    setDropdownOpen(false);
    switchView('editor');
    followJob(jobId, true);
  }

  async function loadHistory() {
    try {
      const response = await fetch('/api/jobs');
      if (!response.ok) throw new Error();
      const { jobs } = await response.json();
      allJobs = jobs;
      renderProjectsMenu();
      updateActiveBanner();
      if (currentJobData) updateEditorVersionSelector(currentJobData);
    } catch {
      historyStatus.textContent = 'No se pudieron cargar los proyectos. Despliega de nuevo para reintentar.';
    }
  }

  function startLoaderClock() {
    if (loaderTimer) return;
    loaderStartedAt = Date.now();
    loaderElapsedEl.textContent = '00:00';
    loaderTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - loaderStartedAt) / 1000);
      loaderElapsedEl.textContent = time(sec);
    }, 500);
  }

  function stopLoaderClock() {
    if (!loaderTimer) return;
    clearInterval(loaderTimer);
    loaderTimer = null;
  }

  function renderEmptyWaveform() {
    if (waveformEl.children.length === 160) return;
    const frag = document.createDocumentFragment();
    waveBarEls = [];
    for (let i = 0; i < 160; i++) {
      const bar = document.createElement('span');
      bar.className = 'wave-bar';
      const amp = 14 + Math.round(Math.abs(Math.sin(i * 0.35)) * 46);
      bar.style.setProperty('--i', String(i));
      bar.style.setProperty('--amp', String(amp));
      bar.style.setProperty('--res', '0');
      waveBarEls.push(bar);
      frag.append(bar);
    }
    waveformEl.replaceChildren(frag);
  }

  function renderTimelineRuler(duration) {
    if (!duration || duration <= 0) {
      timelineRulerEl.replaceChildren();
      return;
    }
    const ticks = 6;
    const frag = document.createDocumentFragment();
    for (let i = 0; i <= ticks; i++) {
      const stamp = document.createElement('span');
      stamp.textContent = time((duration * i) / ticks);
      frag.append(stamp);
    }
    timelineRulerEl.replaceChildren(frag);
  }

  function waveBarLevelClass(val) {
    if (val >= 82) return 'wave-bar is-peak';
    if (val >= 54) return 'wave-bar level-high';
    if (val >= 28) return 'wave-bar level-mid';
    return 'wave-bar level-low';
  }

  function computeWaveformFromSegments(segments, duration, bars = 160) {
    if (!segments?.length || !duration) return [];
    const binDur = duration / bars;
    const raw = new Array(bars).fill(0);
    for (const seg of segments) {
      const start = Math.max(0, Number(seg.start) || 0);
      const end = Math.min(duration, Number(seg.end) || start);
      if (end <= start) continue;
      const segDur = Math.max(0.25, end - start);
      const words = seg.text ? seg.text.trim().split(/\s+/).length : 2;
      const wps = words / segDur;
      const intensity = (3.2 + Math.min(6.2, wps * 1.35)) * 0.72 + Math.min(6, wps) * 1.15;
      const s = Math.max(0, Math.floor(start / binDur));
      const e = Math.min(bars - 1, Math.floor(end / binDur));
      for (let i = s; i <= e; i++) {
        const overlap = Math.max(0, Math.min((i + 1) * binDur, end) - Math.max(i * binDur, start));
        if (overlap > 0) raw[i] += (overlap / binDur) * intensity;
      }
    }
    const active = raw.filter((v) => v > 0.01);
    if (!active.length) return [];
    const sorted = [...active].sort((a, b) => a - b);
    const minVal = sorted[0];
    const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
    const spread = Math.max(1e-4, p98 - minVal);
    return raw.map((val, i) => {
      if (val <= 0.01) return 6 + Math.round(Math.abs(Math.sin(i * 0.85)) * 5);
      const norm = Math.max(0, Math.min(1.06, (val - minVal) / spread));
      const curved = Math.pow(Math.min(1, norm), 1.55);
      const mod = 0.88 + 0.12 * Math.sin(i * 1.7 + val * 2.9);
      return Math.max(10, Math.min(100, Math.round(10 + curved * 90 * mod)));
    });
  }

  function clearPlayheadGlow() {
    for (const bar of waveBarEls) {
      bar.classList.remove('is-near-playhead');
      bar.style.setProperty('--res', '0');
    }
  }

  function syncPlayhead() {
    if (!projectMonitor.classList.contains('has-video')) return;
    const duration = projectVideo.duration || currentJobData?.duration || 0;
    const current = projectVideo.currentTime || 0;
    projectTimecode.textContent = `${time(current)} / ${time(duration)}`;
    if (duration <= 0) return;

    const pct = Math.max(0, Math.min(100, (current / duration) * 100));
    playheadEl.style.left = `${pct.toFixed(2)}%`;
    playheadEl.classList.add('is-active');
    timelineTrackEl.setAttribute('aria-valuenow', String(Math.round(pct)));

    if (waveBarEls.length && timelineDock.classList.contains('is-ready')) {
      const center = Math.floor((pct / 100) * waveBarEls.length);
      for (let i = 0; i < waveBarEls.length; i++) {
        const dist = Math.abs(i - center);
        const bar = waveBarEls[i];
        if (dist <= 3) {
          const resonance = (1 - dist / 3.8).toFixed(2);
          bar.style.setProperty('--res', resonance);
          bar.classList.toggle('is-near-playhead', dist <= 2);
        } else if (bar.classList.contains('is-near-playhead') || bar.style.getPropertyValue('--res') !== '0') {
          bar.classList.remove('is-near-playhead');
          bar.style.setProperty('--res', '0');
        }
      }
    }
  }

  function startPlayheadLoop() {
    if (playheadRaf || currentView !== 'editor') return;
    const tick = () => {
      syncPlayhead();
      if (currentView === 'editor' && !projectVideo.paused && !projectVideo.ended && projectMonitor.classList.contains('has-video')) {
        playheadRaf = requestAnimationFrame(tick);
      } else {
        playheadRaf = null;
      }
    };
    playheadRaf = requestAnimationFrame(tick);
  }

  function applyPlaybackRate(job) {
    const duration = projectVideo.duration || job.duration || 120;
    const finished = job.stage === 'done' || job.stage === 'error';
    const autoRate = finished
      ? 1.25
      : Math.min(8, Math.max(1.75, Number((duration / 180).toFixed(1))));
    const rate = monitorSpeedMode === 'normal' ? 1 : autoRate;
    try { projectVideo.playbackRate = rate; } catch { /* Keep browser default rate. */ }
    toggleSpeedButton.textContent = monitorSpeedMode === 'normal' ? '1×' : `Auto (${rate}×)`;
    const prefix = monitorSpeedMode === 'normal' ? 'TIEMPO REAL' : (finished ? 'VISTA PREVIA' : 'VISTA RÁPIDA');
    projectSpeedBadge.lastElementChild.textContent = `${prefix} · ${rate}×`;
    audioDurationEl.textContent = time(duration);
  }

  function triggerMaterialization(jobId) {
    if (materializedJob === jobId) return;
    materializedJob = jobId;
    projectMonitor.classList.remove('is-materializing');
    void projectMonitor.offsetWidth;
    projectMonitor.classList.add('is-materializing');
    setTimeout(() => {
      if (currentJob === jobId) projectMonitor.classList.remove('is-materializing');
    }, 1250);
  }

  const packetTags = ['10110100', '01001110', '11010010 · H264', '01101001 · OPUS', '0x7F3A · 1011', '10010111 · NAL', '010110 · CHUNK', '11100101 · 8X'];
  const binaryTokens = ['1', '0', '10', '01', '101', '011', '1101', '0010', '10101', '01001'];
  const dataTokens = ['0x7F', 'H264', 'OPUS', 'PKT', '1011b', 'DMA', 'NAL', '0101b', 'MUX'];

  function spawnDataPacket() {
    if (!dataPacketsTrack) return;
    while (dataPacketsTrack.children.length >= 16) dataPacketsTrack.firstChild.remove();
    const pkt = document.createElement('span');
    pkt.className = packetCount % 2 ? 'data-packet is-alt' : 'data-packet';
    pkt.textContent = packetTags[packetCount % packetTags.length];
    const fromLeft = packetCount % 2 === 0;
    const sx = (fromLeft ? -1 : 1) * (140 + ((packetCount * 37) % 120));
    const sy = ((packetCount * 19) % 18) - 9;
    pkt.style.setProperty('--sx', `${sx}px`);
    pkt.style.setProperty('--sy', `${sy}px`);
    pkt.style.setProperty('--dur', `${(0.45 + (packetCount % 4) * 0.09).toFixed(2)}s`);
    packetCount++;
    dataPacketsTrack.append(pkt);
  }

  function buildCascadeStreams(W, H, targetX, topEntryY, sideEntryY) {
    const streams = [];
    const yFracs = [0.16, 0.28, 0.40, 0.54];
    const laneOffsets = [-24, -7, 10, 28];

    for (let i = 0; i < yFracs.length; i++) {
      const sy = yFracs[i] * H;
      const ey = sideEntryY + laneOffsets[i] * 0.55;
      streams.push({
        kind: 'left',
        p0: { x: -12, y: sy },
        p1: { x: W * 0.19, y: sy + 6 },
        p2: { x: targetX - W * 0.18, y: sideEntryY + laneOffsets[i] },
        p3: { x: targetX - 44, y: ey },
      });
      streams.push({
        kind: 'right',
        p0: { x: W + 12, y: sy },
        p1: { x: W * 0.81, y: sy + 6 },
        p2: { x: targetX + W * 0.18, y: sideEntryY + laneOffsets[i] },
        p3: { x: targetX + 44, y: ey },
      });
    }

    const topOffsets = [-116, -58, 0, 58, 116];
    for (let i = 0; i < topOffsets.length; i++) {
      const off = topOffsets[i];
      streams.push({
        kind: 'top',
        startX: targetX + off,
        startY: -12,
        endX: targetX + off * 0.58,
        endY: Math.max(24, topEntryY),
        phase: i * 1.15,
      });
    }
    return streams;
  }

  function sampleStreamPoint(stream, t) {
    if (stream.kind === 'top') {
      const xBase = lerp(stream.startX, stream.endX, t);
      const wave = Math.sin(t * Math.PI * 2.4 + stream.phase) * 11 * (1 - t * 0.35);
      const y = lerp(stream.startY, stream.endY, t);
      const dt = 0.01;
      const t2 = Math.min(1, t + dt);
      const x2 = lerp(stream.startX, stream.endX, t2) + Math.sin(t2 * Math.PI * 2.4 + stream.phase) * 11 * (1 - t2 * 0.35);
      const y2 = lerp(stream.startY, stream.endY, t2);
      const dx = x2 - (xBase + wave);
      const dy = y2 - y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: xBase + wave, y, tx: dx / len, ty: dy / len };
    }

    const { p0, p1, p2, p3 } = stream;
    const mt = 1 - t;
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y;
    const dx = 3 * mt * mt * (p1.x - p0.x) + 6 * mt * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
    const dy = 3 * mt * mt * (p1.y - p0.y) + 6 * mt * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
    const len = Math.hypot(dx, dy) || 1;
    return { x, y, tx: dx / len, ty: dy / len };
  }

  function initCascadeParticles(streamCount) {
    cascadeParticles = [];
    const total = 116;
    for (let i = 0; i < total; i++) {
      const isData = i % 4 === 0;
      cascadeParticles.push({
        streamIndex: i % streamCount,
        t: (i / total + ((i * 37) % 100) / 100) % 1,
        baseSpeed: 0.38 + ((i * 17) % 10) * 0.042,
        isData,
        token: isData ? dataTokens[i % dataTokens.length] : binaryTokens[i % binaryTokens.length],
        jitter: ((i % 7) - 3) * 2.1,
        fontSize: isData ? 9 : (10 + (i % 4)),
        trailLen: isData ? 14 : (10 + (i % 10)),
        hueKind: i % 5,
      });
    }
  }

  function renderDataCascadeFrame(now) {
    if (!loaderCascadeCanvas || projectMonitor.classList.contains('has-video')) return;
    const canvasRect = loaderCascadeCanvas.getBoundingClientRect();
    if (!canvasRect.width || !canvasRect.height) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pxW = Math.round(canvasRect.width * dpr);
    const pxH = Math.round(canvasRect.height * dpr);
    const sizeKey = `${pxW}x${pxH}`;
    if (cascadeSizeKey !== sizeKey) {
      cascadeSizeKey = sizeKey;
      loaderCascadeCanvas.width = pxW;
      loaderCascadeCanvas.height = pxH;
    }

    const ctx = loaderCascadeCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = canvasRect.width;
    const H = canvasRect.height;
    ctx.clearRect(0, 0, W, H);

    const dt = cascadeLastTime ? Math.min(0.04, Math.max(0.008, (now - cascadeLastTime) / 1000)) : 0.016;
    cascadeLastTime = now;

    const panelRect = loaderDataStream?.getBoundingClientRect();
    const coreRect = document.querySelector('.loader-core')?.getBoundingClientRect();
    const targetX = panelRect && panelRect.width ? (panelRect.left + panelRect.width / 2) - canvasRect.left : W * 0.5;
    const topEntryY = panelRect && panelRect.height ? (panelRect.top - canvasRect.top) + 4 : H * 0.24;
    const sideEntryY = coreRect && coreRect.height ? (coreRect.top + coreRect.height / 2) - canvasRect.top : H * 0.52;

    const streams = buildCascadeStreams(W, H, targetX, topEntryY, sideEntryY);
    if (!cascadeParticles.length) initCascadeParticles(streams.length);

    // Draw glowing stream rails & flowing energy dashes converging into the center.
    ctx.save();
    for (let sIdx = 0; sIdx < streams.length; sIdx++) {
      const stream = streams[sIdx];
      const railColor = stream.kind === 'top'
        ? 'rgba(25, 211, 140, 0.20)'
        : (sIdx % 2 === 0 ? 'rgba(37, 230, 255, 0.20)' : 'rgba(124, 92, 255, 0.20)');
      ctx.beginPath();
      if (stream.kind === 'top') {
        for (let step = 0; step <= 24; step++) {
          const pt = sampleStreamPoint(stream, step / 24);
          if (step === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
      } else {
        ctx.moveTo(stream.p0.x, stream.p0.y);
        ctx.bezierCurveTo(stream.p1.x, stream.p1.y, stream.p2.x, stream.p2.y, stream.p3.x, stream.p3.y);
      }
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.strokeStyle = stream.kind === 'top' ? 'rgba(25, 211, 140, 0.42)' : 'rgba(37, 230, 255, 0.36)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([16, 26]);
      ctx.lineDashOffset = -(now * 0.085 + sIdx * 11);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Concentric absorption ripples at center core & stream entry.
    for (let r = 0; r < 3; r++) {
      const rp = ((now * 0.0008 + r * 0.33) % 1);
      const radius = 26 + (1 - rp) * 62;
      ctx.strokeStyle = `rgba(37, 230, 255, ${(rp * 0.28).toFixed(3)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(targetX, sideEntryY, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // Update & render 1/0 bits and packet tokens along the 13 converging channels.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < cascadeParticles.length; i++) {
      const p = cascadeParticles[i];
      p.t += p.baseSpeed * (0.72 + p.t * 0.95) * dt;
      if (p.t >= 1) {
        p.t %= 1;
        p.token = p.isData
          ? dataTokens[(i + Math.floor(now * 0.01)) % dataTokens.length]
          : binaryTokens[(i + Math.floor(now * 0.02)) % binaryTokens.length];
      }

      const stream = streams[p.streamIndex % streams.length];
      const pos = sampleStreamPoint(stream, p.t);
      const nx = -pos.ty;
      const ny = pos.tx;
      const spread = (1 - p.t * 0.65) * p.jitter;
      const px = pos.x + nx * spread;
      const py = pos.y + ny * spread;

      const fadeIn = Math.min(1, p.t / 0.12);
      const fadeOut = p.t > 0.88 ? Math.max(0, (1 - p.t) / 0.12) : 1;
      const alpha = fadeIn * fadeOut;
      if (alpha <= 0.02) continue;

      // Tangent luminous comet trail behind the particle.
      const tailX = px - pos.tx * p.trailLen * (0.7 + p.t * 0.85);
      const tailY = py - pos.ty * p.trailLen * (0.7 + p.t * 0.85);
      ctx.strokeStyle = p.hueKind === 0
        ? `rgba(25, 211, 140, ${(alpha * 0.55).toFixed(2)})`
        : (p.hueKind === 1 ? `rgba(124, 92, 255, ${(alpha * 0.52).toFixed(2)})` : `rgba(37, 230, 255, ${(alpha * 0.58).toFixed(2)})`);
      ctx.lineWidth = p.isData ? 1.8 : 1.35;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px, py);
      ctx.stroke();

      if (p.isData) {
        ctx.font = `700 ${p.fontSize}px "IBM Plex Mono", Consolas, monospace`;
        const tw = ctx.measureText(p.token).width;
        const bw = tw + 9;
        const bh = 14;
        ctx.fillStyle = `rgba(10, 12, 26, ${(alpha * 0.86).toFixed(2)})`;
        roundedRectPath(ctx, px - bw / 2, py - bh / 2, bw, bh, 4);
        ctx.fill();
        ctx.strokeStyle = p.hueKind % 2 === 0
          ? `rgba(37, 230, 255, ${(alpha * 0.65).toFixed(2)})`
          : `rgba(124, 92, 255, ${(alpha * 0.65).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = p.t > 0.72 ? `rgba(255, 255, 255, ${alpha.toFixed(2)})` : `rgba(191, 247, 255, ${alpha.toFixed(2)})`;
        ctx.fillText(p.token, px, py + 0.5);
      } else {
        ctx.font = `750 ${p.fontSize}px "IBM Plex Mono", Consolas, monospace`;
        ctx.fillStyle = p.t > 0.76
          ? `rgba(255, 255, 255, ${alpha.toFixed(2)})`
          : (p.hueKind === 0
            ? `rgba(25, 211, 140, ${(alpha * 0.95).toFixed(2)})`
            : `rgba(37, 230, 255, ${(alpha * 0.95).toFixed(2)})`);
        ctx.fillText(p.token, px, py);
      }
    }
  }

  function startCascadeLoop() {
    if (cascadeRaf || currentView !== 'editor') return;
    cascadeLastTime = performance.now();
    const tick = (now) => {
      if (!currentJobData || currentJobData.stage !== 'downloading' || currentJobData.sourceReady || currentView !== 'editor') {
        cascadeRaf = null;
        return;
      }
      renderDataCascadeFrame(now);
      cascadeRaf = requestAnimationFrame(tick);
    };
    cascadeRaf = requestAnimationFrame(tick);
  }

  function startDataStreamLoop(job) {
    if (loaderDataStream) loaderDataStream.hidden = false;
    updateDataExtractionHud(job);
    if (job.stage === 'error' || currentView !== 'editor') return;
    startCascadeLoop();
    if (dataStreamTimer) return;
    dataStreamTimer = setInterval(() => {
      if (!currentJobData || currentJobData.stage !== 'downloading' || currentJobData.sourceReady) {
        stopDataStreamLoop();
        return;
      }
      spawnDataPacket();
      spawnDataPacket();
      updateDataExtractionHud(currentJobData);
    }, 120);
  }

  function stopDataStreamLoop() {
    if (dataStreamTimer) {
      clearInterval(dataStreamTimer);
      dataStreamTimer = null;
    }
    if (cascadeRaf) {
      cancelAnimationFrame(cascadeRaf);
      cascadeRaf = null;
    }
    cascadeLastTime = 0;
    if (loaderCascadeCanvas) {
      const ctx = loaderCascadeCanvas.getContext('2d');
      ctx?.clearRect(0, 0, loaderCascadeCanvas.width, loaderCascadeCanvas.height);
    }
  }

  function updateDataExtractionHud(job) {
    const dp = job?.downloadProgress;
    const percent = dp?.percent ?? (job?.sourceReady ? 100 : Math.min(92, Math.floor(packetCount / 6)));
    if (loaderSpeedMetric) loaderSpeedMetric.textContent = dp?.speed ? `STREAM · ${dp.speed}` : (job?.stage === 'error' ? 'DESCARGA DETENIDA' : 'MULTICONEXIÓN 8×');
    if (loaderPacketsMetric) loaderPacketsMetric.textContent = dp?.downloaded ? `DATA · ${dp.downloaded}` : `PKTS · ${packetCount}`;
    if (loaderPercentMetric) loaderPercentMetric.textContent = `${percent}%`;
    if (loaderProgressFill) loaderProgressFill.style.width = `${Math.max(5, percent)}%`;
  }

  function updateProjectMonitor(job) {
    const canLoadSource = Boolean(job.sourceReady || (job.stage && job.stage !== 'downloading'));
    if (!canLoadSource) {
      if (job.stage === 'error') {
        stopLoaderClock();
        stopDataStreamLoop();
        projectMonitor.classList.remove('has-video', 'is-materializing');
        projectVideo.hidden = true;
        projectSpeedBadge.lastElementChild.textContent = 'IMPORTACIÓN DETENIDA';
        projectLoaderTitle.textContent = 'Importación pausada';
        projectLoaderSub.textContent = 'Pulsa «Terminar vídeo» arriba para reanudar exactamente donde se quedó';
        updateDataExtractionHud(job);
        return;
      }
      stopLoaderClock();
      startLoaderClock();
      startDataStreamLoop(job);
      projectMonitor.classList.remove('has-video', 'is-materializing');
      projectVideo.hidden = true;
      projectSpeedBadge.lastElementChild.textContent = 'EXTRAYENDO DATOS 8×';
      projectLoaderTitle.textContent = 'Extrayendo vídeo y flujos multimedia…';
      projectLoaderSub.textContent = job.message || 'Descargando fragmentos paralelos de YouTube';
      return;
    }

    stopLoaderClock();
    stopDataStreamLoop();
    if (loadedSourceJob !== job.id) {
      loadedSourceJob = job.id;
      projectVideo.muted = true;
      projectVideo.hidden = false;
      projectVideo.src = `/media/${job.id}/source`;
      projectSpeedBadge.lastElementChild.textContent = 'SINCRONIZANDO VÍDEO…';
    }
    if (projectVideo.readyState >= 1) {
      projectMonitor.classList.add('has-video');
      triggerMaterialization(job.id);
      applyPlaybackRate(job);
      if (currentView === 'editor' && projectVideo.paused) projectVideo.play().catch(() => {});
      startPlayheadLoop();
    }
  }

  function getProjectClipItems(job) {
    const rawClips = Array.isArray(job?.clips) ? job.clips : [];
    const clipsByFile = new Map(rawClips.filter((clip) => clip.file).map((clip) => [clip.file, clip]));
    const baseList = Array.isArray(job?.candidates) && job.candidates.length ? job.candidates : rawClips;
    return baseList.map((entry, idx) => {
      const expectedFile = entry.expectedFile || entry.file || `clip-${idx + 1}.mp4`;
      const renderedClip = clipsByFile.get(expectedFile) || rawClips[idx] || null;
      return {
        index: idx + 1,
        expectedFile,
        start: renderedClip?.start ?? entry.start,
        end: renderedClip?.end ?? entry.end,
        title: renderedClip?.title ?? entry.title ?? `Clip ${idx + 1}`,
        onScreenHook: renderedClip?.onScreenHook ?? entry.onScreenHook ?? '',
        category: renderedClip?.category ?? entry.category ?? '',
        score: renderedClip?.score ?? entry.score ?? null,
        reason: renderedClip?.reason ?? entry.reason ?? '',
        ratio: renderedClip?.ratio ?? entry.ratio ?? job?.format?.ratio ?? '9:16',
        framing: renderedClip?.framing ?? entry.framing ?? null,
        file: renderedClip?.file ?? null,
        rendered: Boolean(renderedClip?.file),
        renderedClip,
      };
    });
  }

  function getEffectiveDuration(job) {
    const items = getProjectClipItems(job);
    const maxClipEnd = items.reduce((max, item) => Math.max(max, Number(item.end) || 0), 0);
    return projectVideo.duration || job?.duration || (lastSegments.at(-1)?.end ?? 0) || (maxClipEnd > 0 ? Math.max(60, maxClipEnd * 1.15) : 120);
  }

  function highlightTimelineClip(index, scrollCard = true) {
    for (const [idx, box] of timelineBoxesMap.entries()) {
      box.classList.toggle('is-active', idx === index);
    }
    for (const [idx, entry] of clipCardElsMap.entries()) {
      entry.card.classList.toggle('is-highlighted', idx === index);
      if (scrollCard && idx === index) {
        entry.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  function renderTimelineMarkers(job, duration) {
    if (!duration) return;
    const voiceKey = `${job.id}:${lastSegments.length}:${Math.round(duration)}`;
    if (lastSegments.length && renderedVoiceKey !== voiceKey) {
      renderedVoiceKey = voiceKey;
      for (const old of voiceSegmentsEl.querySelectorAll('.voice-block')) old.remove();
      const firstBox = voiceSegmentsEl.querySelector('.timeline-clip-box');
      const frag = document.createDocumentFragment();
      const step = Math.max(1, Math.ceil(lastSegments.length / 72));
      for (let i = 0; i < lastSegments.length; i += step) {
        const seg = lastSegments[i];
        const block = document.createElement('span');
        block.className = 'voice-block';
        const left = (seg.start / duration) * 100;
        const width = Math.max(0.6, ((seg.end - seg.start) / duration) * 100);
        block.style.left = `${left.toFixed(2)}%`;
        block.style.width = `${Math.min(100 - left, width).toFixed(2)}%`;
        frag.append(block);
      }
      if (firstBox) voiceSegmentsEl.insertBefore(frag, firstBox);
      else voiceSegmentsEl.append(frag);
    }

    if (isSummary(job)) {
      renderSummaryTimeline(job, duration);
      return;
    }
    timelineDock.classList.remove('is-summary', 'summary-done');
    const items = getProjectClipItems(job).slice(0, revealedClipCount);
    for (const item of items) {
      let box = timelineBoxesMap.get(item.index);
      const left = Math.max(0, Math.min(98.5, (item.start / duration) * 100));
      const width = Math.max(1.8, Math.min(100 - left, ((item.end - item.start) / duration) * 100));
      if (!box) {
        box = document.createElement('button');
        box.type = 'button';
        box.className = 'timeline-clip-box';
        box.dataset.clipIndex = String(item.index);
        box.innerHTML = '<span class="clip-box-tag"><strong></strong><span></span></span>';
        const tag = box.querySelector('.clip-box-tag');
        tag.querySelector('strong').textContent = `#${String(item.index).padStart(2, '0')}`;
        tag.querySelector('span').textContent = item.title;
        box.title = `${item.title} (${time(item.start)}–${time(item.end)})`;
        box.addEventListener('click', (event) => {
          event.stopPropagation();
          const latest = (currentJobData && getProjectClipItems(currentJobData).find((x) => x.index === item.index)) || item;
          if (projectMonitor.classList.contains('has-video')) {
            projectVideo.currentTime = latest.start;
            syncPlayhead();
          }
          highlightTimelineClip(latest.index, true);
          if (currentJobData) {
            openClipSpotlight(currentJobData, latest);
            clearWaterDropTimers();
            openFramingPopover(currentJobData, latest, false);
          }
        });
        box.addEventListener('mouseenter', () => {
          if (!currentJobData || waterDropActive || currentJobData.activeFramingClip) return;
          if (!framingPopover.hidden && popoverItem?.index === item.index) return;
          const latest = getProjectClipItems(currentJobData).find((x) => x.index === item.index) || item;
          if (popoverDismissedKey !== `${latest.index}:manual`) {
            clearWaterDropTimers();
            openFramingPopover(currentJobData, latest, false);
          }
        });
        timelineBoxesMap.set(item.index, box);
        voiceSegmentsEl.append(box);
      }
      box.style.left = `${left.toFixed(2)}%`;
      box.style.width = `${width.toFixed(2)}%`;
      box.classList.toggle('is-rendered', item.rendered);
      box.classList.toggle('is-framing-now', Boolean(job.activeFramingClip && job.activeFramingClip.index === item.index));
    }
    if (popoverItem) positionFramingPopover(popoverItem.index);
  }

  function updateAudioTimeline(job) {
    renderEmptyWaveform();
    const duration = projectVideo.duration || job.duration || (lastSegments.at(-1)?.end ?? 0);
    if (duration) {
      audioDurationEl.textContent = time(duration);
      renderTimelineRuler(duration);
    }

    if (job.stage === 'downloading') {
      clearPlayheadGlow();
      clearTimeout(waveBuildTimer);
      timelineDock.classList.remove('is-transcribing', 'is-ready', 'is-building-wave');
      audioStatusEl.textContent = 'Esperando pista de audio';
      audioMetaEl.textContent = 'Se analizará al completar la importación';
      return;
    }
    if (job.stage === 'transcribing') {
      clearPlayheadGlow();
      clearTimeout(waveBuildTimer);
      timelineDock.classList.add('is-transcribing');
      timelineDock.classList.remove('is-ready', 'is-building-wave');
      audioStatusEl.textContent = 'Whisper transcribiendo audio en GPU…';
      audioMetaEl.textContent = 'El espectrograma aparecerá al terminar Whisper';
      return;
    }

    const wave = Array.isArray(job.waveform) && job.waveform.length === 160
      ? job.waveform
      : computeWaveformFromSegments(lastSegments, duration, 160);
    if (wave.length && waveformRenderedJob !== job.id) {
      waveformRenderedJob = job.id;
      const frag = document.createDocumentFragment();
      waveBarEls = [];
      for (let i = 0; i < wave.length; i++) {
        const bar = document.createElement('span');
        bar.className = waveBarLevelClass(wave[i]);
        bar.style.setProperty('--i', String(i));
        bar.style.setProperty('--amp', String(wave[i]));
        bar.style.setProperty('--res', '0');
        waveBarEls.push(bar);
        frag.append(bar);
      }
      waveformEl.replaceChildren(frag);
      timelineDock.classList.remove('is-transcribing', 'is-building-wave');
      void timelineDock.offsetWidth;
      timelineDock.classList.add('is-ready', 'is-building-wave');
      clearTimeout(waveBuildTimer);
      waveBuildTimer = setTimeout(() => {
        if (currentJob === job.id) timelineDock.classList.remove('is-building-wave');
      }, 2700);
    } else if (!wave.length) {
      timelineDock.classList.remove('is-transcribing', 'is-building-wave');
      timelineDock.classList.add('is-ready');
    }

    audioStatusEl.textContent = 'Espectrograma sincronizado';
    const segTotal = lastSegments.length || job.segmentCount;
    const itemsTotal = getProjectClipItems(job).length;
    audioMetaEl.textContent = isSummary(job)
      ? ([segTotal ? `${segTotal} segmentos` : null, job.summary ? `${job.summary.partCount} tramos conservados` : null, job.summary ? `${longClock(job.summary.outputSeconds)} de ${longClock(job.summary.sourceSeconds)}` : null].filter(Boolean).join(' · ') || 'Pista sincronizada')
      : ([
        segTotal ? `${segTotal} segmentos` : null,
        itemsTotal ? `${clipCount(itemsTotal)} seleccionados` : null,
      ].filter(Boolean).join(' · ') || 'Pista sincronizada');
    renderTimelineMarkers(job, duration);
  }

  function refreshSpotlightContent(job, item) {
    spotlightItem = item;
    const layout = layoutNames[item.framing?.layout];
    spotlightNum.textContent = `#${String(item.index).padStart(2, '0')}`;
    spotlightRatio.textContent = layout ? `${item.ratio} · ${layout}` : item.ratio;
    if (spotlightScore) {
      spotlightScore.textContent = Number.isFinite(item.score) ? `★ ${item.score.toFixed(1)}` : '';
      spotlightScore.hidden = !Number.isFinite(item.score);
    }
    if (spotlightCategory) {
      spotlightCategory.textContent = item.category || '';
      spotlightCategory.hidden = !item.category;
    }
    spotlightTimes.textContent = `${time(item.start)}–${time(item.end)} · ${Math.round(item.end - item.start)} s`;
    if (isSummary(job)) {
      spotlightNum.textContent = 'RESUMEN';
      spotlightRatio.textContent = '16:9 · Vídeo largo';
      spotlightTimes.textContent = job.summary ? `${longClock(job.summary.outputSeconds)} de ${longClock(job.summary.sourceSeconds)}` : 'Vídeo resumido';
      spotlightScore.hidden = true;
      spotlightCategory.hidden = true;
    }
    spotlightTitle.textContent = item.title;
    spotlightStage.dataset.ratio = item.ratio || '9:16';
    if (spotlightHook) {
      spotlightHook.textContent = item.onScreenHook ? `Titular en vídeo: ${item.onScreenHook}` : '';
      spotlightHook.hidden = !item.onScreenHook;
    }
    spotlightReason.textContent = item.reason;

    if (item.rendered && item.file) {
      const address = `/media/${job.id}/${item.file}`;
      if (spotlightVideo.dataset.mode !== 'rendered' || spotlightVideo.dataset.file !== item.file) {
        spotlightVideo.dataset.mode = 'rendered';
        spotlightVideo.dataset.file = item.file;
        spotlightVideo.classList.remove('is-live-preview');
        spotlightVideo.classList.add('is-rendered-clip');
        spotlightVideo.loop = false;
        spotlightVideo.muted = false;
        spotlightVideo.src = address;
        spotlightVideo.play().catch(() => {});
      }
      spotlightPubBtn.disabled = false;
      spotlightMp4Btn.href = address;
      spotlightMp4Btn.download = item.file;
      spotlightMp4Btn.setAttribute('aria-disabled', 'false');
      spotlightAssBtn.href = address.replace(/\.mp4$/, '.ass');
      spotlightAssBtn.download = item.file.replace(/\.mp4$/, '.ass');
      spotlightAssBtn.setAttribute('aria-disabled', 'false');
    } else {
      const srcUrl = `/media/${job.id}/source#t=${item.start.toFixed(1)},${item.end.toFixed(1)}`;
      if (spotlightVideo.dataset.mode !== 'live' || spotlightVideo.dataset.clipKey !== String(item.index)) {
        spotlightVideo.dataset.mode = 'live';
        spotlightVideo.dataset.clipKey = String(item.index);
        spotlightVideo.dataset.file = '';
        spotlightVideo.classList.remove('is-rendered-clip');
        spotlightVideo.classList.add('is-live-preview');
        spotlightVideo.loop = true;
        spotlightVideo.muted = false;
        spotlightVideo.src = srcUrl;
        spotlightVideo.play().catch(() => {});
      }
      spotlightPubBtn.disabled = true;
      spotlightMp4Btn.removeAttribute('href');
      spotlightMp4Btn.setAttribute('aria-disabled', 'true');
      spotlightAssBtn.removeAttribute('href');
      spotlightAssBtn.setAttribute('aria-disabled', 'true');
    }
  }

  function openClipSpotlight(job, item) {
    if (!job || !item) return;
    const wasDifferent = spotlightIndex !== null && spotlightIndex !== item.index;
    spotlightIndex = item.index;
    nleDeck.classList.add('has-spotlight');
    spotlightPanel.setAttribute('aria-hidden', 'false');
    if (wasDifferent) {
      spotlightPanel.classList.remove('is-switching');
      void spotlightPanel.offsetWidth;
      spotlightPanel.classList.add('is-switching');
    }
    for (const [idx, entry] of clipCardElsMap.entries()) {
      entry.card.classList.toggle('is-selected', idx === item.index);
    }
    for (const [idx, box] of timelineBoxesMap.entries()) {
      box.classList.toggle('is-active', idx === item.index);
    }
    refreshSpotlightContent(job, item);
  }

  function clampRange(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpRect(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t),
    };
  }

  function easeInOutCubic(t) {
    const x = clampRange(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }

  function parseAspectRatio(ratioText) {
    if (ratioText === '16:9') return 16 / 9;
    if (ratioText === '1:1') return 1;
    if (ratioText === '4:5') return 4 / 5;
    if (ratioText === '4:3') return 4 / 3;
    return 9 / 16;
  }

  function normalizedTargetPanels(layout) {
    if (layout === 'gameplay') return [{ x: 0, y: 0, w: 1, h: 0.31 }, { x: 0, y: 0.31, w: 1, h: 0.69 }];
    if (layout === 'shared') return [{ x: 0, y: 0, w: 1, h: 0.37 }, { x: 0, y: 0.37, w: 1, h: 0.63 }];
    if (layout === 'split') return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
    if (layout === 'three') return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
    if (layout === 'four') return [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];
    return [{ x: 0, y: 0, w: 1, h: 1 }];
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
  }

  function clearWaterDropTimers() {
    clearTimeout(waterDropHoldTimer);
    clearTimeout(waterDropCloseTimer);
    clearTimeout(waterDropNextTimer);
    waterDropHoldTimer = null;
    waterDropCloseTimer = null;
    waterDropNextTimer = null;
    waterDropActive = false;
    for (const box of timelineBoxesMap.values()) box.classList.remove('is-drop-origin');
  }

  function finishHideFramingPopover() {
    popoverItem = null;
    popoverJobMeta = null;
    lastMorphHudKey = '';
    if (popoverRaf) { cancelAnimationFrame(popoverRaf); popoverRaf = null; }
    try { popoverVideo.pause(); } catch { /* Ignore pause errors. */ }
    framingPopover.classList.remove('is-opening', 'is-closing', 'is-auto-drop');
    framingPopover.hidden = true;
    for (const box of timelineBoxesMap.values()) box.classList.remove('is-drop-origin');
  }

  function closeFramingPopover(rememberDismiss = true, animateClose = false) {
    if (rememberDismiss && popoverItem) {
      popoverDismissedKey = `${popoverItem.index}:${popoverItem.stage || 'manual'}`;
    }
    clearWaterDropTimers();
    if (animateClose && !framingPopover.hidden) {
      framingPopover.classList.remove('is-opening');
      framingPopover.classList.add('is-closing');
      waterDropCloseTimer = setTimeout(finishHideFramingPopover, 520);
      return;
    }
    finishHideFramingPopover();
  }

  function enqueueWaterDrop(job, item) {
    if (!job || !item || !item.index) return;
    if (shownDropClips.has(item.index)) return;
    shownDropClips.add(item.index);
    if (revealedClipCount < item.index) {
      revealedClipCount = Math.max(revealedClipCount, item.index);
    }
    renderTimelineMarkers(job, getEffectiveDuration(job));
    waterDropQueue.push(item);
    processWaterDropQueue();
  }

  function processWaterDropQueue() {
    if (waterDropActive || !waterDropQueue.length || !currentJobData || currentView !== 'editor') return;
    const item = waterDropQueue.shift();
    waterDropActive = true;
    const duration = getEffectiveDuration(currentJobData);
    if (revealedClipCount < item.index) revealedClipCount = Math.max(revealedClipCount, item.index);
    renderTimelineMarkers(currentJobData, duration);
    openFramingPopover(currentJobData, item, true);
  }

  function deriveFramingBoxes(item) {
    const framing = item?.framing;
    if (framing?.boxes?.length) return framing.boxes;
    const layout = framing?.layout || 'fill';
    if (layout === 'gameplay' || layout === 'shared') {
      const cam = framing?.tracks?.[0]?.[0] ?? { x: 0.16, y: 0.22 };
      const camReg = framing?.regions?.[0] ?? { width: 0.24, height: 0.28 };
      const content = framing?.tracks?.[1]?.[0] ?? { x: 0.5, y: 0.5 };
      const contentReg = framing?.regions?.[1] ?? { width: 0.78, height: 0.84 };
      return [
        { role: 'camera', label: 'Rostro', x: cam.x, y: cam.y, width: camReg.width || 0.24, height: camReg.height || 0.28, points: framing?.tracks?.[0] ?? [] },
        { role: 'content', label: layout === 'gameplay' ? 'Partida' : 'Contenido', x: content.x, y: content.y, width: contentReg.width || 0.78, height: contentReg.height || 0.84, points: framing?.tracks?.[1] ?? [] },
      ];
    }
    if (['split', 'three', 'four'].includes(layout) && framing?.tracks?.length) {
      return framing.tracks.map((track, i) => ({
        role: i === 0 ? 'camera' : 'content',
        label: `Sujeto ${i + 1}`,
        x: track[0]?.x ?? (i === 0 ? 0.28 : 0.72),
        y: track[0]?.y ?? 0.5,
        width: framing.regions?.[i]?.width || 0.36,
        height: framing.regions?.[i]?.height || 0.68,
        points: track,
      }));
    }
    const track = framing?.tracks?.[0] ?? [];
    const pt = track[0] ?? { x: 0.5, y: 0.5 };
    return [{
      role: 'focus',
      label: layout === 'fit' ? 'Encuadre 16:9' : 'Seguimiento IA',
      x: pt.x,
      y: pt.y,
      width: framing?.regions?.[0]?.width || (layout === 'fit' ? 0.92 : 0.36),
      height: framing?.regions?.[0]?.height || (layout === 'fit' ? 0.92 : 0.88),
      points: track,
    }];
  }

  function interpolateTrackPoint(points, offset) {
    if (!points?.length) return null;
    if (points.length === 1 || offset <= points[0].offset) return points[0];
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      if (offset <= next.offset) {
        if (next.cutBefore || next.offset <= curr.offset) return curr;
        const t = (offset - curr.offset) / (next.offset - curr.offset);
        return { x: curr.x + (next.x - curr.x) * t, y: curr.y + (next.y - curr.y) * t };
      }
    }
    return points.at(-1);
  }

  function drawFallbackVideoArt(ctx, role, rect, now) {
    const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    if (role === 'camera') {
      grad.addColorStop(0, 'rgba(42, 28, 66, 0.95)');
      grad.addColorStop(1, 'rgba(18, 14, 34, 0.96)');
    } else {
      grad.addColorStop(0, 'rgba(14, 32, 54, 0.95)');
      grad.addColorStop(1, 'rgba(10, 12, 28, 0.96)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
    if (role === 'camera') {
      const r = Math.max(10, Math.min(rect.w, rect.h) * 0.24);
      ctx.strokeStyle = `rgba(255, 190, 61, ${0.45 + pulse * 0.35})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.16, r * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.95, r * 1.1, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(37, 230, 255, 0.22)';
      ctx.lineWidth = 1;
      for (let k = -2; k <= 2; k++) {
        ctx.beginPath();
        ctx.moveTo(rect.x + 8, cy + k * (rect.h * 0.16));
        ctx.lineTo(rect.x + rect.w - 8, cy + k * (rect.h * 0.16));
        ctx.stroke();
      }
    }
  }

  function drawVideoCrop(ctx, video, normCrop, dstRect, radius, { alpha = 1, blurPx = 0, darkTint = 0, role = 'focus', now = 0 } = {}) {
    if (dstRect.w <= 1 || dstRect.h <= 1 || alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = clampRange(alpha, 0, 1);
    roundedRectPath(ctx, dstRect.x, dstRect.y, dstRect.w, dstRect.h, radius);
    ctx.clip();

    if (video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const nw = clampRange(normCrop.w, 0.08, 1);
      const nh = clampRange(normCrop.h, 0.08, 1);
      const cx = clampRange(normCrop.cx, nw / 2, 1 - nw / 2);
      const cy = clampRange(normCrop.cy, nh / 2, 1 - nh / 2);

      let sw = vw * nw;
      let sh = vh * nh;
      const targetAspect = dstRect.w / Math.max(1, dstRect.h);
      const srcAspect = sw / Math.max(1, sh);
      if (srcAspect > targetAspect) sw = sh * targetAspect;
      else sh = sw / targetAspect;

      const sx = clampRange(cx * vw - sw / 2, 0, Math.max(0, vw - sw));
      const sy = clampRange(cy * vh - sh / 2, 0, Math.max(0, vh - sh));
      if (blurPx > 0) ctx.filter = `blur(${blurPx}px) brightness(0.55) saturate(1.25)`;
      ctx.drawImage(video, sx, sy, sw, sh, dstRect.x, dstRect.y, dstRect.w, dstRect.h);
      ctx.filter = 'none';
    } else {
      drawFallbackVideoArt(ctx, role, dstRect, now);
    }

    if (darkTint > 0) {
      ctx.fillStyle = `rgba(8, 7, 18, ${clampRange(darkTint, 0, 0.9)})`;
      ctx.fillRect(dstRect.x, dstRect.y, dstRect.w, dstRect.h);
    }
    ctx.restore();
  }

  function drawInwardCompressFrame(ctx, rect, alpha, pulseT) {
    if (alpha <= 0.02 || rect.w < 12 || rect.h < 12) return;
    ctx.save();
    ctx.globalAlpha = clampRange(alpha, 0, 1);

    ctx.strokeStyle = 'rgba(255, 79, 121, 0.92)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
    ctx.stroke();
    ctx.setLineDash([]);

    const shift = 4 + Math.sin(pulseT * Math.PI * 4) * 3;
    const corners = [
      { x: rect.x + 8, y: rect.y + 8, dx: 1, dy: 1 },
      { x: rect.x + rect.w - 8, y: rect.y + 8, dx: -1, dy: 1 },
      { x: rect.x + 8, y: rect.y + rect.h - 8, dx: 1, dy: -1 },
      { x: rect.x + rect.w - 8, y: rect.y + rect.h - 8, dx: -1, dy: -1 },
    ];
    for (const c of corners) {
      const tipX = c.x + c.dx * (11 + shift);
      const tipY = c.y + c.dy * (11 + shift);
      const tailX = c.x + c.dx * (1 + shift * 0.4);
      const tailY = c.y + c.dy * (1 + shift * 0.4);

      ctx.strokeStyle = '#ff4f79';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.fillStyle = '#ffd1dc';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - c.dx * 7, tipY - c.dy * 1.5);
      ctx.lineTo(tipX - c.dx * 1.5, tipY - c.dy * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHudCardFrame(ctx, rect, color, label, radius, showReticle, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = clampRange(alpha, 0, 1);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.stroke();

    if (showReticle) {
      const arm = Math.min(12, rect.w * 0.22, rect.h * 0.22);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      const pts = [
        [rect.x + 1, rect.y + 1, 1, 1],
        [rect.x + rect.w - 1, rect.y + 1, -1, 1],
        [rect.x + 1, rect.y + rect.h - 1, 1, -1],
        [rect.x + rect.w - 1, rect.y + rect.h - 1, -1, -1],
      ];
      for (const [px, py, sx, sy] of pts) {
        ctx.beginPath();
        ctx.moveTo(px + sx * arm, py);
        ctx.lineTo(px, py);
        ctx.lineTo(px, py + sy * arm);
        ctx.stroke();
      }
    }

    if (label && rect.w > 46 && rect.h > 26) {
      ctx.font = '700 9.5px "IBM Plex Mono", Consolas, monospace';
      const tw = ctx.measureText(label).width;
      const pw = Math.min(rect.w - 8, tw + 12);
      ctx.fillStyle = 'rgba(8, 7, 18, 0.84)';
      roundedRectPath(ctx, rect.x + 4, rect.y + 4, pw, 16, 5);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + 10, rect.y + 12, pw - 8);
    }
    ctx.restore();
  }

  function updateMorphHudDOM(cycleIndex, phaseText) {
    const key = `${cycleIndex}:${phaseText}`;
    if (key === lastMorphHudKey) return;
    lastMorphHudKey = key;
    popoverStagePill.textContent = `Ciclo ${cycleIndex + 1} / ${MORPH_TOTAL_CYCLES}`;
    if (popoverMorphPhase) popoverMorphPhase.textContent = phaseText;
    if (popoverCycleDots) {
      const dots = popoverCycleDots.querySelectorAll('i');
      dots.forEach((dot, idx) => {
        dot.classList.toggle('is-active', idx === cycleIndex);
        dot.classList.toggle('is-done', idx < cycleIndex);
      });
    }
  }

  function renderMorphFrame(now) {
    if (!popoverItem || !popoverJobMeta || framingPopover.hidden || !popoverMorphCanvas || !popoverMorphStage) return;
    const stageRect = popoverMorphStage.getBoundingClientRect();
    if (!stageRect.width || !stageRect.height) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pxW = Math.round(stageRect.width * dpr);
    const pxH = Math.round(stageRect.height * dpr);
    const sizeKey = `${pxW}x${pxH}`;
    if (morphCanvasSize !== sizeKey) {
      morphCanvasSize = sizeKey;
      popoverMorphCanvas.width = pxW;
      popoverMorphCanvas.height = pxH;
    }

    const ctx = popoverMorphCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = stageRect.width;
    const H = stageRect.height;
    ctx.clearRect(0, 0, W, H);

    const elapsed = clampRange(now - popoverAnimStart, 0, MORPH_TOTAL_MS);
    const cycleIndex = Math.min(MORPH_TOTAL_CYCLES - 1, Math.floor(elapsed / MORPH_CYCLE_MS));
    const u = clampRange((elapsed - cycleIndex * MORPH_CYCLE_MS) / MORPH_CYCLE_MS, 0, 1);

    const { layout, ratio, fitCrop, boxes } = popoverJobMeta;
    let p = 0;
    let phaseLabel = '01 · DETECTANDO ESCENA 16:9';
    if (u < 0.20) {
      p = 0;
      phaseLabel = '01 · DETECTANDO ESCENA 16:9';
    } else if (u < 0.62) {
      p = easeInOutCubic((u - 0.20) / 0.42);
      phaseLabel = layout === 'fit'
        ? `02 · ENCOGIENDO VÍDEO → ${ratio}`
        : `02 · REENCUADRANDO ESCENA → ${ratio}`;
    } else if (u < 0.86) {
      p = 1;
      phaseLabel = `03 · FORMATO ${ratio} APLICADO`;
    } else if (cycleIndex < MORPH_TOTAL_CYCLES - 1) {
      p = 1 - easeInOutCubic((u - 0.86) / 0.14);
      phaseLabel = `04 · SIGUIENTE PASADA (${cycleIndex + 2}/${MORPH_TOTAL_CYCLES})`;
    } else {
      p = 1;
      phaseLabel = `03 · TRANSFORMACIÓN LISTA (3/3)`;
    }
    updateMorphHudDOM(cycleIndex, phaseLabel);

    const padX = 16;
    const padTop = 34;
    const padBottom = 10;
    const availW = W - padX * 2;
    const availH = H - padTop - padBottom;

    const srcH = Math.min(availH, availW / (16 / 9));
    const srcW = srcH * (16 / 9);
    const srcFrame = { x: (W - srcW) / 2, y: padTop + (availH - srcH) / 2, w: srcW, h: srcH };

    const targetAspect = parseAspectRatio(ratio);
    const dstH = Math.min(availH, availW / targetAspect);
    const dstW = dstH * targetAspect;
    const dstFrame = { x: (W - dstW) / 2, y: padTop + (availH - dstH) / 2, w: dstW, h: dstH };

    // Faint blueprint silhouettes so source -> destination spatial change reads cleanly.
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${lerp(0.24, 0.08, p)})`;
    ctx.setLineDash([4, 4]);
    roundedRectPath(ctx, srcFrame.x, srcFrame.y, srcFrame.w, srcFrame.h, 12);
    ctx.stroke();
    ctx.strokeStyle = `rgba(37, 230, 255, ${lerp(0.24, 0.52, p)})`;
    roundedRectPath(ctx, dstFrame.x, dstFrame.y, dstFrame.w, dstFrame.h, 12);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const offset = Math.max(0, (popoverVideo.currentTime || popoverItem.start) - popoverItem.start);

    if (layout === 'fit') {
      // Base blurred backdrop & hook chrome fades inside dstFrame as 16:9 shrinks into center.
      if (p > 0.04) {
        drawVideoCrop(ctx, popoverVideo, { cx: 0.5, cy: 0.5, w: 0.6, h: 1 }, dstFrame, 12, {
          alpha: p * 0.92,
          blurPx: 10,
          darkTint: 0.42,
          role: 'content',
          now,
        });
        ctx.save();
        ctx.globalAlpha = p;
        ctx.fillStyle = 'rgba(255, 190, 61, 0.24)';
        roundedRectPath(ctx, dstFrame.x + 8, dstFrame.y + 8, dstFrame.w - 16, 15, 6);
        ctx.fill();
        ctx.fillStyle = '#ffe39e';
        ctx.font = '700 8.5px "IBM Plex Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GANCHO IA', dstFrame.x + dstFrame.w / 2, dstFrame.y + 15.5, dstFrame.w - 22);
        ctx.restore();
      }

      const fitAspect = fitCrop === '1:1' ? 1 : (fitCrop === '4:3' ? 4 / 3 : 16 / 9);
      const fitW = dstFrame.w;
      const fitH = Math.min(dstFrame.h * 0.72, fitW / fitAspect);
      const targetFitRect = {
        x: dstFrame.x + (dstFrame.w - fitW) / 2,
        y: dstFrame.y + (dstFrame.h - fitH) / 2,
        w: fitW,
        h: fitH,
      };
      const squeezeRect = lerpRect(srcFrame, targetFitRect, p);
      const fitNorm = fitCrop === '16:9' || !fitCrop || fitCrop === 'original'
        ? { cx: 0.5, cy: 0.5, w: 1, h: 1 }
        : { cx: 0.5, cy: 0.5, w: (fitAspect / (16 / 9)), h: 1 };

      drawVideoCrop(ctx, popoverVideo, fitNorm, squeezeRect, lerp(12, 7, p), { alpha: 0.98, role: 'content', now });
      drawHudCardFrame(ctx, squeezeRect, p > 0.7 ? '#25e6ff' : '#ff4f79', `AJUSTE ${fitCrop === 'original' ? '16:9' : fitCrop}`, lerp(12, 7, p), p < 0.75, 0.95);
      drawInwardCompressFrame(ctx, lerpRect(srcFrame, dstFrame, p), p < 0.9 ? 1 - p * 0.45 : 0.15, u);
    } else if (!['gameplay', 'shared', 'split', 'three', 'four'].includes(layout) || boxes.length <= 1) {
      // Single-focus fill mode: zoom/slide tracked subject box from 16:9 into target aspect.
      const box = boxes[0];
      const pt = interpolateTrackPoint(box.points, offset);
      const bx = pt?.x ?? box.x;
      const by = pt?.y ?? box.y;
      const bw = clampRange(box.width, 0.25, 0.96);
      const bh = clampRange(box.height, 0.45, 0.96);

      const fadeSrc = 1 - p * 0.88;
      if (fadeSrc > 0.04) {
        drawVideoCrop(ctx, popoverVideo, { cx: 0.5, cy: 0.5, w: 1, h: 1 }, srcFrame, 12, { alpha: fadeSrc, darkTint: p * 0.35, role: 'content', now });
      }

      const srcBoxRect = {
        x: clampRange(srcFrame.x + (bx - bw / 2) * srcFrame.w, srcFrame.x, srcFrame.x + srcFrame.w - 30),
        y: clampRange(srcFrame.y + (by - bh / 2) * srcFrame.h, srcFrame.y, srcFrame.y + srcFrame.h - 30),
        w: bw * srcFrame.w,
        h: bh * srcFrame.h,
      };
      const curRect = lerpRect(srcBoxRect, dstFrame, p);
      drawVideoCrop(ctx, popoverVideo, { cx: bx, cy: by, w: bw, h: bh }, curRect, lerp(9, 12, p), { alpha: 0.98, role: 'camera', now });
      drawHudCardFrame(ctx, curRect, '#ffbe3d', '🎯 SEGUIMIENTO IA', lerp(9, 12, p), p < 0.75, 0.96);
      drawInwardCompressFrame(ctx, lerpRect(srcFrame, dstFrame, p), 1 - p * 0.65, u);
    } else {
      // Multi-region morph (gameplay, shared, split, three, four): detach face/camera + gameplay cards into final layout.
      const fadeSrc = 1 - p * 0.88;
      if (fadeSrc > 0.04) {
        drawVideoCrop(ctx, popoverVideo, { cx: 0.5, cy: 0.5, w: 1, h: 1 }, srcFrame, 12, { alpha: fadeSrc, darkTint: 0.28 + p * 0.4, role: 'content', now });
      }

      const panels = normalizedTargetPanels(layout);
      const movingCards = panels.map((panel, i) => {
        const box = boxes[Math.min(i, boxes.length - 1)];
        const pt = interpolateTrackPoint(box.points, offset);
        const bx = pt?.x ?? box.x;
        const by = pt?.y ?? box.y;
        const bw = clampRange(box.width, 0.16, 0.96);
        const bh = clampRange(box.height, 0.18, 0.96);
        const srcRect = {
          x: clampRange(srcFrame.x + (bx - bw / 2) * srcFrame.w, srcFrame.x + 2, srcFrame.x + srcFrame.w - bw * srcFrame.w - 2),
          y: clampRange(srcFrame.y + (by - bh / 2) * srcFrame.h, srcFrame.y + 2, srcFrame.y + srcFrame.h - bh * srcFrame.h - 2),
          w: bw * srcFrame.w,
          h: bh * srcFrame.h,
        };
        const dstRect = {
          x: dstFrame.x + panel.x * dstFrame.w + 2,
          y: dstFrame.y + panel.y * dstFrame.h + 2,
          w: panel.w * dstFrame.w - 4,
          h: panel.h * dstFrame.h - 4,
        };
        const curRect = lerpRect(srcRect, dstRect, p);
        curRect.y += Math.sin(p * Math.PI) * (box.role === 'camera' ? -13 : 7);
        return { box, bx, by, bw, bh, srcRect, dstRect, curRect };
      });

      // Glowing trajectory curves connecting source crop positions to assembled slots mid-flight.
      const arcAlpha = Math.sin(p * Math.PI);
      if (arcAlpha > 0.05) {
        ctx.save();
        ctx.globalAlpha = arcAlpha * 0.78;
        ctx.lineWidth = 1.6;
        for (const card of movingCards) {
          const sx = card.srcRect.x + card.srcRect.w / 2;
          const sy = card.srcRect.y + card.srcRect.h / 2;
          const dx = card.dstRect.x + card.dstRect.w / 2;
          const dy = card.dstRect.y + card.dstRect.h / 2;
          ctx.strokeStyle = card.box.role === 'camera' ? '#ffbe3d' : '#25e6ff';
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo((sx + dx) / 2, Math.min(sy, dy) - 22, dx, dy);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Draw gameplay/content cards first, then face/camera card smoothly on top.
      const ordered = [...movingCards].sort((a, b) => (a.box.role === 'camera' ? 1 : 0) - (b.box.role === 'camera' ? 1 : 0));
      for (const card of ordered) {
        const isCam = card.box.role === 'camera';
        const hudColor = isCam ? '#ffbe3d' : '#25e6ff';
        const tag = isCam ? `📷 ${card.box.label || 'Rostro'}` : card.box.label;
        drawVideoCrop(ctx, popoverVideo, { cx: card.bx, cy: card.by, w: card.bw, h: card.bh }, card.curRect, lerp(8, 10, p), { alpha: 0.98, role: card.box.role, now });
        drawHudCardFrame(ctx, card.curRect, hudColor, tag, lerp(8, 10, p), p < 0.78, 0.96);
      }

      drawInwardCompressFrame(ctx, lerpRect(srcFrame, dstFrame, p), 1 - p * 0.72, u);
    }

    // AI detection laser sweep during the first moments of each cycle.
    if (u < 0.25) {
      const sy = srcFrame.y + (u / 0.25) * srcFrame.h;
      const scanGrad = ctx.createLinearGradient(srcFrame.x, sy - 16, srcFrame.x, sy + 16);
      scanGrad.addColorStop(0, 'transparent');
      scanGrad.addColorStop(0.5, 'rgba(37, 230, 255, 0.34)');
      scanGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(srcFrame.x, sy - 16, srcFrame.w, 32);
    }

    // Subtle assembled final glow when transformation settles at p > 0.75.
    if (p > 0.75) {
      ctx.save();
      ctx.globalAlpha = (p - 0.75) * 4;
      ctx.strokeStyle = 'rgba(25, 211, 140, 0.85)';
      ctx.lineWidth = 2;
      roundedRectPath(ctx, dstFrame.x - 1, dstFrame.y - 1, dstFrame.w + 2, dstFrame.h + 2, 12);
      ctx.stroke();
      ctx.restore();
    }
  }

  function startPopoverMorphLoop() {
    if (popoverRaf || framingPopover.hidden) return;
    const step = (now) => {
      renderMorphFrame(now);
      if (!framingPopover.hidden && popoverItem) popoverRaf = requestAnimationFrame(step);
      else popoverRaf = null;
    };
    popoverRaf = requestAnimationFrame(step);
  }

  function positionFramingPopover(index) {
    if (framingPopover.hidden) return;
    const dockRect = timelineDock.getBoundingClientRect();
    const box = timelineBoxesMap.get(index);
    if (!dockRect.width || !box) return;
    const boxRect = box.getBoundingClientRect();
    const popWidth = framingPopover.offsetWidth || Math.min(560, window.innerWidth - 32);
    const half = popWidth / 2;
    const boxCenter = boxRect.left + boxRect.width / 2 - dockRect.left;
    const clampedCenter = Math.max(half + 6, Math.min(dockRect.width - half - 6, boxCenter));
    const tailX = Math.max(24, Math.min(popWidth - 24, half + (boxCenter - clampedCenter)));
    framingPopover.style.setProperty('--anchor-x', `${Math.round(clampedCenter)}px`);
    framingPopover.style.setProperty('--tail-x', `${Math.round(tailX)}px`);
  }

  function openFramingPopover(job, item, autoMode = true) {
    if (!job || !item || currentView !== 'editor') return;
    clearWaterDropTimers();
    waterDropActive = Boolean(autoMode);

    const layout = item.framing?.layout || 'fill';
    const ratio = item.ratio || job.format?.ratio || '9:16';
    const layoutText = layoutNames[layout] || (item.stage === 'scanning' ? 'Analizando escena' : 'Encuadre inteligente');
    const boxes = deriveFramingBoxes(item);

    popoverItem = item;
    popoverJobMeta = { layout, ratio, fitCrop: job.format?.fitCrop || 'original', boxes };
    popoverAnimStart = performance.now();
    lastMorphHudKey = '';
    morphCanvasSize = '';

    for (const [idx, box] of timelineBoxesMap.entries()) {
      box.classList.toggle('is-drop-origin', idx === item.index);
    }

    framingPopover.hidden = false;
    framingPopover.style.setProperty('--drop-duration', `${MORPH_TOTAL_MS}ms`);
    framingPopover.classList.remove('is-closing', 'is-opening', 'is-auto-drop');
    void framingPopover.offsetWidth;
    framingPopover.classList.add('is-opening', 'is-auto-drop');
    if (waterDropTimerTrack) waterDropTimerTrack.hidden = false;

    popoverClipNum.textContent = `#${String(item.index).padStart(2, '0')}`;
    popoverLayoutPill.textContent = `${layoutText} · ${ratio}`;
    popoverStagePill.textContent = `Ciclo 1 / ${MORPH_TOTAL_CYCLES}`;
    popoverClipTitle.textContent = item.title;
    popoverReason.textContent = item.framing?.reason || 'Recorte inteligente aplicado automáticamente sobre la escena.';

    const canLoadVideo = Boolean(job.sourceReady || (job.stage && job.stage !== 'downloading'));
    const nextVideoSrc = canLoadVideo ? `/media/${job.id}/source#t=${item.start.toFixed(1)},${item.end.toFixed(1)}` : '';
    if (nextVideoSrc && popoverVideo.dataset.clipSrc !== nextVideoSrc) {
      popoverVideo.dataset.clipSrc = nextVideoSrc;
      popoverVideo.src = nextVideoSrc;
      popoverVideo.play().catch(() => {});
    } else if (popoverVideo.src) {
      if (popoverVideo.readyState >= 1 && (popoverVideo.currentTime < item.start - 0.5 || popoverVideo.currentTime >= item.end)) {
        popoverVideo.currentTime = item.start;
      }
      if (popoverVideo.paused) popoverVideo.play().catch(() => {});
    }

    renderMorphFrame(popoverAnimStart);
    startPopoverMorphLoop();
    requestAnimationFrame(() => positionFramingPopover(item.index));

    waterDropHoldTimer = setTimeout(() => {
      framingPopover.classList.remove('is-opening');
      framingPopover.classList.add('is-closing');
      waterDropCloseTimer = setTimeout(() => {
        finishHideFramingPopover();
        waterDropActive = false;
        waterDropNextTimer = setTimeout(() => {
          processWaterDropQueue();
        }, 320);
      }, 520);
    }, MORPH_TOTAL_MS);
  }

  function closeClipSpotlight() {
    spotlightIndex = null;
    spotlightItem = null;
    try { spotlightVideo.pause(); } catch { /* Ignore video pause errors. */ }
    nleDeck.classList.remove('has-spotlight');
    spotlightPanel.classList.remove('is-switching');
    spotlightPanel.setAttribute('aria-hidden', 'true');
    for (const entry of clipCardElsMap.values()) entry.card.classList.remove('is-selected');
    for (const box of timelineBoxesMap.values()) box.classList.remove('is-active');
  }

  function updateCardVideoSource(entry, job, item) {
    const { video, stageBadge, statusPill, pubBtn, downloadLink, subLink } = entry;
    const layout = layoutNames[item.framing?.layout];
    if (spotlightIndex === item.index) refreshSpotlightContent(job, item);
    if (item.rendered && item.file) {
      const address = `/media/${job.id}/${item.file}`;
      if (video.dataset.mode !== 'rendered' || video.dataset.file !== item.file) {
        video.dataset.mode = 'rendered';
        video.dataset.file = item.file;
        video.classList.remove('is-live-preview');
        video.classList.add('is-rendered-clip');
        video.loop = true;
        video.muted = true;
        video.controls = false;
        video.src = address;
      }
      stageBadge.textContent = isSummary(job) ? `16:9 · ${longClock(job.summary?.outputSeconds)}` : (layout ? `${item.ratio} · ${layout}` : item.ratio);
      statusPill.textContent = 'MP4 listo';
      statusPill.classList.add('is-rendered');
      pubBtn.disabled = false;
      downloadLink.href = address;
      downloadLink.download = item.file;
      downloadLink.setAttribute('aria-disabled', 'false');
      subLink.href = address.replace(/\.mp4$/, '.ass');
      subLink.download = item.file.replace(/\.mp4$/, '.ass');
      subLink.setAttribute('aria-disabled', 'false');
      return;
    }

    if (isSummary(job)) {
      const progress = job.summaryProgress;
      stageBadge.textContent = progress ? `Tramo ${progress.done}/${progress.total}` : 'Preparando';
      statusPill.textContent = 'Montando…';
      statusPill.classList.remove('is-rendered');
      pubBtn.disabled = true;
      downloadLink.removeAttribute('href');
      downloadLink.setAttribute('aria-disabled', 'true');
      subLink.removeAttribute('href');
      subLink.setAttribute('aria-disabled', 'true');
      return;
    }
    const canPreviewSource = Boolean(job.sourceReady || (job.stage && job.stage !== 'downloading'));
    if (canPreviewSource && video.dataset.mode !== 'live') {
      video.dataset.mode = 'live';
      video.classList.remove('is-rendered-clip');
      video.classList.add('is-live-preview');
      video.muted = true;
      video.loop = true;
      video.controls = false;
      video.src = `/media/${job.id}/source#t=${item.start.toFixed(1)},${item.end.toFixed(1)}`;
    }
    stageBadge.textContent = `Previa ${item.ratio}`;
    statusPill.textContent = canPreviewSource ? 'Previa en vivo' : 'Preparando…';
    statusPill.classList.remove('is-rendered');
    pubBtn.disabled = true;
    downloadLink.removeAttribute('href');
    downloadLink.setAttribute('aria-disabled', 'true');
    subLink.removeAttribute('href');
    subLink.setAttribute('aria-disabled', 'true');
  }

  function createClipCard(job, item) {
    const card = document.createElement('article');
    card.className = 'job-clip';
    card.innerHTML = `
      <div class="job-clip-top">
        <div class="job-clip-badges">
          <span class="clip-num-pill"></span>
          <span class="clip-ratio-pill"></span>
          <span class="clip-score-pill" hidden></span>
          <span class="clip-cat-pill" hidden></span>
          <span class="job-clip-times"></span>
          <span class="clip-status-pill"></span>
        </div>
        <h4 class="job-clip-title"></h4>
      </div>
      <div class="clip-format-stage">
        <video preload="metadata" playsinline></video>
        <span class="clip-stage-badge"></span>
      </div>
      <div class="job-clip-footer">
        <p class="job-clip-reason"></p>
        <div class="job-clip-actions">
          <button type="button" class="top-link clip-publication">Ficha</button>
          <a class="top-link">MP4</a>
          <a class="top-link">ASS</a>
        </div>
      </div>
    `;

    card.querySelector('.clip-num-pill').textContent = `#${String(item.index).padStart(2, '0')}`;
    card.querySelector('.clip-ratio-pill').textContent = item.ratio;
    const scorePill = card.querySelector('.clip-score-pill');
    if (Number.isFinite(item.score)) {
      scorePill.textContent = `★ ${item.score.toFixed(1)}`;
      scorePill.hidden = false;
    }
    const catPill = card.querySelector('.clip-cat-pill');
    if (item.category) {
      catPill.textContent = item.category;
      catPill.hidden = false;
    }
    card.querySelector('.job-clip-times').textContent = `${time(item.start)}–${time(item.end)} · ${Math.round(item.end - item.start)} s`;
    card.querySelector('.job-clip-title').textContent = item.title;
    card.querySelector('.job-clip-reason').textContent = item.reason;
    if (isSummary(job)) {
      card.classList.add('is-summary');
      card.querySelector('.clip-num-pill').textContent = 'RESUMEN';
      card.querySelector('.clip-ratio-pill').textContent = '16:9';
      card.querySelector('.job-clip-times').textContent = job.summary ? `${longClock(job.summary.outputSeconds)} de ${longClock(job.summary.sourceSeconds)}` : 'Vídeo resumido';
      card.querySelector('.clip-cat-pill').hidden = true;
    }

    const stageEl = card.querySelector('.clip-format-stage');
    stageEl.dataset.ratio = item.ratio || '9:16';

    const video = card.querySelector('video');
    video.setAttribute('aria-label', item.title);
    video.addEventListener('timeupdate', () => {
      if (video.dataset.mode !== 'live') return;
      if (video.currentTime < item.start - 0.6 || video.currentTime >= item.end) {
        video.currentTime = item.start;
      }
    });
    video.addEventListener('loadedmetadata', () => {
      if (video.dataset.mode === 'live' && video.currentTime < item.start - 0.6) {
        video.currentTime = item.start;
      }
    });

    const statusPill = card.querySelector('.clip-status-pill');
    const stageBadge = card.querySelector('.clip-stage-badge');
    const pubBtn = card.querySelector('.clip-publication');
    const [downloadLink, subLink] = card.querySelectorAll('.job-clip-actions a');

    const entry = { card, video, statusPill, stageBadge, pubBtn, downloadLink, subLink, item };
    pubBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (entry.item.renderedClip) openClipPublication(job.id, entry.item.renderedClip);
    });
    for (const link of [downloadLink, subLink]) {
      link.addEventListener('click', (event) => event.stopPropagation());
    }
    card.addEventListener('click', () => {
      if (currentJobData) openClipSpotlight(currentJobData, entry.item);
    });
    card.addEventListener('mouseenter', () => {
      highlightTimelineClip(entry.item.index, false);
      if (video.src && video.paused) video.play().catch(() => {});
    });
    card.addEventListener('mouseleave', () => {
      if (!video.paused) video.pause();
    });
    updateCardVideoSource(entry, job, item);
    return entry;
  }

  function updateViralScanner(job, lockingItem = null) {
    if (!viralSearchScanner) return;
    clearTimeout(viralHideTimer);
    if (isSummary(job)) {
      const searching = ['loading', 'selecting'].includes(job.stage) && !job.summary;
      viralSearchScanner.hidden = !searching;
      viralSearchScanner.classList.remove('is-locking');
      viralSearchScanner.classList.toggle('is-sweeping', searching);
      if (searching) {
        viralSearchScanner.style.left = '';
        viralSearchScanner.style.width = '12%';
        viralScannerTag.textContent = job.stage === 'loading' ? 'ANALIZANDO EL AUDIO…' : 'ELIGIENDO LOS PASAJES CLAVE…';
      }
      return;
    }
    if (lockingItem) {
      viralLockedUntil = Date.now() + 300;
      const duration = projectVideo.duration || job.duration || (lastSegments.at(-1)?.end ?? 0) || 1;
      const left = Math.max(0.5, Math.min(96, (lockingItem.start / duration) * 100));
      const width = Math.max(2.5, Math.min(99 - left, ((lockingItem.end - lockingItem.start) / duration) * 100));
      viralSearchScanner.hidden = false;
      viralSearchScanner.classList.remove('is-sweeping');
      viralSearchScanner.classList.remove('is-locking');
      void viralSearchScanner.offsetWidth;
      viralSearchScanner.classList.add('is-locking');
      viralSearchScanner.style.left = `${left.toFixed(2)}%`;
      viralSearchScanner.style.width = `${width.toFixed(2)}%`;
      viralScannerTag.textContent = `¡CLIP #${String(lockingItem.index).padStart(2, '0')} ENCONTRADO!`;
      return;
    }
    if (Date.now() < viralLockedUntil && job.stage !== 'done' && job.stage !== 'error') return;
    const items = getProjectClipItems(job);
    const stillSearching = job.stage === 'loading' || job.stage === 'selecting' || (job.stage !== 'done' && job.stage !== 'error' && revealedClipCount < items.length);
    if (!stillSearching) {
      viralSearchScanner.hidden = true;
      viralSearchScanner.classList.remove('is-sweeping', 'is-locking');
      return;
    }
    viralSearchScanner.hidden = false;
    viralSearchScanner.classList.remove('is-locking');
    viralSearchScanner.classList.add('is-sweeping');
    viralSearchScanner.style.left = '';
    viralSearchScanner.style.width = '12%';
    viralScannerTag.textContent = job.stage === 'loading' ? 'MIDIENDO PICOS DE ENERGÍA…' : 'IA BUSCANDO CLIPS VIRALES…';
  }

  function syncRevealQueue(job) {
    if (revealJobId !== job.id) {
      revealJobId = job.id;
      clearTimeout(revealTimer);
      clearTimeout(viralHideTimer);
      revealTimer = null;
      revealedClipCount = 0;
    }
    const items = getProjectClipItems(job);
    if (isSummary(job)) {
      revealedClipCount = items.length;
      return;
    }
    if (revealedClipCount >= items.length || revealTimer) return;

    const liveSearch = job.stage !== 'done' && job.stage !== 'error';
    const stepDelay = liveSearch ? 620 : 280;
    const initialDelay = revealedClipCount === 0 ? 180 : stepDelay;
    const advance = () => {
      revealTimer = null;
      if (!currentJobData || currentJobData.id !== job.id) return;
      const latestItems = getProjectClipItems(currentJobData);
      if (revealedClipCount >= latestItems.length) return;
      const nextItem = latestItems[revealedClipCount];

      const commitBox = () => {
        if (!currentJobData || currentJobData.id !== job.id) return;
        revealedClipCount++;
        renderTimelineMarkers(currentJobData, getEffectiveDuration(currentJobData));
        renderProjectClips(currentJobData);
        if (revealedClipCount < latestItems.length) {
          if (liveSearch) updateViralScanner(currentJobData, null);
          revealTimer = setTimeout(advance, stepDelay);
        } else if (liveSearch && viralSearchScanner) {
          viralScannerTag.textContent = `✓ ${latestItems.length} CLIPS DETECTADOS`;
          viralHideTimer = setTimeout(() => {
            if (currentJob === job.id) {
              viralSearchScanner.hidden = true;
              viralSearchScanner.classList.remove('is-sweeping', 'is-locking');
            }
          }, 1250);
        }
      };

      if (liveSearch && nextItem) {
        updateViralScanner(currentJobData, nextItem);
        revealTimer = setTimeout(commitBox, 280);
      } else {
        commitBox();
      }
    };
    revealTimer = setTimeout(advance, initialDelay);
  }

  function renderProjectClips(job) {
    if (renderedClipJobId !== job.id) {
      renderedClipJobId = job.id;
      clipCardElsMap.clear();
      results.replaceChildren();
    }
    const allItems = getProjectClipItems(job);
    const renderedTotal = allItems.filter((item) => item.rendered).length;
    byId('job-clip-count').textContent = isSummary(job)
      ? (renderedTotal ? '1 vídeo' : (allItems.length ? 'Montando…' : 'Preparando'))
      : (allItems.length
        ? `${renderedTotal}/${allItems.length} clips`
        : '0 clips');

    const visibleItems = allItems.slice(0, revealedClipCount);
    clipsStatus.hidden = visibleItems.length > 0;
    if (!visibleItems.length) {
      clipsStatus.textContent = allItems.length
        ? 'Revelando tramos seleccionados uno a uno…'
        : (job.stage === 'done'
          ? 'Este proyecto finalizó sin clips exportados.'
          : (isSummary(job) ? 'El resumen aparecerá aquí en cuanto termine el montaje…' : 'Los clips de esta URL aparecerán aquí automáticamente en cuanto la IA los seleccione…'));
      return;
    }

    let grid = results.querySelector('.job-clips');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'job-clips';
      results.append(grid);
    }
    for (const item of visibleItems) {
      let entry = clipCardElsMap.get(item.index);
      if (!entry) {
        entry = createClipCard(job, item);
        clipCardElsMap.set(item.index, entry);
        grid.append(entry.card);
      } else {
        entry.item = item;
        updateCardVideoSource(entry, job, item);
      }
    }
  }

  let drawerUploads = {};
  let drawerBatch = null;
  let connectingChannel = false;
  let publishPollTimer = null;

  function updateYouTubeChannelPill() {
    const channel = youtubeDestination.selected();
    const data = youtubeDestination.state();
    ytChannelPill.classList.toggle('is-connected', Boolean(channel));
    ytChannelPill.textContent = channel
      ? `Canal de destino: ${channel.title}`
      : (data.connected ? 'Elige el canal de destino.' : `YouTube: ${data.reason || 'Sin conectar'}`);
    connectChannelButton.disabled = !serverAvailable || !data.hasCredentials || connectingChannel;
    publishAllButton.disabled = !serverAvailable || !channel || Boolean(drawerBatch?.running);
    applyUploadBadgesToDrawer();
  }
  document.addEventListener('corte-youtube-channel', updateYouTubeChannelPill);

  connectChannelButton.addEventListener('click', async () => {
    if (connectChannelButton.disabled || connectingChannel) return;
    connectingChannel = true;
    updateYouTubeChannelPill();
    try {
      const response = await fetch('/api/youtube/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!response.ok) throw new Error();
      let connection = await response.json();
      drawerAutoNote.textContent = connection.message || '';
      while (connection.running) {
        await new Promise((resolve) => setTimeout(resolve, 1800));
        const status = await fetch('/api/youtube/connect');
        if (!status.ok) throw new Error();
        connection = await status.json();
      }
      await youtubeDestination.refresh();
      drawerAutoNote.textContent = connection.error || connection.message || 'Conexión finalizada.';
    } catch {
      drawerAutoNote.textContent = 'No se pudo conectar el canal de YouTube.';
    } finally {
      connectingChannel = false;
      updateYouTubeChannelPill();
    }
  });

  function applyUploadBadgesToDrawer() {
    for (const card of drawerClipList.querySelectorAll('.drawer-clip-card')) {
      const file = card.dataset.file;
      const badge = card.querySelector('.drawer-clip-upload-badge');
      const [autoBtn] = card.querySelectorAll('button');
      const rec = drawerUploads[file];
      if (!badge) continue;
      if (!rec?.videoId) {
        if (autoBtn.dataset.uploading !== 'true') autoBtn.disabled = !youtubeDestination.selected();
        continue;
      }
      const when = rec.publishAt === 'public' || rec.privacyStatus === 'public'
        ? 'Publicado YA'
        : `Programado ${historyDate.format(new Date(rec.publishAt))}`;
      badge.innerHTML = '';
      const txt = document.createElement('span');
      const channelTitle = rec.channelTitle ?? youtubeDestination.state().channels?.find((channel) => channel.channelId === rec.channelId)?.title;
      txt.textContent = channelTitle ? `${when} · ${channelTitle}` : when;
      const link = document.createElement('a');
      link.href = rec.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Ver Short ↗';
      badge.append(txt, link);
      badge.hidden = false;
      autoBtn.disabled = true;
      autoBtn.querySelector('span').textContent = 'Subido';
    }
  }

  async function syncDrawerUploads(jobId) {
    if (!serverAvailable || !jobId) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/uploads`);
      if (!res.ok) return;
      const { uploads, batch } = await res.json();
      if (drawerJobId !== jobId) return;
      drawerBatch = batch;
      drawerUploads = uploads || {};
      applyUploadBadgesToDrawer();
      if (batch) {
        drawerAutoNote.textContent = batch.message || '';
        publishAllButton.disabled = !youtubeDestination.selected() || Boolean(batch.running);
        if (batch.running && !publishPollTimer) {
          publishPollTimer = setTimeout(() => {
            publishPollTimer = null;
            if (drawerJobId === jobId) void syncDrawerUploads(jobId);
          }, 1800);
        }
      } else {
        publishAllButton.disabled = !youtubeDestination.selected();
      }
    } catch { /* Ignore temporary poll errors */ }
  }

  function updatePublishDrawer(job) {
    if (drawerJobId !== job.id) {
      drawerJobId = job.id;
      drawerFiles = new Set();
      drawerUploads = {};
      drawerBatch = null;
      if (publishPollTimer) { clearTimeout(publishPollTimer); publishPollTimer = null; }
      drawerClipList.replaceChildren();
      drawerAutoNote.textContent = engines?.exportDir ? `Todos los vídeos terminados también están en: ${engines.exportDir}` : '';
      void youtubeDestination.refresh();
      void syncDrawerUploads(job.id);
    }
    const clips = job.clips ?? [];
    const hasClips = clips.length > 0;
    toggleDrawerButton.hidden = !hasClips || currentView !== 'editor';
    openDrawerButton.hidden = !hasClips;
    drawerClipCount.textContent = isSummary(job) ? (clips.length ? '1 vídeo' : '0 vídeos') : clipCount(clips.length);

    for (const clip of clips) {
      if (drawerFiles.has(clip.file)) continue;
      drawerFiles.add(clip.file);
      const card = document.createElement('article');
      card.className = 'drawer-clip-card';
      card.dataset.file = clip.file;
      card.innerHTML = `
        <div class="drawer-clip-head">
          <h3></h3>
          <p class="drawer-clip-meta"></p>
        </div>
        <video controls preload="metadata" playsinline></video>
        <div class="drawer-clip-body">
          <div class="drawer-clip-upload-badge" hidden></div>
          <div class="drawer-clip-actions">
            <button type="button" class="auto-publish-btn"><svg><use href="#i-rocket"/></svg><span>Publicar automático</span></button>
            <button type="button" class="top-link">Ficha SEO</button>
          </div>
        </div>
      `;
      const video = card.querySelector('video');
      video.src = `/media/${job.id}/${clip.file}`;
      video.setAttribute('aria-label', clip.title);
      card.querySelector('h3').textContent = clip.title;
      const layout = layoutNames[clip.framing?.layout];
      const metaParts = isSummary(job) ? [longClock(clip.duration ?? (clip.end - clip.start)), '16:9', 'Vídeo largo con capítulos'] : [
        Number.isFinite(clip.score) ? `★ ${clip.score.toFixed(1)}` : null,
        clip.category ? clip.category.toUpperCase() : null,
        `${time(clip.start)}–${time(clip.end)} (${Math.round(clip.end - clip.start)}s)`,
        clip.ratio ?? '9:16',
        layout || null,
      ].filter(Boolean);
      card.querySelector('.drawer-clip-meta').textContent = metaParts.join(' · ');
      const [autoBtn, editBtn] = card.querySelectorAll('button');
      const autoLabel = isSummary(job) ? 'Subir a YouTube' : 'Publicar automático';
      autoBtn.querySelector('span').textContent = autoLabel;
      if (isSummary(job)) editBtn.textContent = 'Título y descripción';
      autoBtn.addEventListener('click', async () => {
        if (!serverAvailable || autoBtn.disabled) return;
        const channel = youtubeDestination.selected();
        if (!channel) return;
        autoBtn.dataset.uploading = 'true';
        autoBtn.disabled = true;
        autoBtn.querySelector('span').textContent = isSummary(job) ? 'Subiendo…' : 'Analizando SEO…';
        drawerAutoNote.textContent = isSummary(job) ? `Subiendo «${clip.title}» a YouTube con sus capítulos…` : `Analizando «${clip.title}» y publicando en YouTube con SEO pro…`;
        try {
          const res = await fetch(`/api/jobs/${job.id}/publication/${clip.file}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: engineInput.value, model: modelInput.value, channelId: channel.channelId,
              immediate: true, forceSeo: Boolean(publishReanalyzeCheck?.checked) && !isSummary(job) }),
          });
          const out = await res.json();
          if (!res.ok) {
            drawerAutoNote.textContent = out.error || 'No se pudo publicar este clip.';
            autoBtn.disabled = false;
            autoBtn.querySelector('span').textContent = 'Publicar automático';
            return;
          }
          drawerAutoNote.textContent = `Publicado en YouTube: ${out.url}`;
          await syncDrawerUploads(job.id);
        } catch {
          drawerAutoNote.textContent = 'Error de conexión al publicar.';
          autoBtn.disabled = false;
          autoBtn.querySelector('span').textContent = 'Publicar automático';
        } finally {
          delete autoBtn.dataset.uploading;
          autoBtn.disabled = !youtubeDestination.selected() || Boolean(drawerUploads[clip.file]?.videoId);
        }
      });
      editBtn.addEventListener('click', () => openClipPublication(job.id, clip));
      drawerClipList.append(card);
    }
    applyUploadBadgesToDrawer();

    if (job.stage === 'done' && hasClips && currentView === 'editor' && drawerAutoOpenedFor !== job.id && !isSummary(job)) {
      drawerAutoOpenedFor = job.id;
      setDrawerOpen(true);
    }
  }

  function updateSteps(stage, job) {
    const failedStep = stage === 'error' && Number.isInteger(job?.resumeStep)
      ? Math.min(4, Math.max(0, job.resumeStep))
      : null;
    currentStep = failedStep ?? stages[stage] ?? currentStep;
    for (const [index, step] of steps.entries()) {
      step.classList.toggle('complete', index < currentStep);
      step.classList.toggle('active', stage !== 'error' && index === currentStep);
      step.classList.toggle('failed', stage === 'error' && index === currentStep);
      if (index === currentStep) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    }
  }

  async function loadTranscript(id) {
    if (transcriptLoaded) return;
    try {
      const response = await fetch(`/api/jobs/${id}/transcript`);
      if (!response.ok || currentJob !== id) return;
      const { segments } = await response.json();
      if (currentJob !== id) return;
      transcriptLoaded = true;
      lastSegments = segments;
      if (!segments.length) return;

      const entries = document.createDocumentFragment();
      for (const segment of segments) {
        const row = document.createElement('p');
        const stamp = document.createElement('span');
        stamp.className = 'segment-time';
        stamp.textContent = `${time(segment.start)}–${time(segment.end)}`;
        const line = document.createElement('span');
        line.textContent = segment.text;
        row.append(stamp, line);
        entries.append(row);
      }
      transcriptList.replaceChildren(entries);
      byId('job-transcript-count').textContent = `${segments.length} segmentos`;
      transcriptDetails.hidden = false;
      if (currentJobData?.id === id) updateAudioTimeline(currentJobData);
    } catch { /* Transcript stays hidden until available. */ }
  }

  function showJob(job) {
    const isNewJob = currentJob !== job.id;
    if (isNewJob) {
      currentJob = job.id;
      currentStep = 0;
      transcriptLoaded = false;
      lastSegments = [];
      loadedSourceJob = null;
      materializedJob = null;
      waveformRenderedJob = null;
      waveBarEls = [];
      renderedVoiceKey = '';
      renderedSummaryKey = '';
      renderedChaptersKey = '';
      timelineBoxesMap.clear();
      timelineDock.classList.remove('is-summary', 'summary-done');
      voiceSegmentsEl.replaceChildren();
      shownDropClips.clear();
      waterDropQueue.length = 0;
      clearWaterDropTimers();
      drawerAutoOpenedFor = null;
      transcriptDetails.hidden = true;
      transcriptDetails.open = false;
      projectVideo.removeAttribute('src');
      projectVideo.load();
      projectVideo.hidden = true;
      projectMonitor.classList.remove('has-video', 'is-materializing');
      playheadEl.classList.remove('is-active');
      playheadEl.style.left = '0%';
      setDrawerOpen(false);
      closeClipSpotlight();
      closeFramingPopover(false);
      stopDataStreamLoop();
      clearTimeout(viralHideTimer);
      packetCount = 0;
      viralLockedUntil = 0;
      popoverDismissedKey = '';
      if (job.stage === 'done' || job.stage === 'error') {
        for (let i = 1; i <= (job.clips?.length || 0); i++) shownDropClips.add(i);
      }
    }
    currentJobData = job;
    document.body.dataset.jobMode = job.mode || 'normal';
    applyModeLabels(job);

    byId('job-title').textContent = job.title || 'Proyecto de vídeo';
    if (jobModeBadge) {
      jobModeBadge.hidden = !['prototype', 'summary'].includes(job.mode);
      jobModeBadge.classList.toggle('is-summary-badge', job.mode === 'summary');
      if (job.mode === 'summary') {
        const clock = (seconds) => {
          const total = Math.max(0, Math.floor(seconds || 0));
          const h = Math.floor(total / 3600);
          const m = Math.floor(total / 60) % 60;
          return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(total % 60).padStart(2, '0')}`;
        };
        const info = job.summary;
        jobModeBadge.textContent = info
          ? `Resumen · ${clock(info.outputSeconds)} de ${clock(info.sourceSeconds)}${info.chapters?.length ? ` · ${info.chapters.length} capítulos` : ''}${info.cardCount ? ` · ${info.cardCount} tarjetas` : ''}`
          : 'Resumen · Vídeo largo 16:9';
      } else {
        jobModeBadge.textContent = 'Prototipo · Sin cámara · Voz IA';
      }
    }
    const src = sourceFromJob(job);
    const sourceUrl = job.url || src.url;
    if (sourceUrl) {
      jobUrlChip.href = sourceUrl;
      jobUrlChip.textContent = src.label || sourceUrl;
      jobUrlChip.hidden = false;
    } else {
      jobUrlChip.hidden = true;
    }

    const engineLine = byId('job-engine');
    engineLine.textContent = job.localModel
      ? `${job.localModel} · llama.cpp`
      : (job.provider === 'openrouter' ? `OpenRouter · ${job.engineLabel || 'Particle 1 (gratis)'}` : 'Gemini 4 Hydrogen · Medium');
    engineLine.hidden = !job.provider;

    const outcome = job.stage === 'done' ? 'Terminado' : (job.stage === 'error' ? 'Interrumpido' : 'En tiempo real');
    byId('job-state').textContent = outcome;
    byId('job-state').dataset.stage = job.stage;
    if (byId('job-status').textContent !== job.message) byId('job-status').textContent = job.message;

    syncRevealQueue(job);
    updateEditorVersionSelector(job);
    updateSteps(job.stage, job);
    updateProjectMonitor(job);
    updateAudioTimeline(job);
    updateViralScanner(job, null);
    renderProjectClips(job);
    renderSummaryPanel(job);
    updatePublishDrawer(job);
    renderProjectsMenu();

    if (isSummary(job) && job.stage === 'done' && currentView === 'editor' && summaryAutoOpened !== job.id) {
      const result = getProjectClipItems(job)[0];
      if (result?.rendered) {
        summaryAutoOpened = job.id;
        openClipSpotlight(job, result);
      }
    }

    if (currentView === 'editor' && !isSummary(job)) {
      const items = getProjectClipItems(job);
      if (!isNewJob) {
        for (const item of items) {
          if (item.rendered && !shownDropClips.has(item.index)) {
            enqueueWaterDrop(job, item);
          }
        }
        if (job.lastExportedClip && !shownDropClips.has(job.lastExportedClip.index)) {
          enqueueWaterDrop(job, job.lastExportedClip);
        }
      }
      if (waterDropQueue.length && !waterDropActive) processWaterDropQueue();
    }

    if (['loading', 'selecting', 'framing', 'rendering', 'editorial', 'done', 'error'].includes(job.stage)) {
      void loadTranscript(job.id);
    }
    const finished = job.stage === 'done' || job.stage === 'error';
    setControls(!finished);
    return finished;
  }

  function stopStreams() {
    clearTimeout(poll);
    poll = null;
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  function followJob(id, focusResult = false) {
    stopStreams();
    pollingFailures = 0;
    const version = ++viewVersion;

    const handleSnapshot = (job) => {
      if (version !== viewVersion) return;
      pollingFailures = 0;
      const finished = showJob(job);
      if (focusResult) {
        byId('job-title').focus({ preventScroll: true });
        focusResult = false;
      }
      if (finished) {
        stopStreams();
        void loadHistory();
      }
    };

    const pollOnce = async () => {
      if (version !== viewVersion) return;
      try {
        const response = await fetch(`/api/jobs/${id}`);
        if (version !== viewVersion) return;
        if (response.status === 404) {
          stopStreams();
          historyStatus.textContent = 'Este proyecto ya no está disponible.';
          return;
        }
        if (!response.ok) throw new Error();
        const job = await response.json();
        handleSnapshot(job);
        if (job.stage !== 'done' && job.stage !== 'error') {
          poll = setTimeout(pollOnce, eventSource?.readyState === EventSource.OPEN ? 4000 : 800);
        }
      } catch {
        if (version !== viewVersion) return;
        if (++pollingFailures >= 6) {
          stopStreams();
          setControls(false);
          setNote('Se perdió la conexión en tiempo real con el estudio.', { error: true });
        } else {
          poll = setTimeout(pollOnce, 1200);
        }
      }
    };

    if (typeof EventSource === 'function') {
      eventSource = new EventSource(`/api/jobs/${id}/events`);
      eventSource.onmessage = (event) => {
        try {
          handleSnapshot(JSON.parse(event.data));
        } catch { /* Ignore malformed SSE packet. */ }
      };
      eventSource.onerror = () => {
        if (!poll && version === viewVersion) poll = setTimeout(pollOnce, 700);
      };
    }

    void pollOnce();
  }

  async function cancelAllProcesses() {
    if (!serverAvailable) return;
    cancelSourceButton.disabled = true;
    cancelJobButton.disabled = true;
    cancelSourceButton.textContent = 'Cancelando…';
    cancelJobButton.textContent = 'Cancelando…';
    stopStreams();
    ++viewVersion;
    try {
      const response = await fetch('/api/jobs/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (data.job) showJob(data.job);
      else setControls(false);
      setNote(data.cancelled ? 'Todos los procesos han sido cancelados.' : 'No había procesos activos.');
      void loadHistory();
    } catch {
      setNote('No se pudieron cancelar los procesos. Revisa que el servidor siga abierto.', { error: true });
      setControls(busy);
    } finally {
      cancelSourceButton.textContent = 'Cancelar todo';
      cancelJobButton.textContent = 'Cancelar todo';
    }
  }

  projectVideo.addEventListener('loadedmetadata', () => {
    if (!currentJobData) return;
    projectMonitor.classList.add('has-video');
    triggerMaterialization(currentJobData.id);
    applyPlaybackRate(currentJobData);
    if (currentView === 'editor') projectVideo.play().catch(() => {});
    startPlayheadLoop();
    updateAudioTimeline(currentJobData);
  });
  projectVideo.addEventListener('play', startPlayheadLoop);
  projectVideo.addEventListener('timeupdate', syncPlayhead);
  projectVideo.addEventListener('error', () => {
    projectMonitor.classList.remove('has-video', 'is-materializing');
    projectVideo.hidden = true;
    projectSpeedBadge.lastElementChild.textContent = 'VISTA PREVIA NO COMPATIBLE';
  });

  toggleSpeedButton.addEventListener('click', () => {
    monitorSpeedMode = monitorSpeedMode === 'auto' ? 'normal' : 'auto';
    if (currentJobData) applyPlaybackRate(currentJobData);
  });

  timelineTrackEl.addEventListener('click', (event) => {
    const duration = projectVideo.duration || currentJobData?.duration || 0;
    if (!duration || !projectMonitor.classList.contains('has-video')) return;
    const rect = timelineTrackEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    projectVideo.currentTime = ratio * duration;
    syncPlayhead();
  });

  timelineTrackEl.addEventListener('keydown', (event) => {
    const duration = projectVideo.duration || currentJobData?.duration || 0;
    if (!duration || !projectMonitor.classList.contains('has-video')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 5 : -5;
    projectVideo.currentTime = Math.max(0, Math.min(duration, (projectVideo.currentTime || 0) + step));
    syncPlayhead();
  });

  brandHomeBtn.addEventListener('click', () => {
    setDropdownOpen(false);
    switchView('home');
  });
  backToHomeBtn.addEventListener('click', () => {
    setDropdownOpen(false);
    switchView('home');
  });
  activeJobBanner.addEventListener('click', () => {
    const id = activeJobBanner.dataset.jobId;
    if (id) openProjectInEditor(id);
  });

  projectsBtn.addEventListener('click', () => {
    const opening = projectsMenu.hidden;
    setDropdownOpen(opening);
    if (opening && serverAvailable) void loadHistory();
  });
  projectsFilter.addEventListener('input', renderProjectsMenu);
  document.addEventListener('click', (event) => {
    if (!projectsMenu.hidden && !projectsDropdown.contains(event.target)) {
      setDropdownOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!projectsMenu.hidden) setDropdownOpen(false);
    else if (!framingPopover.hidden) closeFramingPopover(true, true);
    else if (spotlightIndex !== null) closeClipSpotlight();
  });

  closeFramingPopoverBtn.addEventListener('click', () => closeFramingPopover(true, true));
  popoverVideo.addEventListener('loadedmetadata', () => {
    if (popoverItem && popoverVideo.currentTime < popoverItem.start - 0.5) {
      popoverVideo.currentTime = popoverItem.start;
    }
  });
  popoverVideo.addEventListener('timeupdate', () => {
    if (!popoverItem) return;
    if (popoverVideo.currentTime < popoverItem.start - 0.5 || popoverVideo.currentTime >= popoverItem.end) {
      popoverVideo.currentTime = popoverItem.start;
    }
  });
  window.addEventListener('resize', () => {
    if (popoverItem) positionFramingPopover(popoverItem.index);
  });

  closeSpotlightBtn.addEventListener('click', closeClipSpotlight);
  spotlightPubBtn.addEventListener('click', () => {
    if (currentJobData && spotlightItem?.renderedClip) openClipPublication(currentJobData.id, spotlightItem.renderedClip);
  });
  spotlightVideo.addEventListener('loadedmetadata', () => {
    if (spotlightVideo.dataset.mode === 'live' && spotlightItem && spotlightVideo.currentTime < spotlightItem.start - 0.6) {
      spotlightVideo.currentTime = spotlightItem.start;
    }
  });
  spotlightVideo.addEventListener('timeupdate', () => {
    if (spotlightVideo.dataset.mode !== 'live' || !spotlightItem) return;
    if (spotlightVideo.currentTime < spotlightItem.start - 0.6 || spotlightVideo.currentTime >= spotlightItem.end) {
      spotlightVideo.currentTime = spotlightItem.start;
    }
  });

  editorVersionSelect.addEventListener('change', () => {
    if (editorVersionSelect.value && editorVersionSelect.value !== currentJob) {
      followJob(editorVersionSelect.value, true);
    }
  });

  toggleDrawerButton.addEventListener('click', () => setDrawerOpen(publishDrawer.hidden));
  openDrawerButton.addEventListener('click', () => setDrawerOpen(true));
  closeDrawerButton.addEventListener('click', () => setDrawerOpen(false));
  publishAllButton.addEventListener('click', async () => {
    if (!currentJobData?.clips?.length) {
      drawerAutoNote.textContent = 'No hay clips generados en este proyecto todavía.';
      return;
    }
    if (!serverAvailable || publishAllButton.disabled) return;
    const channel = youtubeDestination.selected();
    if (!channel) return;
    const mode = publishIntervalSelect?.value || '1-first';
    const intervalHours = mode === '0' ? 0 : (mode === '2-all' ? 2 : 1);
    const publishFirstImmediately = mode === '1-first' || mode === '0';
    const jobId = currentJobData.id;
    drawerBatch = { running: true };
    publishAllButton.disabled = true;
    drawerAutoNote.textContent = isSummary(currentJobData) ? 'Subiendo el resumen a YouTube con sus capítulos…' : 'Iniciando análisis SEO 1 a 1 y subida automática a YouTube…';
    try {
      const res = await fetch(`/api/jobs/${jobId}/publish-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: engineInput.value,
          model: modelInput.value,
          channelId: channel.channelId,
          intervalHours,
          publishFirstImmediately,
          regenerateSeo: Boolean(publishReanalyzeCheck?.checked ?? true) && !isSummary(currentJobData),
        }),
      });
      const data = await res.json();
      if (drawerJobId !== jobId) return;
      if (!res.ok) {
        drawerAutoNote.textContent = data.error || 'No se pudo iniciar la publicación automática.';
        drawerBatch = data.batch ?? null;
        updateYouTubeChannelPill();
        return;
      }
      drawerAutoNote.textContent = data.batch?.message || 'Analizando y publicando clips 1 a 1…';
      void syncDrawerUploads(jobId);
    } catch {
      if (drawerJobId !== jobId) return;
      drawerAutoNote.textContent = 'Error de conexión al iniciar la publicación automática.';
      drawerBatch = null;
      updateYouTubeChannelPill();
    }
  });

  cancelSourceButton.addEventListener('click', cancelAllProcesses);
  cancelJobButton.addEventListener('click', cancelAllProcesses);
  resumeJobBtn.addEventListener('click', async () => {
    if (!serverAvailable || !currentJob || busy) return;
    resumeJobBtn.disabled = true;
    resumeJobLabel.textContent = 'Reanudando fases…';
    try {
      const response = await fetch(`/api/jobs/${currentJob}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: engineInput.value, model: modelInput.value }),
      });
      const resumed = await response.json();
      if (!response.ok) {
        setNote(resumed.error || 'No se pudo reanudar el proyecto.', { error: true });
        setControls(false);
        return;
      }
      resetNote();
      showJob(resumed);
      followJob(resumed.id);
      void loadHistory();
    } catch {
      setNote('Error al conectar para reanudar el proyecto.', { error: true });
      setControls(false);
    }
  });
  searchMoreBtn.addEventListener('click', async () => {
    if (!serverAvailable || !currentJob || busy || searchMoreBtn.disabled) return;
    const id = currentJob;
    const status = byId('job-status');
    searchMoreBtn.disabled = true;
    status.textContent = 'Iniciando una nueva búsqueda de clips…';
    try {
      const response = await fetch(`/api/jobs/${id}/search-more`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || 'No se pudo iniciar la búsqueda.');
      if (currentJob !== id) return;
      setDrawerOpen(false);
      showJob(job);
      followJob(id);
      void loadHistory();
    } catch (error) {
      if (currentJob !== id) return;
      status.textContent = error.message || 'No se pudo conectar con Corte Studio.';
      setControls(false);
    }
  });
  urlInput.addEventListener('input', resetNote);
  engineInput.addEventListener('change', rememberEngine);
  modelInput.addEventListener('change', rememberEngine);

  loadFormat();
  updateFormatSummary();
  formatMenu.addEventListener('change', () => {
    const format = currentFormat();
    if (format.layouts.length) {
      try { localStorage.setItem(formatStorage, JSON.stringify(format)); } catch { /* Ignore storage issues. */ }
      resetNote();
    }
    updateFormatSummary();
  });

  modeNormalBtn?.addEventListener('click', () => { if (!busy) setVideoMode('normal'); });
  modePrototypeBtn?.addEventListener('click', () => { if (!busy) setVideoMode('prototype'); });
  modeSummaryBtn?.addEventListener('click', () => { if (!busy) setVideoMode('summary'); });
  voiceInput?.addEventListener('change', () => {
    try { localStorage.setItem(voiceStorage, voiceInput.value); } catch { /* Ignore storage errors. */ }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || continueButton.disabled) return;
    const url = urlInput.value.trim();
    const parsedSource = parseVideoSource(url);
    if (!parsedSource) {
      setNote('Introduce un enlace válido de YouTube o Twitch (vídeo, clip o directo).', { invalid: true });
      urlInput.focus();
      return;
    }
    if (!serverAvailable) {
      setNote('Para procesar una URL, ejecuta «node server.mjs» y abre http://127.0.0.1:4173.');
      return;
    }
    const format = currentFormat();
    if (videoMode !== 'summary' && !format.layouts.length) {
      formatMenu.open = true;
      setNote('Activa al menos un diseño para continuar.', { error: true });
      formatMenu.querySelector('[name="layout"]').focus();
      return;
    }

    const matchingLatest = parsedSource.kind === 'live' ? null : allJobs.find((item) => item.videoId === parsedSource.videoId);
    submitting = true;
    setControls(true);
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          retryJobId: matchingLatest?.id,
          provider: engineInput.value,
          model: modelInput.value,
          format,
          mode: videoMode,
          ...(videoMode === 'prototype' && voiceInput?.value ? { voice: voiceInput.value } : {}),
          ...(videoMode === 'summary' ? { targetMinutes: Number(summaryTargetInput?.value) || 0, captions: summaryCaptionsInput?.checked !== false } : {}),
        }),
      });
      const job = await response.json();
      if (!response.ok) {
        setNote(job.error, { error: true });
        setControls(false);
        return;
      }
      resetNote();
      formatMenu.open = false;
      setDropdownOpen(false);
      switchView('editor');
      showJob(job);
      followJob(job.id, true);
      void loadHistory();
    } catch {
      setNote('No se pudo iniciar el proyecto. Comprueba que el servidor local esté en marcha.', { error: true });
      setControls(false);
    } finally {
      submitting = false;
    }
  });

  spotlightVideo.addEventListener('timeupdate', updateChapterHighlight);
  renderEmptyWaveform();
  switchView('home');
  if (serverAvailable) {
    setControls(false);
    void loadEngines();
    void loadHistory();
  } else {
    historyStatus.textContent = 'Abre http://127.0.0.1:4173 para consultar tus proyectos.';
  }
})();
