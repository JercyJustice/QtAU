const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_ADDONS =
  'D:\\Games\\Azeroth Launcher\\Azeroth\\Binaries\\Win64\\Games\\Emberveil\\live\\Azeroth\\Interface\\AddOns';
const DEFAULT_LAUNCHER =
  'D:\\Games\\Azeroth Launcher\\Azeroth\\Binaries\\Win64\\AzerothLauncher-Win64-Shipping.exe';

const DEFAULTS = {
  addonsDir: '',
  launcherPath: '',
  autoUpdate: false,
  autoLaunch: false,
  forceUpdate: false,
  bindings: {},
  ignored: {}
};

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function filePath() {
  return path.join(app.getPath('userData'), 'config.json');
}

let data = { ...DEFAULTS };

function withDetectedDefaults(cfg) {
  const next = { ...cfg };
  if (!next.addonsDir && exists(DEFAULT_ADDONS)) next.addonsDir = DEFAULT_ADDONS;
  if (!next.launcherPath && exists(DEFAULT_LAUNCHER)) next.launcherPath = DEFAULT_LAUNCHER;
  return next;
}

function load() {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const firstIgnoreSupport = parsed.ignored == null;
    data = withDetectedDefaults({ ...DEFAULTS, ...parsed });
    if (!data.bindings || typeof data.bindings !== 'object') data.bindings = {};
    if (!data.ignored || typeof data.ignored !== 'object') data.ignored = {};
    if (firstIgnoreSupport) {
      data.autoUpdate = false;
      save();
    }
  } catch {
    data = withDetectedDefaults({ ...DEFAULTS });
  }
  return data;
}

function save() {
  const dir = path.dirname(filePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2), 'utf8');
}

function get() {
  return data;
}

function set(patch) {
  const bindings =
    patch.bindings && typeof patch.bindings === 'object'
      ? { ...data.bindings, ...patch.bindings }
      : data.bindings;
  const ignored =
    patch.ignored && typeof patch.ignored === 'object'
      ? { ...data.ignored, ...patch.ignored }
      : data.ignored;
  data = { ...data, ...patch, bindings, ignored };
  save();
  return data;
}

module.exports = { load, get, set, DEFAULT_ADDONS, DEFAULT_LAUNCHER };
