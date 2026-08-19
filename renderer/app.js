const api = window.qtau;

const STATUS_LABEL = {
  checking: 'Prüfe…',
  updating: 'Aktualisiere…',
  upToDate: 'Aktuell',
  outOfDate: 'Update',
  local: 'Kein Git',
  dirty: 'Lokal geändert',
  error: 'Fehler',
  invalid: 'Ungültig'
};

const PANELS = {
  settings: { overlay: 'settingsOverlay', button: 'settingsBtn' },
  git: { overlay: 'gitOverlay', button: 'gitBtn' },
  log: { overlay: 'logOverlay', button: 'logBtn' }
};

const els = {
  addonsDir: document.getElementById('addonsDir'),
  launcherPath: document.getElementById('launcherPath'),
  autoUpdate: document.getElementById('autoUpdate'),
  autoLaunch: document.getElementById('autoLaunch'),
  forceUpdate: document.getElementById('forceUpdate'),
  addonList: document.getElementById('addonList'),
  addonCount: document.getElementById('addonCount'),
  busyLabel: document.getElementById('busyLabel'),
  gitUrl: document.getElementById('gitUrl'),
  gitFolder: document.getElementById('gitFolder'),
  log: document.getElementById('log')
};

let config = {};
let addons = [];
let busy = false;
let tooltipEl;

