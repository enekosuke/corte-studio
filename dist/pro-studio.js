(() => {
  'use strict';

  // Corte Studio v4 — World-Class Pro NLE Companion UI
  // Integra lo mejor de OpusClip (Virality Score 0-100 + Brand Kit), Submagic (Galería Visual de Subtítulos),
  // Descript (Edición basada en texto palabra por palabra), ByteCap 2026 Safe Zones exactas,
  // Studio de Miniaturas JPG, Exportación EDL/FCPXML, Cola FIFO, Upload Local, Gestor de Disco y Barra NLE.

  const byId = (id) => document.getElementById(id);
  // V5: Inyectar focusPrompt en POST /api/jobs de forma transparente
  const _origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.endsWith('/api/jobs') && init?.method?.toUpperCase() === 'POST' && typeof init.body === 'string') {
        const focusEl = byId('v5-focus-prompt');
        const fp = focusEl?.value?.trim();
        if (fp) {
          const parsed = JSON.parse(init.body);
          parsed.focusPrompt = fp;
          init = { ...init, body: JSON.stringify(parsed) };
        }
      }
    } catch {}
    return _origFetch(input, init);
  };

  // V5: Selector de tema (Carbon Pro / Midnight Cinema / Studio Light)
  const THEMES = ['carbon', 'midnight', 'light'];
  const THEME_LABELS = { carbon: 'Carbon Pro', midnight: 'Midnight', light: 'Light Pro' };
  let themeIdx = 0;
  function applyTheme(name) {
    const t = THEMES.includes(name) ? name : 'carbon';
    themeIdx = THEMES.indexOf(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('corte-v5-theme', t); } catch {}
    const btn = byId('pro-theme-btn');
    if (btn) btn.textContent = THEME_LABELS[t];
  }
  function cycleTheme() {
    const next = THEMES[(themeIdx + 1) % THEMES.length];
    applyTheme(next);
    toast(`Tema visual: ${THEME_LABELS[next]}`, 'info', 2000);
  }
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBytes = (b = 0) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b >= 1e3 ? `${(b / 1e3).toFixed(0)} KB` : `${b} B`);

  const SAFE_ZONES = {
    universal: { label: 'UNIVERSAL (SHORTS + TIKTOK + REELS)', top: 250, bottom: 484, right: 140 },
    shorts: { label: 'YOUTUBE SHORTS 2026', top: 200, bottom: 350, right: 140 },
    tiktok: { label: 'TIKTOK 2026', top: 130, bottom: 484, right: 140 },
    reels: { label: 'INSTAGRAM REELS 2026', top: 220, bottom: 430, right: 140 },
  };
  const safeKeys = ['off', 'universal', 'shorts', 'tiktok', 'reels'];
  let safeIdx = 0;

  const CAPTION_PRESETS = [
    { id: 'hormozi-pop', label: 'Hormozi Pop', sample: 'ESTO <span style="color:#FFE600">EXPLOTA</span>', style: 'text-transform:uppercase;color:#fff;text-shadow:0 2px 0 #000' },
    { id: 'gaming-neon', label: 'Gaming Neón', sample: 'CLUTCH <span style="color:#38BDF8">1V4</span>', style: 'text-transform:uppercase;color:#f8fafc;text-shadow:0 0 8px rgba(56,189,248,0.6)' },
    { id: 'editorial-clean', label: 'Editorial Limpio', sample: 'Dato clave hoy', style: 'color:#f3f4f6;font-weight:600;background:rgba(0,0,0,0.55);padding:1px 6px;border-radius:4px' },
    { id: 'podcast-speaker', label: 'Podcast Doble', sample: '<span style="color:#38BDF8">A:</span> <span style="color:#F59E0B">¡Exacto!</span>', style: 'font-weight:700' },
    { id: 'classic-karaoke', label: 'Karaoké Clásico', sample: 'PALABRA ACTIVA', style: 'text-transform:uppercase;color:#e5e7eb;text-shadow:0 1px 0 #000' },
  ];

  // --- Toast Stack ---
  const toastHost = document.createElement('div');
  toastHost.className = 'pro-toasts';
  document.body.appendChild(toastHost);

  function toast(message, type = 'info', ms = 3600) {
    const el = document.createElement('div');
    el.className = `pro-toast ${type}`;
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error HTTP ${res.status}`);
    return data;
  }

  // --- Modal Helper ---
  function openModal(title, renderBody) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'pro-backdrop';
    backdrop.id = 'pro-active-modal';
    backdrop.innerHTML = `
      <div class="pro-modal" role="dialog" aria-modal="true">
        <div class="pro-modal-head"><h3></h3><button type="button" class="pro-btn" data-close>Cerrar</button></div>
        <div class="pro-modal-body"></div>
      </div>`;
    backdrop.querySelector('h3').textContent = title;
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-close]')) closeModal();
    });
    document.body.appendChild(backdrop);
    renderBody(backdrop.querySelector('.pro-modal-body'));
  }

  function closeModal() { byId('pro-active-modal')?.remove(); }

  // --- Pixel-Accurate 2026 Safe Zones ---
  function ensureSafeZoneOverlay() {
    const stage = byId('spotlight-stage') || byId('project-monitor');
    if (!stage) return null;
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    let ov = stage.querySelector('.pro-safezone-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'pro-safezone-overlay';
      stage.appendChild(ov);
    }
    return ov;
  }

  function cycleSafeZone() {
    safeIdx = (safeIdx + 1) % safeKeys.length;
    const key = safeKeys[safeIdx];
    const ov = ensureSafeZoneOverlay();
    if (!ov) return;
    if (key === 'off') {
      ov.classList.remove('visible');
      toast('Safe Zones desactivado', 'info', 1800);
      return;
    }
    const cfg = SAFE_ZONES[key];
    const bottomY = 1920 - cfg.bottom;
    const rightX = 1080 - cfg.right;
    ov.innerHTML = `
      <div class="pro-safezone-label">${cfg.label}</div>
      <svg viewBox="0 0 1080 1920" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
        <rect x="0" y="0" width="1080" height="${cfg.top}" fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.7)" stroke-width="3" stroke-dasharray="14 10"/>
        <rect x="${rightX}" y="${cfg.top + 380}" width="${cfg.right}" height="${Math.max(200, bottomY - cfg.top - 380)}" fill="rgba(239,68,68,0.18)" stroke="rgba(239,68,68,0.7)" stroke-width="3" stroke-dasharray="14 10"/>
        <rect x="0" y="${bottomY}" width="1080" height="${cfg.bottom}" fill="rgba(239,68,68,0.22)" stroke="rgba(239,68,68,0.8)" stroke-width="3" stroke-dasharray="14 10"/>
        <rect x="40" y="${cfg.top + 12}" width="${rightX - 60}" height="${bottomY - cfg.top - 24}" fill="none" stroke="rgba(16,185,129,0.75)" stroke-width="3" stroke-dasharray="10 8"/>
      </svg>`;
    ov.classList.add('visible');
    toast(`Safe Zones: ${cfg.label}`, 'info', 2000);
  }

  // --- Brands Modal ---
  let statusBrandEl = null;
  async function refreshBrandStatus() {
    try {
      const data = await api('/api/brands');
      const active = (data.brands || []).find((b) => b.id === data.defaultBrandId) || data.brands?.[0];
      if (statusBrandEl && active) statusBrandEl.textContent = `Marca: ${active.name}${active.handle ? ` (${active.handle})` : ''}`;
      return data;
    } catch { return null; }
  }

  async function showBrandsModal() {
    openModal('Brand Kits · Perfiles de marca y subtítulos', async (body) => {
      body.innerHTML = '<div style="color:var(--muted);font-size:13px">Cargando marcas…</div>';
      try {
        const data = await api('/api/brands');
        const render = (state) => {
          body.innerHTML = '';
          const list = document.createElement('div');
          list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
          for (const b of state.brands || []) {
            const row = document.createElement('div');
            row.className = 'pro-row';
            row.innerHTML = `
              <div>
                <div style="font-weight:600;color:var(--ink);font-size:13.5px">${esc(b.name)} <span style="color:var(--muted);font-family:var(--mono);font-size:12px">${esc(b.handle || '(sin @handle)')}</span> ${state.defaultBrandId === b.id ? '<span class="pro-badge">Activa</span>' : ''}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px">Preset: <code>${esc(b.subtitlePreset)}</code> · Acento: <span style="color:${esc(b.accentHex)}">${esc(b.accentHex)}</span> · SFX: ${b.sfx ? 'Sí' : 'No'} · Bleep: ${b.bleepProfanity ? 'Sí' : 'No'}</div>
              </div>
              <div style="display:flex;gap:6px">
                ${state.defaultBrandId !== b.id ? `<button class="pro-btn" data-default="${esc(b.id)}">Activar</button>` : ''}
                ${b.id !== 'default' ? `<button class="pro-btn danger" data-del="${esc(b.id)}">Borrar</button>` : ''}
              </div>`;
            list.appendChild(row);
          }
          body.appendChild(list);

          const form = document.createElement('form');
          form.innerHTML = `
            <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:4px;font-weight:600;font-size:13px;color:var(--ink);margin-bottom:10px">Nuevo Brand Kit</div>
            <div class="pro-form-grid">
              <label class="pro-field">ID (slug)<input name="id" placeholder="mi-canal" required pattern="[a-z0-9-]{2,40}"></label>
              <label class="pro-field">Nombre<input name="name" placeholder="Mi Canal Pro" required></label>
              <label class="pro-field">@Handle (marca de agua)<input name="handle" placeholder="@MiCanal"></label>
              <label class="pro-field">Preset de subtítulos
                <select name="subtitlePreset">${CAPTION_PRESETS.map((p) => `<option value="${esc(p.id)}">${p.label} (${esc(p.id)})</option>`).join('')}</select>
              </label>
              <label class="pro-field">Color de acento<input name="accentHex" type="color" value="#FFE600"></label>
              <label class="pro-field">Tono SEO<input name="seoVoice" placeholder="creador directo con ritmo rápido"></label>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
              <label style="font-size:12.5px;color:var(--text);display:flex;gap:8px;align-items:center"><input type="checkbox" name="showWatermark" checked> Mostrar marca de agua</label>
              <button type="submit" class="pro-btn primary">Guardar Brand Kit</button>
            </div>`;
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            try {
              const updated = await api('/api/brands', {
                method: 'POST',
                body: JSON.stringify({
                  makeDefault: true,
                  brand: {
                    id: fd.get('id'), name: fd.get('name'), handle: fd.get('handle'),
                    subtitlePreset: fd.get('subtitlePreset'), accentHex: fd.get('accentHex'),
                    seoVoice: fd.get('seoVoice'), showWatermark: fd.get('showWatermark') === 'on',
                  },
                }),
              });
              toast(`Brand Kit "${updated.brand.name}" activado`, 'ok');
              refreshBrandStatus();
              render(updated);
            } catch (err) { toast(err.message, 'err'); }
          });
          body.appendChild(form);

          body.querySelectorAll('[data-default]').forEach((btn) => btn.addEventListener('click', async () => {
            const target = (state.brands || []).find((x) => x.id === btn.dataset.default);
            if (!target) return;
            const updated = await api('/api/brands', { method: 'POST', body: JSON.stringify({ brand: target, makeDefault: true }) });
            toast(`Marca activa: ${target.name}`, 'ok');
            refreshBrandStatus();
            render(updated);
          }));
          body.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
            const updated = await api(`/api/brands/${btn.dataset.del}`, { method: 'DELETE' });
            toast('Marca eliminada', 'info');
            refreshBrandStatus();
            render(updated);
          }));
        };
        render(data);
      } catch (err) { body.innerHTML = `<div style="color:#fca5a5">${esc(err.message)}</div>`; }
    });
  }

  // --- Storage Manager Modal ---
  async function showStorageModal() {
    openModal('Gestor de almacenamiento local', async (body) => {
      const load = async () => {
        const data = await api('/api/system/storage');
        body.innerHTML = `
          <div class="pro-row">
            <div>
              <div style="font-size:12px;color:var(--muted)">Espacio ocupado en proyectos</div>
              <div style="font-size:20px;font-weight:700;color:var(--ink);font-family:var(--mono)">${fmtBytes(data.totals.total)}</div>
              <div style="font-size:12px;color:var(--muted)">VODs: ${fmtBytes(data.totals.source)} · Clips: ${fmtBytes(data.totals.clips)} · Temp: ${fmtBytes(data.totals.temp)}</div>
            </div>
            <button class="pro-btn primary" id="pro-prune-btn">Liberar VODs (&gt;7 días)</button>
          </div>
          <div id="pro-storage-list" style="display:flex;flex-direction:column;gap:8px"></div>`;
        body.querySelector('#pro-prune-btn').addEventListener('click', async () => {
          const res = await api('/api/system/storage/prune', { method: 'POST', body: JSON.stringify({ olderThanDays: 7, keepClips: true }) });
          toast(`Liberados ${fmtBytes(res.freedBytes || 0)} conservando clips`, 'ok');
          load();
        });
        const list = body.querySelector('#pro-storage-list');
        for (const p of data.projects || []) {
          const row = document.createElement('div');
          row.className = 'pro-row';
          row.innerHTML = `
            <div style="min-width:0">
              <div style="font-weight:600;color:var(--ink);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
              <div style="font-size:11.5px;color:var(--muted);font-family:var(--mono)">${fmtBytes(p.bytes.total)} (VOD ${fmtBytes(p.bytes.source)} · ${p.clipCount} clips)</div>
            </div>
            <div style="display:flex;gap:6px;flex:none">
              ${p.hasSource && !p.active ? `<button class="pro-btn" data-keep="${esc(p.id)}">Quitar VOD</button>` : ''}
              ${!p.active ? `<button class="pro-btn danger" data-rm="${esc(p.id)}">Borrar</button>` : '<span class="pro-badge">Activo</span>'}
            </div>`;
          list.appendChild(row);
        }
        list.querySelectorAll('[data-keep]').forEach((b) => b.addEventListener('click', async () => {
          await api(`/api/jobs/${b.dataset.keep}?keepClips=true`, { method: 'DELETE' });
          toast('VOD eliminado; clips conservados', 'ok');
          load();
        }));
        list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
          await api(`/api/jobs/${b.dataset.rm}`, { method: 'DELETE' });
          toast('Proyecto eliminado del disco', 'info');
          load();
        }));
      };
      try { await load(); } catch (err) { body.innerHTML = `<div style="color:#fca5a5">${esc(err.message)}</div>`; }
    });
  }

  // --- Queue Modal ---
  let queueBadgeEl = null;
  async function refreshQueueBadge() {
    try {
      const q = await api('/api/queue');
      if (queueBadgeEl) queueBadgeEl.textContent = String(q.items?.length ?? 0);
      return q;
    } catch { return { paused: false, items: [] }; }
  }

  async function showQueueModal() {
    openModal('Cola FIFO por lotes', async (body) => {
      const render = async () => {
        const q = await refreshQueueBadge();
        body.innerHTML = `
          <form id="pro-q-form" style="display:flex;gap:8px">
            <input name="url" placeholder="URL de YouTube o Twitch para añadir a la cola…" required style="flex:1;height:36px;padding:0 12px;border-radius:7px;border:1px solid var(--line-bright);background:var(--bg);color:var(--ink);font-size:13px">
            <button type="submit" class="pro-btn primary">Encolar</button>
            <button type="button" class="pro-btn" id="pro-q-pause">${q.paused ? 'Reanudar' : 'Pausar'}</button>
          </form>
          <div id="pro-q-list" style="display:flex;flex-direction:column;gap:8px"></div>`;
        body.querySelector('#pro-q-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const url = new FormData(e.target).get('url');
          const provider = byId('source-engine')?.value || 'gemini';
          try {
            await api('/api/queue', { method: 'POST', body: JSON.stringify({ url, provider }) });
            toast('Añadido a la cola FIFO', 'ok');
            render();
          } catch (err) { toast(err.message, 'err'); }
        });
        body.querySelector('#pro-q-pause').addEventListener('click', async () => {
          await api('/api/queue/pause', { method: 'POST', body: JSON.stringify({ paused: !q.paused }) });
          toast(q.paused ? 'Cola reanudada' : 'Cola pausada', 'info');
          render();
        });
        const list = body.querySelector('#pro-q-list');
        if (!q.items.length) { list.innerHTML = '<div style="color:var(--muted);font-size:13px">Cola vacía.</div>'; return; }
        q.items.forEach((item, idx) => {
          const row = document.createElement('div');
          row.className = 'pro-row';
          row.innerHTML = `
            <div style="min-width:0">
              <div style="font-weight:600;color:var(--ink);font-size:13px">#${idx + 1} · ${esc(item.label)}</div>
              <div style="font-size:11.5px;color:var(--muted);font-family:var(--mono)">Modo: ${esc(item.mode)} · Motor: ${esc(item.provider)}</div>
            </div>
            <button class="pro-btn danger" data-qdel="${esc(item.queueId)}">Quitar</button>`;
          list.appendChild(row);
        });
        list.querySelectorAll('[data-qdel]').forEach((b) => b.addEventListener('click', async () => {
          await api(`/api/queue/${b.dataset.qdel}`, { method: 'DELETE' });
          toast('Eliminado de la cola', 'info');
          render();
        }));
      };
      await render();
    });
  }

  // --- TABBED PRO NLE INSPECTOR DOCK (v4) ---
  let pendingWordOverrides = new Map();
  let selectedPresetId = 'hormozi-pop';

  const dock = document.createElement('aside');
  dock.className = 'pro-nle-dock';
  dock.id = 'pro-nle-dock';
  dock.innerHTML = `
    <div class="pro-nle-head">
      <strong style="font-size:13.5px;color:var(--ink)" id="pro-nle-title">Inspector NLE Pro</strong>
      <button type="button" class="pro-btn" id="pro-nle-close" style="height:26px;padding:0 8px">×</button>
    </div>
    <div class="pro-tabs">
      <button type="button" class="pro-tab active" data-tab="trim">Recorte</button>
      <button type="button" class="pro-tab" data-tab="style">Estilo</button>
      <button type="button" class="pro-tab" data-tab="text">Texto</button>
      <button type="button" class="pro-tab" data-tab="thumb">Portada</button>
    </div>
    <div class="pro-nle-body">
      <div class="pro-tab-pane active" data-pane="trim">
        <div id="pro-score-slot"></div>
        <div id="pro-diag-slot"></div>
        <div id="v5-ab-slot" class="v5-variant-list"></div>
        <div class="pro-form-grid">
          <label class="pro-field">Inicio (seg · tecla I)<input type="number" step="0.1" id="pro-nle-start"></label>
          <label class="pro-field">Fin (seg · tecla O)<input type="number" step="0.1" id="pro-nle-end"></label>
        </div>
        <label class="pro-field"><span>Rótulo en pantalla (<span id="pro-hook-len">0</span>/56)</span>
          <input type="text" id="pro-nle-hook" maxlength="72" placeholder="Frase gancho con acción concreta…">
        </label>
        <div class="pro-form-grid">
          <label class="pro-field">Quitar silencios
            <select id="pro-nle-silences"><option value="true">Sí (Jump Cuts)</option><option value="false">No (Original)</option></select>
          </label>
          <label class="pro-field">Forzar layout
            <select id="pro-nle-layout">
              <option value="">Automático IA</option>
              <option value="gameplay">Gameplay</option>
              <option value="fill">Fill (Seguimiento)</option>
              <option value="split">Split (2 personas)</option>
              <option value="fit">Fit (Plano general)</option>
            </select>
          </label>
          <label class="pro-field">Studio Voice Polish
            <select id="pro-nle-polish"><option value="false">Original</option><option value="true">Broadcast Pro (EQ+Norm)</option></select>
          </label>
          <div style="display:flex;align-items:flex-end"><button type="button" class="pro-btn" id="pro-nle-ab" style="width:100%;justify-content:center">Variantes A/B Hook</button></div>
        </div>
      </div>

      <div class="pro-tab-pane" data-pane="style">
        <div style="font-size:12px;color:var(--muted)">Elige el estilo visual de subtítulos cinéticos (libass):</div>
        <div class="pro-preset-grid" id="pro-preset-grid"></div>
      </div>

      <div class="pro-tab-pane" data-pane="text">
        <div style="font-size:12px;color:var(--muted)">Haz clic en una palabra para saltar al segundo exacto; <strong>doble clic</strong> para corregir erratas de Whisper:</div>
        <div class="pro-word-flow" id="pro-word-flow"></div>
      </div>

      <div class="pro-tab-pane" data-pane="thumb">
        <img id="pro-thumb-img" class="pro-thumb-preview" alt="Miniatura del clip" style="display:none">
        <label class="pro-field">Texto de portada (coverText · MAYÚSCULAS)
          <input type="text" id="pro-thumb-text" maxlength="32" placeholder="FINAL IMPOSIBLE">
        </label>
        <div class="pro-form-grid">
          <label class="pro-field">Segundo del fotograma<input type="number" step="0.1" id="pro-thumb-ts" value="1.2"></label>
          <div style="display:flex;align-items:flex-end"><button type="button" class="pro-btn" id="pro-thumb-now" style="width:100%;justify-content:center">Usar frame actual</button></div>
        </div>
        <button type="button" class="pro-btn primary" id="pro-thumb-gen" style="justify-content:center">Generar miniatura JPG</button>
        <div style="border-top:1px solid var(--line);padding-top:10px;display:flex;gap:8px">
          <a id="pro-export-edl" class="pro-btn" style="flex:1;justify-content:center" download>Exportar .EDL (Premiere)</a>
          <a id="pro-export-xml" class="pro-btn" style="flex:1;justify-content:center" download>Exportar .FCPXML (Resolve)</a>
        </div>
      </div>
    </div>
    <div class="pro-nle-foot">
      <button type="button" class="pro-btn" id="pro-nle-safe">Safe Zones (S)</button>
      <button type="button" class="pro-btn primary" id="pro-nle-rerender">Re-renderizar clip</button>
    </div>`;
  document.body.appendChild(dock);

  dock.querySelectorAll('.pro-tab').forEach((tab) => tab.addEventListener('click', () => {
    dock.querySelectorAll('.pro-tab').forEach((t) => t.classList.toggle('active', t === tab));
    dock.querySelectorAll('.pro-tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === tab.dataset.tab));
  }));

  function renderPresetGallery() {
    const grid = byId('pro-preset-grid');
    grid.innerHTML = '';
    for (const p of CAPTION_PRESETS) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `pro-preset-card${selectedPresetId === p.id ? ' selected' : ''}`;
      card.innerHTML = `<div class="pro-preset-sample" style="${p.style}">${p.sample}</div><div class="pro-preset-name">${p.label}</div>`;
      card.addEventListener('click', () => { selectedPresetId = p.id; renderPresetGallery(); });
      grid.appendChild(card);
    }
  }

  function renderScoreAndDiagnostics(clip) {
    const scoreSlot = byId('pro-score-slot');
    const diagSlot = byId('pro-diag-slot');
    const overall = Math.round((Number(clip.score ?? 8) / 10) * 100);
    const vs = clip.viralScores || {};
    const bars = [
      ['Gancho 0–3s', (vs.hook ?? clip.score ?? 8) * 10],
      ['Retención', (vs.retention ?? clip.score ?? 8) * 10],
      ['Compartidos', (vs.share ?? clip.score ?? 7.5) * 10],
      ['Bucle (Loop)', (clip.loopScore ?? 7.5) * 10],
    ];
    scoreSlot.innerHTML = `
      <div class="pro-score-card">
        <div class="pro-score-ring">${overall}<span style="font-size:9px;font-weight:500;color:var(--muted)">VIRAL</span></div>
        <div class="pro-score-bars">
          ${bars.map(([name, pct]) => `
            <div class="pro-bar-item">
              <div style="display:flex;justify-content:space-between"><span>${name}</span><span style="font-family:var(--mono);color:var(--ink)">${Math.round(pct)}</span></div>
              <div class="pro-bar-track"><div class="pro-bar-fill" style="width:${Math.min(100, Math.max(8, pct))}%"></div></div>
            </div>`).join('')}
        </div>
      </div>`;

    const dur = Math.max(0, (clip.edits?.trimEnd ?? clip.end ?? 0) - (clip.edits?.trimStart ?? clip.start ?? 0));
    const hookLen = (clip.edits?.onScreenHook ?? clip.onScreenHook ?? '').length;
    if (hookLen > 56) {
      diagSlot.innerHTML = `<div class="pro-diag warn">Rótulo largo (${hookLen} chars). Acórtalo a ≤56 para que no ocupe 3 líneas en móvil.</div>`;
    } else if (dur > 45) {
      diagSlot.innerHTML = `<div class="pro-diag warn">Duración ${dur.toFixed(0)}s. En Shorts/TikTok 2026 la banda de mayor retención es 18–45s.</div>`;
    } else {
      diagSlot.innerHTML = `<div class="pro-diag ok">Duración óptima (${dur.toFixed(1)}s) y rótulo dentro de zona segura.</div>`;
    }
  }

  function detectActiveClipContext() {
    const vid = document.querySelector('#clip-spotlight video, #spotlight-stage video, #job-clips video[src*="/media/"]');
    const src = vid?.getAttribute('src') || vid?.currentSrc || '';
    const m = /\/media\/([a-f0-9-]+)\/(clip-\d+\.mp4)/.exec(src);
    return m ? { jobId: m[1], file: m[2], videoEl: vid } : null;
  }

  async function openNleInspector() {
    const ctx = detectActiveClipContext();
    if (!ctx) { toast('Abre primero un clip exportado en el editor.', 'info'); return; }
    try {
      const [job, transcript] = await Promise.all([
        api(`/api/jobs/${ctx.jobId}`),
        api(`/api/jobs/${ctx.jobId}/transcript`).catch(() => null),
      ]);
      const clip = (job.clips || []).find((c) => c.file === ctx.file);
      if (!clip) return;

      pendingWordOverrides = new Map((clip.edits?.wordOverrides || []).map(({ index, text }) => [index, text]));
      selectedPresetId = clip.edits?.subtitlePreset || 'hormozi-pop';
      const start = clip.edits?.trimStart ?? clip.start ?? 0;
      const end = clip.edits?.trimEnd ?? clip.end ?? 15;

      byId('pro-nle-title').textContent = `Inspector NLE · ${ctx.file}`;
      byId('pro-nle-start').value = start.toFixed(1);
      byId('pro-nle-end').value = end.toFixed(1);
      byId('pro-nle-hook').value = clip.edits?.onScreenHook ?? clip.onScreenHook ?? '';
      byId('pro-hook-len').textContent = String(byId('pro-nle-hook').value.length);
      byId('pro-nle-silences').value = String(clip.edits?.removeSilences !== false);
      byId('pro-nle-layout').value = clip.edits?.layoutOverride || '';
      byId('pro-nle-polish').value = String(clip.edits?.voicePolish === true);
      byId('v5-ab-slot').innerHTML = '';
      byId('pro-thumb-text').value = (clip.edits?.onScreenHook || clip.onScreenHook || clip.title || '').toUpperCase().slice(0, 26);

      const thumbImg = byId('pro-thumb-img');
      if (clip.thumbnailFile) {
        thumbImg.src = `/media/${ctx.jobId}/${clip.thumbnailFile}?t=${Date.now()}`;
        thumbImg.style.display = 'block';
      } else {
        thumbImg.style.display = 'none';
      }
      byId('pro-export-edl').href = `/api/jobs/${ctx.jobId}/clips/${ctx.file}/export-edl?format=edl`;
      byId('pro-export-xml').href = `/api/jobs/${ctx.jobId}/clips/${ctx.file}/export-edl?format=fcpxml`;

      renderScoreAndDiagnostics(clip);
      renderPresetGallery();

      // Descript-style interactive word chips
      const flow = byId('pro-word-flow');
      flow.innerHTML = '';
      const words = [];
      for (const seg of transcript?.segments || []) {
        if (seg.end <= start || seg.start >= end) continue;
        for (const w of seg.words || []) {
          if (w.end <= start || w.start >= end) continue;
          words.push(w);
        }
      }
      if (!words.length) {
        flow.innerHTML = '<div style="font-size:12px;color:var(--muted)">Sin marcas de palabra disponibles en este rango.</div>';
      } else {
        words.forEach((w, idx) => {
          const chip = document.createElement('span');
          const override = pendingWordOverrides.get(idx);
          chip.className = `pro-word-chip${override ? ' edited' : ''}`;
          chip.textContent = override || w.text;
          chip.title = `${(w.start - start).toFixed(2)}s · Clic para saltar, doble clic para editar`;
          chip.addEventListener('click', () => {
            const v = document.querySelector('#clip-spotlight video, #spotlight-stage video');
            if (v) { v.currentTime = Math.max(0, w.start - start); v.play().catch(() => {}); }
          });
          chip.addEventListener('dblclick', () => {
            const next = prompt('Corregir palabra en subtítulo:', chip.textContent);
            if (next !== null && next.trim()) {
              pendingWordOverrides.set(idx, next.trim());
              chip.textContent = next.trim();
              chip.classList.add('edited');
            }
          });
          flow.appendChild(chip);
        });
      }

      dock.dataset.jobId = ctx.jobId;
      dock.dataset.file = ctx.file;
      dock.classList.add('open');
    } catch (err) { toast(err.message, 'err'); }
  }

  byId('pro-nle-hook').addEventListener('input', (e) => { byId('pro-hook-len').textContent = String(e.target.value.length); });
  byId('pro-nle-close').addEventListener('click', () => dock.classList.remove('open'));
  byId('pro-nle-safe').addEventListener('click', cycleSafeZone);

  byId('pro-thumb-now').addEventListener('click', () => {
    const v = document.querySelector('#clip-spotlight video, #spotlight-stage video');
    if (v) byId('pro-thumb-ts').value = Math.max(0.1, v.currentTime).toFixed(1);
  });

  byId('pro-thumb-gen').addEventListener('click', async () => {
    const { jobId, file } = dock.dataset;
    if (!jobId || !file) return;
    const btn = byId('pro-thumb-gen');
    btn.disabled = true;
    btn.textContent = 'Generando JPG…';
    try {
      const res = await api(`/api/jobs/${jobId}/clips/${file}/thumbnail`, {
        method: 'POST',
        body: JSON.stringify({
          timestamp: Number(byId('pro-thumb-ts').value) || 1.2,
          coverText: byId('pro-thumb-text').value,
        }),
      });
      const img = byId('pro-thumb-img');
      img.src = res.url;
      img.style.display = 'block';
      toast(`Miniatura ${res.file} creada`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = 'Generar miniatura JPG'; }
  });

  byId('pro-nle-ab').addEventListener('click', async () => {
    const { jobId, file } = dock.dataset;
    if (!jobId || !file) return;
    try {
      const res = await api(`/api/jobs/${jobId}/clips/${file}/hook-variants`, {
        method: 'POST',
        body: JSON.stringify({ baseHook: byId('pro-nle-hook').value }),
      });
      const slot = byId('v5-ab-slot');
      slot.innerHTML = '';
      for (const v of res.variants || []) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'v5-variant-btn';
        b.innerHTML = `<span style="font-family:var(--mono);font-size:10.5px;color:var(--accent-pro);text-transform:uppercase">${esc(v.label)}</span><div style="margin-top:2px">${esc(v.hook)}</div>`;
        b.addEventListener('click', () => {
          byId('pro-nle-hook').value = v.hook;
          byId('pro-hook-len').textContent = String(v.hook.length);
          toast(`Gancho "${v.label}" aplicado. Pulsa Re-renderizar.`, 'ok', 2200);
        });
        slot.appendChild(b);
      }
    } catch (err) { toast(err.message, 'err'); }
  });

  byId('pro-nle-rerender').addEventListener('click', async () => {
    const { jobId, file } = dock.dataset;
    if (!jobId || !file) return;
    const btn = byId('pro-nle-rerender');
    btn.disabled = true;
    btn.textContent = 'Renderizando…';
    try {
      const payload = {
        trimStart: Number(byId('pro-nle-start').value),
        trimEnd: Number(byId('pro-nle-end').value),
        onScreenHook: byId('pro-nle-hook').value,
        subtitlePreset: selectedPresetId,
        removeSilences: byId('pro-nle-silences').value === 'true',
        layoutOverride: byId('pro-nle-layout').value,
        voicePolish: byId('pro-nle-polish').value === 'true',
        wordOverrides: [...pendingWordOverrides.entries()].map(([index, text]) => ({ index, text })),
      };
      const res = await api(`/api/jobs/${jobId}/clips/${file}/rerender`, { method: 'POST', body: JSON.stringify(payload) });
      toast(`Clip ${file} re-renderizado (rev. ${res.revision})`, 'ok');
      document.querySelectorAll(`video[src*="/media/${jobId}/${file}"]`).forEach((v) => { v.src = res.url; v.load(); });
    } catch (err) { toast(err.message, 'err'); }
    finally { btn.disabled = false; btn.textContent = 'Re-renderizar clip'; }
  });

  // --- Command Palette (⌘K / Ctrl+K) ---
  function showCommandPalette() {
    openModal('Paleta de comandos (⌘K)', (body) => {
      const actions = [
        { label: 'Abrir Brand Kits (marcas y estilos de subtítulos)', run: showBrandsModal },
        { label: 'Abrir cola FIFO de vídeos por lotes', run: showQueueModal },
        { label: 'Abrir gestor de almacenamiento y liberar VODs', run: showStorageModal },
        { label: 'Abrir Inspector NLE Pro (recorte, texto, portada, EDL)', run: openNleInspector },
        { label: 'Alternar Safe Zones 2026 (Universal / Shorts / TikTok / Reels)', run: cycleSafeZone },
        { label: 'Exportar todos los clips a Descargas/Vídeos', run: triggerExportAll },
        { label: 'Alternar Modo Eco (pausar animaciones decorativas)', run: toggleEcoMode },
      ];
      body.innerHTML = `<input id="pro-cmd-input" placeholder="Buscar acción…" style="width:100%;height:38px;padding:0 12px;border-radius:7px;border:1px solid var(--line-bright);background:var(--bg);color:var(--ink);font-size:13.5px"><div id="pro-cmd-list" style="display:flex;flex-direction:column;gap:6px"></div>`;
      const input = body.querySelector('#pro-cmd-input');
      const list = body.querySelector('#pro-cmd-list');
      const paint = (q = '') => {
        list.innerHTML = '';
        actions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase())).forEach((a) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'pro-row';
          btn.style.cssText = 'width:100%;text-align:left;cursor:pointer;color:var(--ink);font-size:13px';
          btn.textContent = a.label;
          btn.addEventListener('click', () => { closeModal(); a.run(); });
          list.appendChild(btn);
        });
      };
      input.addEventListener('input', () => paint(input.value));
      paint();
      setTimeout(() => input.focus(), 20);
    });
  }

  async function triggerExportAll() {
    try {
      const res = await api('/api/export', { method: 'POST', body: '{}' });
      toast(`Exportación lista en ${res.root || 'Descargas/Vídeos'}`, 'ok');
    } catch (err) { toast(err.message, 'err'); }
  }

  function toggleEcoMode() {
    const active = document.body.classList.toggle('eco-mode');
    try { localStorage.setItem('corte-eco-mode', active ? '1' : '0'); } catch {}
    byId('pro-eco-btn')?.classList.toggle('active', active);
    toast(active ? 'Modo Eco activado' : 'Modo Eco desactivado', 'info', 2000);
  }

  async function uploadLocalFile(file) {
    if (!file) return;
    toast(`Subiendo ${file.name} (${fmtBytes(file.size)})…`, 'info', 5000);
    try {
      const provider = byId('source-engine')?.value || 'gemini';
      const res = await fetch('/api/jobs/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-Provider': provider,
          'X-Mode': document.querySelector('.mode-btn.active')?.dataset?.mode || 'normal',
        },
        body: file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo procesar el archivo local.');
      toast(`"${file.name}" iniciado en Fase 02 (Whisper)`, 'ok', 4200);
      setTimeout(() => window.location.reload(), 900);
    } catch (err) { toast(err.message, 'err', 5000); }
  }

  function mountUI() {
    try { if (localStorage.getItem('corte-eco-mode') === '1') document.body.classList.add('eco-mode'); } catch {}

    // 1. Pro Toolbar
    const headerAnchor = byId('toggle-publish-drawer')?.parentElement || document.querySelector('header');
    if (headerAnchor && !byId('pro-toolbar')) {
      const bar = document.createElement('div');
      bar.className = 'pro-toolbar';
      bar.id = 'pro-toolbar';
      bar.innerHTML = `
        <button type="button" class="pro-btn" id="pro-brands-btn">Marcas</button>
        <button type="button" class="pro-btn" id="pro-queue-btn">Cola <span class="pro-badge" id="pro-queue-badge">0</span></button>
        <button type="button" class="pro-btn" id="pro-storage-btn">Disco</button>
        <button type="button" class="pro-btn" id="pro-nle-btn">Inspector NLE</button>
        <button type="button" class="pro-btn" id="pro-theme-btn" title="Cambiar tema visual">Carbon Pro</button>
        <button type="button" class="pro-btn" id="pro-eco-btn">Eco</button>
        <button type="button" class="pro-btn" id="pro-cmd-btn"><span class="pro-kbd">⌘K</span></button>`;
      headerAnchor.appendChild(bar);
      queueBadgeEl = byId('pro-queue-badge');
      byId('pro-brands-btn').addEventListener('click', showBrandsModal);
      byId('pro-queue-btn').addEventListener('click', showQueueModal);
      byId('pro-storage-btn').addEventListener('click', showStorageModal);
      byId('pro-nle-btn').addEventListener('click', openNleInspector);
      byId('pro-theme-btn').addEventListener('click', cycleTheme);
      byId('pro-eco-btn').addEventListener('click', toggleEcoMode);
      try { applyTheme(localStorage.getItem('corte-v5-theme') || 'carbon'); } catch { applyTheme('carbon'); }
      byId('pro-cmd-btn').addEventListener('click', showCommandPalette);
      if (document.body.classList.contains('eco-mode')) byId('pro-eco-btn').classList.add('active');
      refreshQueueBadge();
    }

    // 2. Local File Dropzone
    const form = byId('source-form');
    // 2b. V5 Prompt-Directed Clipping bar inside/below #source-form
    if (form && !byId('v5-focus-wrap')) {
      const fw = document.createElement('div');
      fw.className = 'v5-focus-wrap';
      fw.id = 'v5-focus-wrap';
      fw.innerHTML = `<span class="v5-focus-tag">Enfoque IA</span><input id="v5-focus-prompt" class="v5-focus-input" type="text" maxlength="260" placeholder="Opcional: dime qué momentos buscar (ej. solo sustos, clutches o consejos de dinero)…">`;
      form.insertAdjacentElement('afterend', fw);
    }

    if (form && !byId('pro-dropzone')) {
      const dz = document.createElement('div');
      dz.className = 'pro-dropzone';
      dz.id = 'pro-dropzone';
      dz.innerHTML = `
        <div class="pro-dropzone-text"><strong>¿Grabación local de OBS o podcast?</strong> Arrastra <code>.mp4</code>, <code>.mkv</code>, <code>.mov</code> o <code>.webm</code> aquí.</div>
        <label class="pro-btn" style="cursor:pointer">Elegir archivo<input type="file" id="pro-local-file" accept=".mp4,.mkv,.mov,.webm,video/*" hidden></label>`;
      form.insertAdjacentElement('afterend', dz);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
      dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('dragover'); uploadLocalFile(e.dataTransfer?.files?.[0]); });
      byId('pro-local-file').addEventListener('change', (e) => { uploadLocalFile(e.target.files?.[0]); e.target.value = ''; });
    }

    // 3. Bottom NLE Status Bar
    if (!byId('pro-statusbar')) {
      const sb = document.createElement('div');
      sb.className = 'pro-statusbar';
      sb.id = 'pro-statusbar';
      sb.innerHTML = `
        <div class="pro-status-group">
          <span><span class="pro-dot"></span>Corte Studio v5 Pro</span>
          <span id="pro-status-brand">Marca: cargando…</span>
        </div>
        <div class="pro-status-group pro-hide-sm">
          <span>Space Play</span><span>J/K/L Seek</span><span>I/O Trim</span><span>S Safe Zones</span><span>⌘K Comandos</span>
        </div>`;
      document.body.appendChild(sb);
      statusBrandEl = byId('pro-status-brand');
      refreshBrandStatus();
    }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); showCommandPalette(); return; }
    if (e.key === 'Escape') { closeModal(); dock.classList.remove('open'); return; }
    const tag = (e.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;

    const vid = document.querySelector('#clip-spotlight video, #project-monitor video');
    if (e.key === ' ' && vid) { e.preventDefault(); vid.paused ? vid.play().catch(() => {}) : vid.pause(); }
    else if (e.key.toLowerCase() === 'j' && vid) vid.currentTime = Math.max(0, vid.currentTime - 5);
    else if (e.key.toLowerCase() === 'k' && vid) vid.pause();
    else if (e.key.toLowerCase() === 'l' && vid) vid.currentTime = Math.min(vid.duration || vid.currentTime + 5, vid.currentTime + 5);
    else if (e.key.toLowerCase() === 's') cycleSafeZone();
    else if (e.key.toLowerCase() === 'i' && vid && dock.classList.contains('open')) {
      byId('pro-nle-start').value = vid.currentTime.toFixed(1);
      toast(`Inicio fijado en ${vid.currentTime.toFixed(1)}s`, 'info', 1600);
    } else if (e.key.toLowerCase() === 'o' && vid && dock.classList.contains('open')) {
      byId('pro-nle-end').value = vid.currentTime.toFixed(1);
      toast(`Fin fijado en ${vid.currentTime.toFixed(1)}s`, 'info', 1600);
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountUI);
  else mountUI();
})();
