const api = window.qtau;

const STATUS_LABEL = {
  checking: 'Checking…',
  updating: 'Updating…',
  upToDate: 'Up to date',
  outOfDate: 'Update',
  local: 'No git',
  dirty: 'Local changes',
  error: 'Error',
  invalid: 'Invalid'
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
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const line = document.createElement('div');
  line.className = level;
  line.textContent = `[${time}] ${message}`;
  els.log.appendChild(line);
  els.log.scrollTop = els.log.scrollHeight;
}

function setBusy(value, label) {
  busy = value;
  els.busyLabel.textContent = label || (value ? 'Working…' : 'Ready');
  document.getElementById('scanBtn').disabled = value;
  document.getElementById('updateBtn').disabled = value;
  document.getElementById('addGit').disabled = value;
  for (const btn of document.querySelectorAll('.addon-table .col-actions button')) {
    btn.disabled = value;
  }
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
    addon.author ? `Author: ${addon.author}` : '',
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
  els.addonCount.textContent = addons.length ? `${addons.length} found` : '';
  els.addonList.innerHTML = '';
  if (!addons.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.className = 'empty';
    cell.textContent = 'No addons found. Choose an AddOns folder in Settings.';
    row.appendChild(cell);
    els.addonList.appendChild(row);
    return;
  }

  for (const addon of addons) {
    const ignored = Boolean(config.ignored && config.ignored[addon.folder]);
    const row = document.createElement('tr');
    if (ignored) row.className = 'ignored';

    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = addon.title || addon.folder;

    const details = hoverText(addon);
    if (details) {
      row.addEventListener('mouseenter', () => showTooltip(row, details));
      row.addEventListener('mouseleave', hideTooltip);
    }

    const ignoreCell = document.createElement('td');
    ignoreCell.className = 'col-ignore';
    const ignore = document.createElement('label');
    ignore.className = 'ignore';
    ignore.title = 'Skip this addon during automatic updates';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = ignored;
    box.addEventListener('change', async () => {
      config = await api.setConfig({ ignored: { [addon.folder]: box.checked } });
      renderAddons();
    });
    ignore.appendChild(box);
    ignoreCell.appendChild(ignore);

    const status = document.createElement('td');
    status.className = 'col-status';
    const pill = document.createElement('span');
    pill.className = `pill ${addon.status || 'local'}`;
    pill.textContent =
      addon.error && addon.status === 'error'
        ? addon.error
        : STATUS_LABEL[addon.status] || addon.status || '—';
    status.appendChild(pill);

    const actions = document.createElement('td');
    actions.className = 'col-actions';
    if (addon.status === 'outOfDate' || addon.status === 'dirty' || addon.status === 'error') {
      actions.appendChild(actionButton('Update', () => updateFolders([addon.folder])));
    }
    if (addon.status === 'local') {
      actions.appendChild(
        actionButton('Bind', () => {
          els.gitFolder.value = addon.folder;
          els.gitUrl.value = addon.suggestedGit || addon.git || '';
          openPanel('git');
          els.gitUrl.focus();
        })
      );
    }

    row.append(name, ignoreCell, status, actions);
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
  setBusy(true, 'Scanning addons…');
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
    setBusy(false, 'Ready');
  }
}

async function updateFolders(folders) {
  setBusy(true, 'Updating…');
  try {
    await api.update({ folders, force: els.forceUpdate.checked });
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Ready');
  }
}

async function updateAll() {
  setBusy(true, 'Updating…');
  try {
    await api.update({ force: els.forceUpdate.checked });
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Ready');
  }
}

async function addGit() {
  const url = els.gitUrl.value.trim();
  if (!url) return;
  setBusy(true, 'Cloning…');
  try {
    await api.install({ url, folder: els.gitFolder.value.trim() });
    els.gitUrl.value = '';
    els.gitFolder.value = '';
    closePanel('git');
    await scan();
  } catch (err) {
    log(err.message || String(err), 'error');
    setBusy(false, 'Ready');
  }
}

async function launch() {
  try {
    log('Starting launcher / client…', 'ok');
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

document.querySelector('.table-wrap').addEventListener('scroll', hideTooltip);

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
  log('QtAU started');
  if (!config.addonsDir) {
    log('Please choose an AddOns folder in Settings', 'warn');
    openPanel('settings');
    return;
  }
  const listed = await scan();
  if (config.autoUpdate) {
    const pending = listed.filter(
      (a) =>
        !config.ignored?.[a.folder] &&
        (a.status === 'outOfDate' || (config.forceUpdate && a.status === 'dirty'))
    );
    if (pending.length) {
      log(`Updating ${pending.length} addon(s)`);
      await updateAll();
    } else {
      log('All git addons are up to date', 'ok');
    }
  }
  if (config.autoLaunch && config.launcherPath) {
    await launch();
  }
}

boot();