function log(message, level = 'info') {
  const time = new Date().toLocaleTimeString('de-DE', { hour12: false });
  const line = document.createElement('div');
  line.className = level;
  line.textContent = `[${time}] ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function setBusy(value, label) {
  busy = value;
  els.busyLabel.textContent = label || (value ? 'Arbeitet…' : 'Bereit');
  document.getElementById('scanBtn').disabled = value;
  document.getElementById('updateBtn').disabled = value;
  document.getElementById('addGit').disabled = value;
}

function isOpen(name) {
  return !document.getElementById(PANELS[name].overlay).classList.contains('hidden');
}

function closePanel(name) {
  document.getElementById(PANELS[name].overlay).classList.add('hidden');
  document.getElementById(PANELS[name].button).classList.remove('active');
}

function openPanel(name) {
  hideTooltip();
  for (const key of Object.keys(PANELS)) {
    if (key === name) continue;
    closePanel(key);
  }
  document.getElementById(PANELS[name].overlay).classList.remove('hidden');
  document.getElementById(PANELS[name].button).classList.add('active');
}

function togglePanel(name) {
  if (isOpen(name)) closePanel(name);
  else openPanel(name);
}

function upsertAddon(partial) {
  if (!partial || !partial.folder) return;
  const idx = addons.findIndex((a) => a.folder === partial.folder);
  if (idx === -1) addons.push({ ...partial });
  else addons[idx] = { ...addons[idx], ...partial };
  addons.sort((a, b) => a.folder.localeCompare(b.folder));
  renderAddons();
}

function hoverText(addon) {
  const title = addon.title || addon.folder;
  return [
    addon.notes,
    addon.folder !== title ? addon.folder : '',
    addon.version ? `Version ${addon.version}` : '',
    addon.author ? `Autor: ${addon.author}` : '',
    addon.branch ? `Branch: ${addon.branch}` : '',
    addon.git || addon.suggestedGit || '',
    addon.error || ''
  ]
    .filter(Boolean)
    .join('\n');
}

function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'addon-tooltip hidden';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showTooltip(row, text) {
  if (!text) return;
  const tip = tooltip();
  tip.textContent = text;
  tip.classList.remove('hidden');
  const rect = row.getBoundingClientRect();
  tip.style.left = `${Math.min(rect.left + 8, window.innerWidth - 280)}px`;
  tip.style.top = `${rect.bottom + 6}px`;
  const box = tip.getBoundingClientRect();
  if (box.bottom > window.innerHeight - 8) {
    tip.style.top = `${rect.top - box.height - 6}px`;
  }
}

function hideTooltip() {
  tooltip().classList.add('hidden');
}

function renderAddons() {
  hideTooltip();
  els.addonCount.textContent = addons.length ? `${addons.length} gefunden` : '';
  if (!addons.length) {
    els.addonList.innerHTML = '<div class="empty">Kein Addon gefunden. Addons-Ordner in den Einstellungen wählen.</div>';
    return;
  }

  els.addonList.innerHTML = '';
  for (const addon of addons) {
    const row = document.createElement('div');
    row.className = 'addon';

    const name = document.createElement('div');
    name.innerHTML = `<strong>${escapeHtml(addon.title || addon.folder)}</strong>`;

    const details = hoverText(addon);
    if (details) {
      row.addEventListener('mouseenter', () => showTooltip(row, details));
      row.addEventListener('mouseleave', hideTooltip);
    }

    const pill = document.createElement('div');
    pill.className = `pill ${addon.status || 'local'}`;
    pill.textContent =
      addon.error && addon.status === 'error'
        ? addon.error
        : STATUS_LABEL[addon.status] || addon.status || '—';

    const actions = document.createElement('div');
    actions.className = 'addon-actions';
    if (addon.status === 'outOfDate' || addon.status === 'dirty' || addon.status === 'error') {
      actions.appendChild(actionButton('Update', () => updateFolders([addon.folder])));
    }
    if (addon.status === 'local') {
      actions.appendChild(
        actionButton('Binden', () => {
          els.gitFolder.value = addon.folder;
          els.gitUrl.value = addon.suggestedGit || addon.git || '';
          openPanel('git');
          els.gitUrl.focus();
        })
      );
    }

    row.append(name, pill, actions);
    els.addonList.appendChild(row);
  }
}

function actionButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ghost tiny';
  btn.textContent = label;
  btn.disabled = busy;
  btn.addEventListener('click', onClick);
  return btn;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function applyConfig(next) {
  config = next;
  els.addonsDir.value = next.addonsDir || '';
  els.launcherPath.value = next.launcherPath || '';
  els.autoUpdate.checked = Boolean(next.autoUpdate);
  els.autoLaunch.checked = Boolean(next.autoLaunch);
  els.forceUpdate.checked = Boolean(next.forceUpdate);
}

async function savePaths() {
  config = await api.setConfig({
    addonsDir: els.addonsDir.value.trim(),
    launcherPath: els.launcherPath.value.trim()
  });
}

async function scan() {
  setBusy(true, 'Scanne Addons…');
  addons = [];
  renderAddons();
  try {
    const result = await api.scan();
    if (result.error) log(result.error, 'error');
    if (result.addons) {
      addons = result.addons;
      renderAddons();
    }
    return result.addons || [];
  } catch (err) {
    log(err.message || String(err), 'error');
    return [];
  } finally {
    setBusy(false, 'Bereit');
  }
}

async function updateFolders(folders) {
  setBusy(true, 'Aktualisiere…');
  try {
    await api.update({ folders, force: els.forceUpdate.checked });
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Bereit');
  }
}

async function updateAll() {
  setBusy(true, 'Aktualisiere…');
  try {
    await api.update({ force: els.forceUpdate.checked });
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Bereit');
  }
}

async function addGit() {
  const url = els.gitUrl.value.trim();
  if (!url) return;
  setBusy(true, 'Klone…');
  try {
    await api.install({ url, folder: els.gitFolder.value.trim() });
    els.gitUrl.value = '';
    els.gitFolder.value = '';
    closePanel('git');
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Bereit');
  }
}

async function launch() {
  try {
    log('Starte Launcher / Client…', 'ok');
    await api.launch();
  } catch (err) {
    log(err.message || String(err), 'error');
  }
}

api.onProgress((payload) => {
  if (!payload) return;
  if (payload.type === 'log') log(payload.message, payload.level || 'info');
  if (payload.type === 'addon') upsertAddon(payload.addon);
  if (payload.type === 'busy') setBusy(payload.value, payload.label);
  if (payload.type === 'progress' && payload.folder) {
    upsertAddon({
      folder: payload.folder,
      status: 'updating',
      error: payload.phase ? `${payload.phase} ${payload.percent ?? ''}%`.trim() : ''
    });
  }
});

document.getElementById('settingsBtn').addEventListener('click', () => togglePanel('settings'));
document.getElementById('gitBtn').addEventListener('click', () => {
  togglePanel('git');
  if (isOpen('git')) els.gitUrl.focus();
});
document.getElementById('logBtn').addEventListener('click', () => togglePanel('log'));

for (const overlay of document.querySelectorAll('.overlay')) {
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) overlay.classList.add('hidden');
    for (const [name, panel] of Object.entries(PANELS)) {
      if (panel.overlay === overlay.id) {
        document.getElementById(panel.button).classList.remove('active');
      }
    }
  });
}

for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', () => {
    const overlay = document.getElementById(btn.getAttribute('data-close'));
    overlay.classList.add('hidden');
    for (const [name, panel] of Object.entries(PANELS)) {
      if (panel.overlay === overlay.id) document.getElementById(panel.button).classList.remove('active');
    }
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  for (const name of Object.keys(PANELS)) closePanel(name);
});

document.getElementById('pickAddons').addEventListener('click', async () => {
  const dir = await api.pickFolder();
  if (!dir) return;
  els.addonsDir.value = dir;
  await savePaths();
  await scan();
});

document.getElementById('pickLauncher').addEventListener('click', async () => {
  const file = await api.pickFile();
  if (!file) return;
  els.launcherPath.value = file;
  await savePaths();
});

els.addonsDir.addEventListener('change', savePaths);
els.launcherPath.addEventListener('change', savePaths);

for (const key of ['autoUpdate', 'autoLaunch', 'forceUpdate']) {
  els[key].addEventListener('change', async () => {
    config = await api.setConfig({ [key]: els[key].checked });
  });
}

els.addonList.addEventListener('scroll', hideTooltip);

document.getElementById('scanBtn').addEventListener('click', () => scan());
document.getElementById('updateBtn').addEventListener('click', () => updateAll());
document.getElementById('playBtn').addEventListener('click', () => launch());
document.getElementById('addGit').addEventListener('click', () => addGit());
document.getElementById('clearLog').addEventListener('click', () => {
  els.log.innerHTML = '';
});
els.gitUrl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addGit();
});

async function boot() {
  applyConfig(await api.getConfig());
  log('QtAU gestartet');
  if (!config.addonsDir) {
    log('Bitte Addons-Ordner in den Einstellungen wählen', 'warn');
    openPanel('settings');
    return;
  }
  const listed = await scan();
  if (config.autoUpdate) {
    const pending = listed.filter(
      (a) => a.status === 'outOfDate' || (config.forceUpdate && a.status === 'dirty')
    );
    if (pending.length) {
      log(`${pending.length} Addon(s) werden aktualisiert`);
      await updateAll();
    } else {
      log('Alle Git-Addons sind aktuell', 'ok');
    }
  }
  if (config.autoLaunch && config.launcherPath) {
    await launch();
  }
}

boot();
