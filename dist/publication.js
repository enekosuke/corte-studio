const youtubeDestination = (() => {
  const storage = 'corte-youtube-channel';
  const selects = [byId('publish-channel'), byId('publication-channel')];
  let id = '';
  try { id = localStorage.getItem(storage) || ''; } catch {}
  let channels = [];
  let state = {};
  let pending;
  const selected = () => channels.find((channel) => channel.channelId === id);
  function update() {
    const current = selected();
    for (const select of selects) {
      select.replaceChildren(
        ...(!current ? [new Option(channels.length ? 'Elige un canal' : 'Sin canales conectados', '')] : []),
        ...channels.map((channel) => new Option(channel.handle ? `${channel.title} (${channel.handle})` : channel.title, channel.channelId)),
      );
      select.value = current?.channelId ?? '';
      select.disabled = !channels.length;
    }
    document.dispatchEvent(new Event('corte-youtube-channel'));
  }
  for (const select of selects) select.addEventListener('change', () => {
    id = select.value;
    try { localStorage.setItem(storage, id); } catch {}
    update();
  });
  const refresh = () => pending ??= (async () => {
    try {
      const response = await fetch('/api/youtube/status');
      if (!response.ok) throw new Error();
      state = await response.json();
      channels = state.channels ?? (state.connected ? [state] : []);
      if (!id && channels.length === 1) id = channels[0].channelId;
    } catch {
      channels = [];
      state = { reason: 'No se pudo consultar los canales de YouTube.' };
    } finally {
      pending = null;
      update();
    }
    return state;
  })();
  return { refresh, selected, state: () => state };
})();

