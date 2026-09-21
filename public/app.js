(() => {
  'use strict';

  const state = {
    view: 'library',
    files: [],
    transfers: [],
    settings: null,
    scan: {},
    selected: new Set(),
    search: '',
    kind: 'all',
    sort: 'name',
    loading: true,
    refreshBusy: false,
    pendingLibraryRender: false,
    connectionResult: null,
  };

  const viewLabels = { library: 'Library', transfers: 'Transfers', settings: 'Settings' };
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

  const ICONS = {
    library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    activity: '<path d="M3 12h3l2.1-5.5L12 18l2.2-6H21"/><path d="M3 5v14M21 5v14" opacity=".35"/>',
    settings: '<path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.8 1.8 0 0 0-3 .9 1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.8 1.8 0 0 0-.9-3 1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.8 1.8 0 0 0 3-.9 1.8 1.8 0 1 1 3.6 0 1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.8 1.8 0 0 0 .9 3 1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 0-.9 3Z" opacity=".55"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0-14.7-4L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8.1 8.1 0 0 0 14.7 4L21 14"/><path d="M21 20v-6h-6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
    package: '<path d="m12 3 8 4.3v9.4L12 21l-8-4.3V7.3L12 3Z"/><path d="m4.4 7.5 7.6 4 7.6-4M12 11.5V21"/>',
    folder: '<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-10Z"/>',
    scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5v7M8.5 12h7" opacity=".5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.3 2"/>',
    hardDrive: '<path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5Z"/><path d="M7 14.5h.01M10 14.5h.01M13 14.5h.01M16 14.5h.01"/>',
    wifi: '<path d="M3 9.5a14.2 14.2 0 0 1 18 0M6.5 13a8.8 8.8 0 0 1 11 0M10 16.5a3.7 3.7 0 0 1 4 0"/><circle cx="12" cy="20" r=".7" fill="currentColor" stroke="none"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    trash: '<path d="M4 7h16M10 11v5M14 11v5M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    alert: '<path d="m12 3 9 17H3L12 3Z"/><path d="M12 9v4M12 16h.01"/>',
    server: '<rect x="4" y="4" width="16" height="6" rx="1.5"/><rect x="4" y="14" width="16" height="6" rx="1.5"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/>',
    playstation: '<path d="M8.2 5.2v11.5c0 1.2.8 1.8 1.8 1.4l2-.8V7.1c0-.6.4-1 1-1 2.6.2 5.6 1.6 5.6 3.7 0 2.2-2.6 1.8-4.3 1.3v2.2c3.6 1.1 6.8.5 6.8-2.8 0-3.3-4.2-5.8-8.7-6.7-1.5-.3-4.2-.4-4.2 1.4Z"/><path d="m4 15 4-1.2v2L4 17c-1.3.4-1.5-.8 0-2ZM13 18l7-2.2c1.3-.4 1.5.8 0 1.2L13 19.2"/>',
    dots: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
    moon: '<path d="M20 15.4A8.5 8.5 0 0 1 8.6 4a8.5 8.5 0 1 0 11.4 11.4Z"/>',
  };

  function icon(name, className = '') {
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unit = -1;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size >= 100 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
  }

  function formatDate(value, includeTime = false) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const options = includeTime
      ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }

  function relativeTime(value) {
    if (!value) return 'Not scanned yet';
    const diff = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(diff) || diff < 0) return 'Just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function kindClass(kind) { return String(kind || '').toLowerCase(); }
  function packageIcon(kind) { return `<span class="pkg-icon ${kindClass(kind)}">${icon('package')}</span>`; }
  function activeTransfers() { return state.transfers.filter((transfer) => !terminalStatuses.has(transfer.status)); }
  function selectedFiles() { return state.files.filter((file) => state.selected.has(file.id)); }

  // Background polling updates the library and transfer progress, but it must
  // never replace the active view while somebody is using it. The old
  // implementation re-rendered the whole view every 3.5 seconds, which made
  // every page visibly jump and made inputs lose focus and values in the
  // middle of typing.
  function shouldPreserveLiveForm() {
    if (state.view === 'settings') return true;
    const active = document.activeElement;
    return Boolean(active && active.id === 'library-search');
  }

  function fileSignature(files, scan) {
    const rows = (files || []).map((file) => `${file.id}:${file.size}:${file.modifiedAt}`).join('|');
    return `${rows}::${scan && scan.error ? scan.error : ''}`;
  }

  function transferSignature(transfers) {
    return (transfers || []).map((transfer) => [
      transfer.id,
      transfer.status,
      transfer.phase,
      transfer.percent,
      transfer.bytesTransferred,
      transfer.totalBytes,
      transfer.error,
      transfer.lastUpdated,
    ].join(':')).join('|');
  }

  function syncQueuePanel() {
    const queuePanel = document.getElementById('queue-panel');
    if (!queuePanel) return;
    const active = activeTransfers();
    const count = queuePanel.querySelector('#queue-active-count');
    const content = queuePanel.querySelector('#queue-content');
    if (count) count.textContent = `${active.length} active`;
    if (content) content.innerHTML = active.length
      ? active.slice(0, 5).map(renderQueueItem).join('')
      : `<div class="queue-empty"><div class="empty-icon">${icon('activity')}</div><strong>Your queue is clear</strong><span>Select packages above to send them to the PS4.</span></div>`;
  }

  function syncTransferList() {
    const list = document.getElementById('transfer-list');
    if (!list) return;
    const transfers = state.transfers;
    const count = document.getElementById('transfer-history-count');
    if (count) count.textContent = `${transfers.length} item${transfers.length === 1 ? '' : 's'}`;
    const domCards = [...list.querySelectorAll('[data-transfer-card]')];
    const domIds = domCards.map((card) => card.dataset.transferCard);
    const stateIds = transfers.map((transfer) => transfer.id);
    const collectionChanged = domIds.length !== stateIds.length || domIds.some((id, index) => id !== stateIds[index]);
    if (collectionChanged || (!transfers.length && !list.querySelector('.transfers-empty'))) {
      list.innerHTML = transfers.length
        ? transfers.map(renderTransferCard).join('')
        : `<div class="empty-state transfers-empty"><div class="empty-icon">${icon('activity')}</div><h3>No transfers yet</h3><p>Choose a PKG from your Library and press Install. Your delivery history will show up here.</p><button class="button primary" data-view="library" type="button">${icon('library')} Browse library</button></div>`;
      return;
    }

    for (const transfer of transfers) {
      const card = list.querySelector(`[data-transfer-card="${transfer.id}"]`);
      if (!card) continue;
      if (card.dataset.transferStatus !== transfer.status) {
        card.outerHTML = renderTransferCard(transfer);
        continue;
      }
      const percent = Math.max(transfer.percent || 0, transfer.status === 'queued' ? 2 : 0);
      const bar = card.querySelector('[data-transfer-progress]');
      const percentLabel = card.querySelector('[data-transfer-field="percent"]');
      const phase = card.querySelector('[data-transfer-field="phase"]');
      const updated = card.querySelector('[data-transfer-field="updated"]');
      if (bar) bar.style.width = `${percent}%`;
      if (percentLabel) percentLabel.textContent = `${Math.round(transfer.percent || 0)}%`;
      if (phase) phase.textContent = transfer.phase || 'Waiting';
      if (updated) updated.textContent = formatDate(transfer.lastUpdated || transfer.createdAt, true);
    }
  }

  function syncLiveView(filesChanged, transfersChanged) {
    if (state.view === 'settings') return;
    if (state.view === 'library') {
      if (filesChanged || state.pendingLibraryRender) {
        if (shouldPreserveLiveForm()) {
          state.pendingLibraryRender = true;
        } else {
          state.pendingLibraryRender = false;
          renderCurrentView();
        }
      } else {
        syncQueuePanel();
      }
      return;
    }
    if (state.view === 'transfers' && transfersChanged) syncTransferList();
  }

  async function api(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    let payload = {};
    try { payload = await response.json(); } catch { /* empty response */ }
    if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}.`);
    return payload;
  }

  function updateChrome() {
    document.querySelectorAll('[data-view]').forEach((element) => {
      element.classList.toggle('is-active', element.dataset.view === state.view && element.classList.contains('nav-item'));
    });
    const title = document.getElementById('page-title');
    if (title) title.textContent = viewLabels[state.view] || 'Library';
    const libraryCount = document.getElementById('library-count');
    if (libraryCount) libraryCount.textContent = String(state.scan.fileCount ?? state.files.length ?? 0);
    const transferCount = document.getElementById('transfer-count');
    if (transferCount) transferCount.textContent = String(activeTransfers().length);

    const serverPill = document.getElementById('server-pill');
    const serverPillText = document.getElementById('server-pill-text');
    const sidebarTitle = document.getElementById('sidebar-status-title');
    const sidebarDetail = document.getElementById('sidebar-status-detail');
    const hasPs4 = Boolean(state.settings && state.settings.ps4Host);
    const libraryReady = Boolean(state.settings && state.settings.libraryExists);
    if (serverPill && serverPillText) {
      serverPill.classList.toggle('is-muted', !hasPs4);
      serverPillText.textContent = hasPs4 ? 'PS4 configured' : 'PS4 not configured';
    }
    if (sidebarTitle && sidebarDetail) {
      sidebarTitle.textContent = hasPs4 ? 'PS4 ready to receive' : 'Waiting for PS4';
      sidebarDetail.textContent = libraryReady ? `${state.scan.fileCount || 0} package${state.scan.fileCount === 1 ? '' : 's'} indexed` : 'Configure a connection';
    }
  }

  function render(content) {
    const view = document.getElementById('view');
    if (!view) return;
    view.innerHTML = content;
    view.classList.remove('view-enter');
    void view.offsetWidth;
    view.classList.add('view-enter');
    updateChrome();
  }

  function renderLibrary() {
    const scan = state.scan || {};
    const settings = state.settings || {};
    const totalSize = scan.totalSize || state.files.reduce((total, file) => total + (Number(file.size) || 0), 0);
    const selectedCount = state.selected.size;
    const filtered = state.files.filter((file) => {
      const query = state.search.trim().toLowerCase();
      const matchesSearch = !query || `${file.name} ${file.relativePath} ${file.titleId}`.toLowerCase().includes(query);
      const matchesKind = state.kind === 'all' || kindClass(file.kind) === state.kind;
      return matchesSearch && matchesKind;
    }).sort((a, b) => {
      if (state.sort === 'size') return Number(b.size) - Number(a.size);
      if (state.sort === 'newest') return new Date(b.modifiedAt) - new Date(a.modifiedAt);
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    const ps4Copy = settings.ps4Host ? `Ready on ${escapeHtml(settings.ps4Host)}:${escapeHtml(settings.ps4Port)}` : 'Connect a PS4 in Settings';
    const listContent = !settings.libraryExists || scan.error
      ? `<div class="empty-state">
          <div class="empty-icon">${icon('folder')}</div>
          <h3>${scan.error ? 'Library folder needs attention' : 'Your package shelf is empty'}</h3>
          <p>${scan.error ? `${escapeHtml(scan.error)} Choose a mounted folder in Settings, then scan again.` : 'Mount your PKG storage at <code>/pkg</code>, or point Library folder to a different path. PKG Link will scan it for you.'}</p>
          <button class="button primary" data-view="settings" type="button">${icon('settings')} Open settings</button>
        </div>`
      : filtered.length === 0
        ? `<div class="empty-state">
            <div class="empty-icon">${icon(state.search || state.kind !== 'all' ? 'search' : 'package')}</div>
            <h3>${state.search || state.kind !== 'all' ? 'No matching packages' : 'No PKG files found'}</h3>
            <p>${state.search || state.kind !== 'all' ? 'Try a different title, CUSA ID, or package type.' : 'The mounted folder is available, but it does not contain any .pkg files yet.'}</p>
            ${state.search || state.kind !== 'all' ? '<button class="button ghost" data-action="clear-filters" type="button">Clear filters</button>' : `<button class="button ghost" data-action="scan" type="button">${icon('scan')} Scan again</button>`}
          </div>`
        : filtered.map((file) => renderFileRow(file)).join('');

    return `<div class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Local package library</span>
        <h1>Ship your library.<br /><em>Directly to the PS4.</em></h1>
        <p>Browse packages from mounted storage, then hand them to Remote Package Installer without copying them through your browser.</p>
        <div class="hero-actions">
          <button class="button primary" data-action="install-selected" type="button" ${selectedCount ? '' : 'disabled'}>${icon('upload')} ${selectedCount ? `Install ${selectedCount} selected` : 'Select packages to install'}</button>
          <button class="button ghost" data-action="scan" type="button">${icon('scan')} ${scan.scanning ? 'Scanning…' : 'Scan library'}</button>
        </div>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="network-node"><div class="node">${icon('hardDrive')}</div><div class="connection-line"><span></span></div><div class="node ps">${icon('playstation')}</div></div>
        <span class="node-label left">MOUNTED STORAGE</span><span class="node-label right">PS4 / RPI</span>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon">${icon('package')}</div><div class="stat-copy"><strong>${scan.fileCount ?? state.files.length}</strong><span>Packages indexed</span></div></div>
      <div class="stat-card"><div class="stat-icon lavender">${icon('hardDrive')}</div><div class="stat-copy"><strong>${formatBytes(totalSize)}</strong><span>Library footprint</span></div></div>
      <div class="stat-card"><div class="stat-icon peach">${icon('clock')}</div><div class="stat-copy"><strong>${relativeTime(scan.lastScanAt)}</strong><span>Last automatic scan</span></div></div>
      <div class="stat-card"><div class="stat-icon yellow">${icon('wifi')}</div><div class="stat-copy"><strong>${settings.ps4Host ? 'Ready' : 'Setup'}</strong><span>${ps4Copy}</span></div></div>
    </div>
    <div class="workspace-grid">
      <section class="library-panel">
        <div class="panel-header">
          <div class="panel-title"><h2>Package library</h2><span>${filtered.length}${filtered.length !== state.files.length ? ` / ${state.files.length}` : ''} files</span></div>
          <div class="folder-location" title="${escapeHtml(settings.libraryPath || '')}">${icon('folder')}<span>${escapeHtml(settings.libraryPath || 'No library folder configured')}</span></div>
        </div>
        ${scan.error ? `<div class="scan-error">${icon('alert')}<span>${escapeHtml(scan.error)}</span></div>` : ''}
        <div class="toolbar">
          <label class="search-box">${icon('search')}<input id="library-search" type="search" placeholder="Search titles, CUSA IDs, filenames…" value="${escapeHtml(state.search)}" autocomplete="off" /></label>
          <select id="library-sort" class="select-control" aria-label="Sort packages"><option value="name" ${state.sort === 'name' ? 'selected' : ''}>Name</option><option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option><option value="size" ${state.sort === 'size' ? 'selected' : ''}>Largest</option></select>
          <button class="button ghost small scan-button" data-action="scan" type="button" title="Scan mounted storage">${icon('refresh')}<span class="desktop-only">Refresh</span></button>
          <div class="filter-group" role="group" aria-label="Package type"><button class="filter-button ${state.kind === 'all' ? 'is-active' : ''}" data-kind="all" type="button">All</button><button class="filter-button ${state.kind === 'base' ? 'is-active' : ''}" data-kind="base" type="button">Base</button><button class="filter-button ${state.kind === 'update' ? 'is-active' : ''}" data-kind="update" type="button">Updates</button><button class="filter-button ${state.kind === 'dlc' ? 'is-active' : ''}" data-kind="dlc" type="button">DLC</button></div>
        </div>
        <div class="file-list">
          ${filtered.length && settings.libraryExists ? `<div class="file-list-head"><span></span><span>Package</span><span>Type</span><span>Size</span><span>Modified</span><span></span></div>${listContent}` : listContent}
        </div>
        ${filtered.length && settings.libraryExists ? `<div class="list-footer"><span>Showing <strong>${filtered.length}</strong> package${filtered.length === 1 ? '' : 's'}</span><span>${scan.skipped ? `${scan.skipped} item${scan.skipped === 1 ? '' : 's'} skipped` : `Auto-scan every ${settings.scanIntervalSec || 30}s`}</span></div>` : ''}
      </section>
      ${renderQueuePanel()}
    </div>`;
  }

  function renderFileRow(file) {
    const checked = state.selected.has(file.id);
    const kind = kindClass(file.kind);
    return `<div class="file-row" data-file-row="${escapeHtml(file.id)}">
      <button class="checkbox ${checked ? 'is-checked' : ''}" data-action="toggle-file" data-file-id="${escapeHtml(file.id)}" type="button" aria-label="${checked ? 'Deselect' : 'Select'} ${escapeHtml(file.name)}" aria-pressed="${checked}">${checked ? icon('check') : ''}</button>
      <div class="file-name-cell">${packageIcon(file.kind)}<div class="file-name"><strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong><span title="${escapeHtml(file.relativePath)}">${escapeHtml(file.titleId || file.relativePath)}</span></div></div>
      <span class="kind-tag ${kind}">${escapeHtml(file.kind || 'PKG')}</span>
      <span class="file-meta mono">${formatBytes(file.size)}</span>
      <span class="file-meta">${formatDate(file.modifiedAt)}</span>
      <div class="row-action"><button class="button small primary" data-action="install-file" data-file-id="${escapeHtml(file.id)}" type="button">${icon('upload')}<span>Install</span></button></div>
    </div>`;
  }

  function renderQueuePanel() {
    const queued = activeTransfers().slice(0, 5);
    const selectedCount = state.selected.size;
    return `<aside class="queue-panel" id="queue-panel">
      <div class="panel-header"><div class="panel-title"><h2>Transfer queue</h2><span id="queue-active-count">${activeTransfers().length} active</span></div><button class="icon-button tiny" data-view="transfers" type="button" aria-label="Open transfer history" title="Open transfer history">${icon('chevron')}</button></div>
      <div class="queue-content" id="queue-content">${queued.length ? queued.map(renderQueueItem).join('') : `<div class="queue-empty"><div class="empty-icon">${icon('activity')}</div><strong>Your queue is clear</strong><span>Select packages above to send them to the PS4.</span></div>`}</div>
      ${selectedCount ? `<div class="queue-footer"><p><strong>${selectedCount} package${selectedCount === 1 ? '' : 's'}</strong> selected and ready.</p><button class="button primary full" data-action="install-selected" type="button">${icon('upload')} Add to transfer queue</button></div>` : `<div class="queue-footer"><p>PKG Link serves files to your console over the local network.</p><button class="button ghost full" data-view="settings" type="button">${icon('settings')} Check connection settings</button></div>`}
    </aside>`;
  }

  function renderQueueItem(transfer) {
    const isFailed = transfer.status === 'failed';
    const statusClass = transfer.status === 'queued' ? 'queued' : isFailed ? 'failed' : '';
    return `<div class="queue-item"><div class="queue-item-top"><div class="queue-item-icon">${icon(isFailed ? 'alert' : transfer.status === 'completed' ? 'check' : 'package')}</div><div class="queue-item-name"><strong title="${escapeHtml(transfer.fileName)}">${escapeHtml(transfer.fileName)}</strong><span>${escapeHtml(transfer.phase || 'Waiting')}</span></div><span class="queue-status ${statusClass}">${transfer.status === 'queued' ? 'Queued' : `${Math.round(transfer.percent || 0)}%`}</span></div><div class="progress-track"><div class="progress-bar" style="width:${Math.max(transfer.percent || 0, transfer.status === 'queued' ? 2 : 0)}%"></div></div><div class="queue-item-meta"><span>${formatBytes(transfer.bytesTransferred || 0)} / ${formatBytes(transfer.totalBytes || transfer.size)}</span>${!terminalStatuses.has(transfer.status) ? `<button class="queue-item-cancel" data-action="cancel-transfer" data-transfer-id="${escapeHtml(transfer.id)}" type="button">Cancel</button>` : `<span>${transfer.status === 'failed' ? 'Needs attention' : 'In queue'}</span>`}</div></div>`;
  }

  function renderTransfers() {
    const list = state.transfers;
    return `<div class="page-heading"><div><span class="eyebrow">Delivery center</span><h1>Transfers</h1><p>Watch packages move from mounted storage to your PS4. PKG Link queues one request at a time so Remote Package Installer stays responsive.</p></div><div class="heading-actions"><button class="button ghost" data-action="refresh" type="button">${icon('refresh')} Refresh</button>${list.length ? `<button class="button danger" data-action="clear-history" type="button">${icon('trash')} Clear history</button>` : ''}</div></div>
      <section class="transfer-panel" id="transfer-panel"><div class="panel-header"><div class="panel-title"><h2>Transfer history</h2><span id="transfer-history-count">${list.length} item${list.length === 1 ? '' : 's'}</span></div><span class="folder-location">${icon('server')}${state.settings && state.settings.ps4Host ? escapeHtml(state.settings.ps4Host) : 'PS4 not configured'}</span></div><div class="transfer-list" id="transfer-list">${list.length ? list.map(renderTransferCard).join('') : `<div class="empty-state transfers-empty"><div class="empty-icon">${icon('activity')}</div><h3>No transfers yet</h3><p>Choose a PKG from your Library and press Install. Your delivery history will show up here.</p><button class="button primary" data-view="library" type="button">${icon('library')} Browse library</button></div>`}</div></section>`;
  }

  function renderTransferCard(transfer) {
    const failed = transfer.status === 'failed';
    const complete = transfer.status === 'completed';
    const statusClass = transfer.status === 'queued' ? 'queued' : failed ? 'failed' : complete ? 'completed' : '';
    const percent = Math.max(transfer.percent || 0, transfer.status === 'queued' ? 2 : 0);
    return `<div class="transfer-card" data-transfer-card="${escapeHtml(transfer.id)}" data-transfer-status="${escapeHtml(transfer.status)}"><div class="transfer-card-icon ${statusClass}">${icon(failed ? 'alert' : complete ? 'check' : 'package')}</div><div class="transfer-main"><div class="transfer-name" title="${escapeHtml(transfer.fileName)}">${escapeHtml(transfer.fileName)}</div><div class="transfer-path" title="${escapeHtml(transfer.relativePath)}">${escapeHtml(transfer.relativePath)} · ${formatBytes(transfer.size)}</div></div><div class="transfer-progress"><div class="progress-track"><div class="progress-bar" data-transfer-progress style="width:${percent}%"></div></div><div class="transfer-progress-meta"><span data-transfer-field="phase">${escapeHtml(transfer.phase || 'Waiting')}</span><span data-transfer-field="updated">${formatDate(transfer.lastUpdated || transfer.createdAt, true)}</span></div></div><div class="transfer-percent" data-transfer-field="percent">${Math.round(transfer.percent || 0)}%</div><span class="transfer-state ${statusClass}">${escapeHtml(transfer.status === 'downloading' ? 'Transferring' : transfer.status === 'completed' ? 'Complete' : transfer.status === 'failed' ? 'Failed' : transfer.status === 'cancelled' ? 'Cancelled' : transfer.status === 'sending' ? 'Contacting' : 'Queued')}</span>${!terminalStatuses.has(transfer.status) ? `<button class="icon-button tiny" data-action="cancel-transfer" data-transfer-id="${escapeHtml(transfer.id)}" type="button" aria-label="Cancel ${escapeHtml(transfer.fileName)}" title="Cancel transfer">${icon('close')}</button>` : '<span></span>'}${transfer.error ? `<div class="transfer-error">${icon('alert')} ${escapeHtml(transfer.error)}</div>` : ''}</div>`;
  }

  function renderSettings() {
    const settings = state.settings || { libraryPath: '/pkg', autoScan: true, scanIntervalSec: 30, ps4Host: '', ps4Port: 12801, publicBaseUrl: '', requestTimeoutSec: 60, pollIntervalSec: 2 };
    const result = state.connectionResult;
    return `<div class="settings-layout"><section class="settings-panel"><div class="settings-intro"><span class="eyebrow">Workspace controls</span><h1>Settings</h1><p>Tell PKG Link where the mounted files live and how to reach Remote Package Installer on your console. Changes are saved to the persistent data volume.</p></div><form id="settings-form" class="settings-form">
      <div class="form-section"><div class="form-section-heading"><div class="form-section-icon">${icon('folder')}</div><div><strong>Package library</strong><span>Scan the folder mounted inside this container.</span></div></div><div class="form-grid"><label class="form-field wide"><span class="form-label">Library folder <span class="form-hint">server path</span></span><input class="form-input mono" name="libraryPath" value="${escapeHtml(settings.libraryPath || '')}" placeholder="/pkg" required /></label><div class="form-field"><span class="form-label">Automatic scanning</span><div class="switch-field"><div class="switch-copy"><strong>Keep the library fresh</strong><span>Rescan on a timer</span></div><label class="switch"><input type="checkbox" name="autoScan" ${settings.autoScan !== false ? 'checked' : ''} /><span class="switch-track"></span></label></div></div><label class="form-field"><span class="form-label">Scan interval <span class="form-hint">seconds</span></span><div class="input-with-suffix"><input class="form-input" name="scanIntervalSec" type="number" min="5" max="3600" value="${escapeHtml(settings.scanIntervalSec || 30)}" /><span class="input-suffix">sec</span></div></label></div></div>
      <div class="form-section"><div class="form-section-heading"><div class="form-section-icon lavender">${icon('playstation')}</div><div><strong>PS4 connection</strong><span>Remote Package Installer API endpoint.</span></div></div><div class="form-grid"><label class="form-field"><span class="form-label">PS4 IP address or host</span><input class="form-input mono" name="ps4Host" value="${escapeHtml(settings.ps4Host || '')}" placeholder="192.168.1.42" autocomplete="off" /></label><label class="form-field"><span class="form-label">RPI port <span class="form-hint">default 12801</span></span><input class="form-input mono" name="ps4Port" type="number" min="1" max="65535" value="${escapeHtml(settings.ps4Port || 12801)}" /></label><div class="form-field wide"><button class="button ghost" id="test-connection" data-action="test-connection" type="button">${icon('wifi')} Test PS4 connection</button><div id="connection-result" class="connection-result ${result ? `is-visible ${result.ok ? 'success' : 'error'}` : ''}">${result ? `${icon(result.ok ? 'check' : 'alert')} ${escapeHtml(result.message)}` : ''}</div></div></div></div>
      <div class="form-section"><div class="form-section-heading"><div class="form-section-icon peach">${icon('server')}</div><div><strong>Server access</strong><span>How the PS4 reaches package files in this container.</span></div></div><div class="form-grid"><label class="form-field wide"><span class="form-label">Public package URL <span class="form-hint">recommended for Docker</span></span><input class="form-input mono" name="publicBaseUrl" value="${escapeHtml(settings.publicBaseUrl || '')}" placeholder="http://192.168.1.10:8080" /><span class="form-hint">Use the host LAN address and published port, not localhost. Leave blank only when the detected address is reachable by the PS4. Detected now: <code>${escapeHtml(settings.resolvedPublicUrl || 'unknown')}</code></span></label><label class="form-field"><span class="form-label">Request timeout <span class="form-hint">seconds</span></span><input class="form-input" name="requestTimeoutSec" type="number" min="10" max="300" value="${escapeHtml(settings.requestTimeoutSec || 60)}" /></label><label class="form-field"><span class="form-label">Progress polling <span class="form-hint">seconds</span></span><input class="form-input" name="pollIntervalSec" type="number" min="1" max="10" value="${escapeHtml(settings.pollIntervalSec || 2)}" /></label></div></div>
      <div class="form-row-actions"><span class="save-note">${settings.libraryExists ? `Library found · ${state.scan.fileCount || 0} packages indexed` : 'Library folder is not available yet'}</span><button class="button primary" type="submit">${icon('check')} Save settings</button></div>
    </form></section><aside class="info-column"><div class="info-card"><h3>${icon('folder')} Container storage</h3><p>Mount your host game folder at <code>/pkg</code> and it will appear here after the next scan.</p><ul><li>Use a read-only mount when possible.</li><li>Subfolders are scanned recursively.</li><li>Only files ending in <code>.pkg</code> are indexed.</li></ul><div class="callout">${icon('info')}<span>For Docker Compose, use <code>./games:/pkg:ro</code> and <code>./data:/data</code>.</span></div></div><div class="info-card"><h3>${icon('wifi')} How delivery works</h3><p>PKG Link sends a direct install request to the PS4 RPI endpoint. The PS4 then pulls the selected package from this app over HTTP with range support.</p><ul><li>Keep the PS4 and Docker host on the same LAN.</li><li>Start HEN / Remote Package Installer first.</li><li>Set Public package URL to the Docker host LAN IP.</li></ul></div></aside></div>`;
  }

  function renderCurrentView() {
    state.pendingLibraryRender = false;
    if (state.view === 'transfers') render(renderTransfers());
    else if (state.view === 'settings') render(renderSettings());
    else render(renderLibrary());
  }

  function showToast(title, message, type = 'success') {
    const region = document.getElementById('toast-region');
    if (!region) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-icon">${icon(type === 'error' ? 'alert' : 'check')}</div><p><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</p>`;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 5200);
  }

  async function refreshData({ quiet = false, forceRender = false } = {}) {
    if (state.refreshBusy) return;
    state.refreshBusy = true;
    try {
      const previousFilesSignature = fileSignature(state.files, state.scan);
      const previousTransferSignature = transferSignature(state.transfers);
      const [filesPayload, transfersPayload, settingsPayload] = await Promise.all([
        api('/api/files'),
        api('/api/transfers'),
        api('/api/settings'),
      ]);
      state.files = filesPayload.files || [];
      state.scan = filesPayload.scan || {};
      state.transfers = transfersPayload.transfers || [];
      state.settings = settingsPayload.settings || state.settings;
      for (const id of [...state.selected]) if (!state.files.some((file) => file.id === id)) state.selected.delete(id);
      const firstRefresh = state.loading;
      const filesChanged = previousFilesSignature !== fileSignature(state.files, state.scan);
      const transfersChanged = previousTransferSignature !== transferSignature(state.transfers);
      state.loading = false;
      if (forceRender || firstRefresh) renderCurrentView();
      else {
        updateChrome();
        syncLiveView(filesChanged, transfersChanged);
      }
    } catch (error) {
      state.loading = false;
      if (!quiet) showToast('Library unavailable', error.message, 'error');
      const pill = document.getElementById('server-pill');
      const pillText = document.getElementById('server-pill-text');
      if (pill && pillText) { pill.classList.add('is-muted'); pillText.textContent = 'Server unavailable'; }
    } finally {
      state.refreshBusy = false;
    }
  }

  async function startTransfers(ids) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) {
      showToast('Nothing selected', 'Choose one or more PKG files first.', 'error');
      return;
    }
    if (!state.settings || !state.settings.ps4Host) {
      state.view = 'settings';
      state.connectionResult = null;
      renderCurrentView();
      showToast('Connect a PS4 first', 'Add the console IP address in Settings, then save.', 'error');
      return;
    }
    try {
      await api('/api/transfers', { method: 'POST', body: JSON.stringify({ fileIds: unique }) });
      state.selected.clear();
      await refreshData({ quiet: true });
      showToast('Added to transfer queue', `${unique.length} package${unique.length === 1 ? '' : 's'} will be sent one at a time.`);
    } catch (error) {
      showToast('Could not start transfer', error.message, 'error');
    }
  }

  async function scan() {
    try {
      await api('/api/scan', { method: 'POST' });
      await refreshData({ quiet: true });
      showToast('Library scanned', `${state.scan.fileCount || 0} package${state.scan.fileCount === 1 ? '' : 's'} indexed.`);
    } catch (error) {
      showToast('Scan failed', error.message, 'error');
    }
  }

  async function cancelTransfer(id) {
    try {
      await api(`/api/transfers/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
      await refreshData({ quiet: true });
      showToast('Transfer cancelled', 'The queue has been updated.');
    } catch (error) { showToast('Could not cancel transfer', error.message, 'error'); }
  }

  async function clearHistory() {
    try {
      await api('/api/transfers', { method: 'DELETE' });
      await refreshData({ quiet: true });
      showToast('History cleared', 'Completed transfer entries were removed.');
    } catch (error) { showToast('Could not clear history', error.message, 'error'); }
  }

  async function testConnection() {
    const button = document.getElementById('test-connection');
    const result = document.getElementById('connection-result');
    const form = document.getElementById('settings-form');
    const formData = form ? new FormData(form) : null;
    const connection = {
      ps4Host: formData ? String(formData.get('ps4Host') || '').trim() : '',
      ps4Port: formData ? Number(formData.get('ps4Port')) : 12801,
    };
    if (button) { button.disabled = true; button.innerHTML = `${icon('refresh')} Testing…`; }
    try {
      const payload = await api('/api/connection/test', { method: 'POST', body: JSON.stringify(connection) });
      state.connectionResult = { ok: true, message: payload.message || 'PS4 Remote Package Installer responded.' };
      if (result) { result.className = 'connection-result is-visible success'; result.innerHTML = `${icon('check')} ${escapeHtml(state.connectionResult.message)}`; }
      showToast('Connection successful', 'The PS4 RPI endpoint responded.');
    } catch (error) {
      state.connectionResult = { ok: false, message: error.message };
      if (result) { result.className = 'connection-result is-visible error'; result.innerHTML = `${icon('alert')} ${escapeHtml(error.message)}`; }
      showToast('Connection failed', error.message, 'error');
    } finally {
      if (button) { button.disabled = false; button.innerHTML = `${icon('wifi')} Test PS4 connection`; }
    }
  }

  async function saveSettings(form) {
    const formData = new FormData(form);
    const payload = {
      libraryPath: formData.get('libraryPath'),
      autoScan: form.elements.autoScan.checked,
      scanIntervalSec: Number(formData.get('scanIntervalSec')),
      ps4Host: formData.get('ps4Host'),
      ps4Port: Number(formData.get('ps4Port')),
      publicBaseUrl: formData.get('publicBaseUrl'),
      requestTimeoutSec: Number(formData.get('requestTimeoutSec')),
      pollIntervalSec: Number(formData.get('pollIntervalSec')),
    };
    const submit = form.querySelector('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.innerHTML = `${icon('refresh')} Saving…`; }
    try {
      const response = await api('/api/settings', { method: 'PATCH', body: JSON.stringify(payload) });
      state.settings = response.settings;
      state.scan = response.scan;
      state.connectionResult = null;
      // The settings view is intentionally protected from background renders;
      // explicitly redraw it after a successful save so server-side clamping
      // and the latest scan summary are visible.
      await refreshData({ quiet: true, forceRender: true });
      showToast('Settings saved', 'Your library and PS4 connection are ready to use.');
    } catch (error) {
      showToast('Settings not saved', error.message, 'error');
    } finally {
      if (submit) { submit.disabled = false; submit.innerHTML = `${icon('check')} Save settings`; }
    }
  }

  function clearFilters() {
    state.search = '';
    state.kind = 'all';
    renderCurrentView();
  }

  document.addEventListener('click', async (event) => {
    const viewTrigger = event.target.closest('[data-view]');
    if (viewTrigger) {
      event.preventDefault();
      state.view = viewTrigger.dataset.view;
      state.connectionResult = null;
      renderCurrentView();
      return;
    }

    const kindTrigger = event.target.closest('[data-kind]');
    if (kindTrigger) {
      state.kind = kindTrigger.dataset.kind;
      renderCurrentView();
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;
    const actionName = action.dataset.action;
    if (actionName === 'toggle-file') {
      const id = action.dataset.fileId;
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      renderCurrentView();
    } else if (actionName === 'install-file') {
      await startTransfers([action.dataset.fileId]);
    } else if (actionName === 'install-selected') {
      await startTransfers([...state.selected]);
    } else if (actionName === 'scan') {
      action.disabled = true;
      await scan();
    } else if (actionName === 'refresh') {
      await refreshData();
    } else if (actionName === 'cancel-transfer') {
      await cancelTransfer(action.dataset.transferId);
    } else if (actionName === 'clear-history') {
      await clearHistory();
    } else if (actionName === 'test-connection') {
      await testConnection();
    } else if (actionName === 'clear-filters') {
      clearFilters();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target.id === 'library-search') {
      state.search = event.target.value;
      renderCurrentView();
      const search = document.getElementById('library-search');
      if (search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'library-sort') {
      state.sort = event.target.value;
      renderCurrentView();
    }
  });

  document.addEventListener('submit', async (event) => {
    if (event.target.id === 'settings-form') {
      event.preventDefault();
      await saveSettings(event.target);
    }
  });

  async function init() {
    try {
      const bootstrap = await api('/api/bootstrap');
      state.files = bootstrap.files || [];
      state.transfers = bootstrap.transfers || [];
      state.settings = bootstrap.settings || {};
      state.scan = bootstrap.scan || {};
      state.loading = false;
      renderCurrentView();
    } catch (error) {
      state.loading = false;
      render(`<div class="empty-state"><div class="empty-icon">${icon('alert')}</div><h3>PKG Link could not start</h3><p>${escapeHtml(error.message)} Refresh the page after the container is ready.</p><button class="button primary" data-action="refresh" type="button">${icon('refresh')} Try again</button></div>`);
      showToast('Startup error', error.message, 'error');
    }
    // Auto-scan happens on the server; polling keeps the visible library and
    // transfer progress current without requiring a websocket connection.
    setInterval(() => refreshData({ quiet: true }), 3500);
  }

  init();
})();