const openClipPublication = (() => {
  const dialog = byId('publication-dialog');
  const content = byId('publication-content');
  const form = byId('publication-form');
  const status = byId('publication-status');
  const video = byId('publication-video');
  const selector = byId('publication-platform');
  const title = byId('publication-video-title');
  const body = byId('publication-text');
  const tags = byId('publication-tags');
  const save = byId('publication-save');
  const uploadBtn = byId('publication-upload');
  let record;
  let endpoint;
  let platform;
  let uploading = false;
  let revision = 0;

  function fields() {
    return { title: title.value, text: body.value, hashtags: tags.value.trim().split(/\s+/).filter(Boolean) };
  }

  function showPlatform() {
    const youtube = platform === 'youtube';
    const draft = record.platforms[platform];
    byId('publication-title-field').hidden = !youtube;
    title.required = youtube;
    title.value = draft.title ?? '';
    body.maxLength = youtube ? 1200 : 1000;
    body.value = draft.text;
    tags.value = draft.hashtags.join(' ');
    byId('publication-text-label').textContent = youtube ? 'Descripción' : 'Texto para TikTok';
    showDestination();
    status.textContent = draft.status === 'draft' ? 'Borrador guardado en este PC.' : '';
  }

  function showDestination() {
    if (!dialog.open || !record) return;
    const youtube = platform === 'youtube';
    const channel = youtubeDestination.selected();
    uploadBtn.hidden = byId('publication-channel-field').hidden = !youtube;
    uploadBtn.disabled = !youtube || !channel || uploading;
    uploadBtn.textContent = channel ? `Subir a ${channel.title}` : 'Subir vídeo';
    const publisher = byId('publication-publisher');
    publisher.hidden = !youtube || !channel;
    if (channel) {
      publisher.href = `https://www.youtube.com/channel/${channel.channelId}`;
      publisher.textContent = channel.title;
    }
    byId('publication-platform-note').textContent = youtube
      ? (channel ? (record.clip.longForm ? 'Se subirá como vídeo largo horizontal con los capítulos de la descripción.' : (record.clip.ratio === '16:9' ? 'Se subirá como vídeo horizontal.' : '')) : 'Selecciona un canal o conéctalo en Publicación rápida.')
      : 'Borrador para subida manual desde TikTok.';
  }
  document.addEventListener('corte-youtube-channel', showDestination);

  uploadBtn.addEventListener('click', async () => {
    if (uploadBtn.disabled || platform !== 'youtube' || !endpoint) return;
    const channel = youtubeDestination.selected();
    if (!channel) return;
    const current = revision;
    const draft = fields();
    uploading = true;
    uploadBtn.disabled = true;
    save.disabled = true;
    status.textContent = record.clip.longForm ? 'Subiendo el resumen a YouTube…' : 'Analizando vídeo y subiendo a YouTube con SEO pro…';
    try {
      await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'youtube', ...draft }),
      });
      const res = await fetch(`${endpoint}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate: true, forceSeo: false, channelId: channel.channelId }),
      });
      const data = await res.json();
      if (current !== revision) return;
      if (!res.ok) { status.textContent = data.error || 'No se pudo subir el vídeo.'; return; }
      status.textContent = `${data.status === 'already_uploaded' ? 'Ya estaba subido' : 'Subido'} en ${data.channelTitle || channel.title}: ${data.url}`;
    } catch {
      if (current === revision) status.textContent = 'Error de conexión al subir a YouTube.';
    } finally {
      uploading = false;
      if (current === revision) { save.disabled = false; showDestination(); }
    }
  });

  selector.addEventListener('change', () => {
    Object.assign(record.platforms[platform], fields());
    platform = selector.value;
    showPlatform();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (save.disabled) return;
    const draft = fields();
    if (draft.hashtags.length > 5 || draft.hashtags.some((tag) => !/^#?[\p{L}\p{N}_]{2,32}$/u.test(tag))) {
      status.textContent = 'Introduce hasta cinco hashtags válidos separados por espacios.';
      tags.focus();
      return;
    }
    const current = revision;
    const target = platform;
    save.disabled = true;
    selector.disabled = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: target, ...draft }),
      });
      const saved = await response.json();
      if (current !== revision) return;
      if (!response.ok) { status.textContent = saved.error; return; }
      record.platforms[target] = saved;
      showPlatform();
    } catch {
      if (current === revision) status.textContent = 'No se pudo guardar el borrador. Inténtalo de nuevo.';
    } finally {
      if (current === revision) { save.disabled = false; selector.disabled = false; }
    }
  });

  byId('publication-copy').addEventListener('click', async () => {
    const current = revision;
    const draft = fields();
    const credit = platform === 'youtube' ? `Vídeo original: ${record.source.title}\n${record.source.url}` : '';
    const hashtags = draft.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
    try {
      await navigator.clipboard.writeText([draft.text, credit, hashtags].filter(Boolean).join('\n\n'));
      if (current === revision) status.textContent = 'Texto copiado.';
    } catch {
      if (current === revision) status.textContent = 'No se pudo copiar. Puedes seleccionar el texto del borrador.';
    }
  });

  byId('publication-copy-seo').addEventListener('click', async () => {
    const current = revision;
    const draft = fields();
    const hashtags = draft.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
    const credit = platform === 'youtube' ? `Vídeo original: ${record.source.title}\n${record.source.url}` : '';
    const parts = [
      draft.title ? `Título: ${draft.title}` : '',
      record.coverText ? `Portada: ${record.coverText}` : '',
      draft.text,
      record.pinnedComment ? `Comentario fijado: ${record.pinnedComment}` : '',
      record.seoKeywords?.length ? `Keywords: ${record.seoKeywords.join(', ')}` : '',
      hashtags,
      credit,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join('\n\n'));
      if (current === revision) status.textContent = 'Paquete SEO completo copiado.';
    } catch {
      if (current === revision) status.textContent = 'No se pudo copiar el paquete SEO.';
    }
  });

  byId('publication-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    revision++;
    video.removeAttribute('src');
    video.load();
  });

  return async (jobId, clip) => {
    const current = ++revision;
    endpoint = `/api/jobs/${jobId}/publication/${clip.file}`;
    byId('publication-clip').textContent = clip.title;
    content.hidden = true;
    status.textContent = 'Cargando ficha de publicación…';
    dialog.showModal();
    try {
      const [response] = await Promise.all([fetch(endpoint), youtubeDestination.refresh()]);
      if (!response.ok) throw new Error();
      const loaded = await response.json();
      if (current !== revision || !dialog.open) return;
      record = loaded;
      const longForm = Boolean(record.clip.longForm);
      selector.options[0].textContent = longForm || record.clip.ratio === '16:9' ? 'YouTube' : 'YouTube Shorts';
      selector.options[1].hidden = selector.options[1].disabled = longForm;
      byId('publication-title-label').textContent = longForm ? 'Título del vídeo' : 'Título del Short';
      byId('publication-title').textContent = longForm ? 'Publicar el resumen' : 'Preparar publicación';
      if (longForm) platform = 'youtube';
      video.src = record.clip.url;
      const source = byId('publication-source');
      source.href = record.source.url;
      source.title = record.source.title;
      source.textContent = longForm ? 'Vídeo original completo' : `Vídeo original · ${time(record.clip.start)}`;
      byId('publication-query').textContent = record.query;
      byId('publication-hook').textContent = record.hook;

      const coverEl = byId('publication-cover');
      const coverDt = byId('publication-cover-dt');
      coverEl.textContent = record.coverText || '';
      coverEl.hidden = coverDt.hidden = !record.coverText;

      const commentEl = byId('publication-comment');
      const commentDt = byId('publication-comment-dt');
      commentEl.textContent = record.pinnedComment || '';
      commentEl.hidden = commentDt.hidden = !record.pinnedComment;

      const kwEl = byId('publication-keywords');
      const kwDt = byId('publication-keywords-dt');
      kwEl.replaceChildren(...(record.seoKeywords || []).map((kw) => {
        const chip = document.createElement('span');
        chip.className = 'seo-keyword-chip';
        chip.textContent = kw;
        return chip;
      }));
      kwEl.hidden = kwDt.hidden = !(record.seoKeywords?.length);

      const seoEl = byId('publication-seo-score');
      const seoDt = byId('publication-seo-dt');
      seoEl.textContent = record.seoScore ? `${record.seoScore}/100` : '';
      seoEl.hidden = seoDt.hidden = !record.seoScore;

      byId('publication-ideas').hidden = !record.query && !record.hook && !record.seoKeywords?.length;
      selector.value = platform ?? 'youtube';
      platform = selector.value;
      selector.disabled = false;
      save.disabled = false;
      content.hidden = false;
      showPlatform();
    } catch {
      if (current === revision) status.textContent = 'No se pudo abrir la ficha de publicación.';
    }
  };
})();
