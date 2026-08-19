const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

const AUTHOR = { name: 'QtAU', email: 'qtau@local' };

function isUnsafeFolder(name) {
  return !name || name === '.' || name === '..' || /[/\\]/.test(name) || name.startsWith('.');
}

function normalizeGitUrl(input) {
  let url = String(input || '').trim();
  if (!url) throw new Error('Empty git URL');
  url = url.replace(/\/+$/, '');
  if (!url.endsWith('.git')) url += '.git';
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS git URLs are allowed');
  return parsed.href.replace(/\/+$/, '');
}

function folderFromUrl(url) {
  const parsed = new URL(url);
  const last = parsed.pathname.split('/').filter(Boolean).pop() || '';
  return last.replace(/\.git$/i, '');
}

function stripWow(text) {
  return String(text || '')
    .replace(/\|c[0-9a-fA-F]{8}/gi, '')
    .replace(/\|r/gi, '')
    .replace(/\|[Tt][^|]*\|[Tt]/g, '')
    .trim();
}

function readToc(content) {
  let src = content;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const toc = {};
  for (const line of src.split(/\r?\n/)) {
    if (!line.startsWith('## ')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    toc[line.slice(3, idx).trim()] = line.slice(idx + 1).trim();
  }
  return toc;
}

function websiteToGit(url, folder) {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    const allowed = ['github.com', 'gitlab.com', 'codeberg.org', 'gitea.com', 'bitbucket.org'];
    const ok =
      allowed.some((h) => host === h || host.endsWith('.' + h)) || host.endsWith('octowow.st');
    if (!ok) return null;
    let pathname = parsed.pathname.replace(/\/+$/, '');
    if (!pathname || pathname === '/') return null;
    if (!pathname.endsWith('.git')) pathname += '.git';
    const gitUrl = `${parsed.origin}${pathname}`;
    if (folder) {
      const repo = folderFromUrl(gitUrl);
      if (repo.toLowerCase() !== String(folder).toLowerCase()) return null;
    }
    return gitUrl;
  } catch {
    return null;
  }
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 0 }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

function percent(progress) {
  if (!progress) return null;
  const total = progress.total || progress.loaded || 1;
  const loaded = progress.loaded || 0;
  return Math.round((loaded / total) * 100);
}

async function currentBranch(dir) {
  return (await git.currentBranch({ fs, dir }).catch(() => null)) || 'master';
}

async function resolveOid(dir, ref) {
  try {
    return await git.resolveRef({ fs, dir, ref });
  } catch {
    return null;
  }
}

async function isDirty(dir) {
  const matrix = await git.statusMatrix({ fs, dir });
  return matrix.some(([, head, workdir, stage]) => head !== workdir || workdir !== stage);
}

async function inspectAddon(addonsDir, folder, bindings) {
  const dir = path.join(addonsDir, folder);
  const tocPath = path.join(dir, `${folder}.toc`);
  const base = { folder, dir, status: 'local', hasToc: false };

  if (!(await pathExists(tocPath))) {
    return { ...base, status: 'invalid', error: 'Missing .toc file' };
  }

  const toc = readToc(await fsp.readFile(tocPath, 'utf8'));
  const suggestedGit = websiteToGit(toc['X-Website'] || toc['X-Source'] || '', folder);
  const info = {
    ...base,
    hasToc: true,
    title: stripWow(toc.Title) || folder,
    version: toc.Version || '',
    author: stripWow(toc.Author) || '',
    notes: stripWow(toc.Notes) || '',
    suggestedGit
  };

  const gitRepo = await pathExists(path.join(dir, '.git'));
  const remotes = gitRepo ? await git.listRemotes({ fs, dir }).catch(() => null) : null;
  const remote = remotes && remotes[0];
  const bound = bindings && bindings[folder];

  if (!remote) {
    if (bound) {
      return {
        ...info,
        status: 'outOfDate',
        git: bound,
        error: 'Not a git repo; binding will clone on update'
      };
    }
    return { ...info, status: 'local', git: suggestedGit || '' };
  }

  info.git = remote.url;
  info.remote = remote.remote;
  info.branch = await currentBranch(dir);

  try {
    await git.fetch({ fs, http, dir, remote: remote.remote, tags: true, singleBranch: false });
    const dirty = await isDirty(dir);
    const localOid = await resolveOid(dir, 'HEAD');
    const remoteOid =
      (await resolveOid(dir, `${remote.remote}/${info.branch}`)) ||
      (await resolveOid(dir, `refs/remotes/${remote.remote}/${info.branch}`)) ||
      (await resolveOid(dir, `${remote.remote}/HEAD`));

    if (dirty) {
      return { ...info, status: 'dirty', error: 'Local changes — update skipped' };
    }
    if (remoteOid && localOid && remoteOid === localOid) {
      return { ...info, status: 'upToDate' };
    }
    return { ...info, status: 'outOfDate' };
  } catch (err) {
    return {
      ...info,
      status: 'error',
      error: err && err.message ? err.message : 'Verify failed'
    };
  }
}

async function listFolders(addonsDir) {
  const entries = await fsp.readdir(addonsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('Blizzard_') && !/\.(tmp|bak)$/.test(name) && !isUnsafeFolder(name))
    .sort((a, b) => a.localeCompare(b));
}

async function scan(addonsDir, { bindings = {}, onProgress } = {}) {
  const emit = (payload) => onProgress && onProgress(payload);
  if (!addonsDir) {
    emit({ type: 'log', level: 'error', message: 'No AddOns folder set' });
    return { addons: [], error: 'No AddOns folder set' };
  }
  if (!(await pathExists(addonsDir))) {
    emit({ type: 'log', level: 'error', message: `Folder not found: ${addonsDir}` });
    return { addons: [], error: `Folder not found: ${addonsDir}` };
  }

  emit({ type: 'busy', value: true, label: 'Scanning addons…' });
  const folders = await listFolders(addonsDir);
  emit({ type: 'log', level: 'info', message: `Found ${folders.length} addon folder(s)` });

  const addons = await mapPool(folders, 4, async (folder) => {
    emit({
      type: 'addon',
      addon: { folder, title: folder, status: 'checking' }
    });
    const addon = await inspectAddon(addonsDir, folder, bindings);
    emit({ type: 'addon', addon });
    const label =
      addon.status === 'upToDate'
        ? 'up to date'
        : addon.status === 'outOfDate'
          ? 'update available'
          : addon.status === 'dirty'
            ? 'local changes'
            : addon.status === 'local'
              ? 'no git'
              : addon.status;
    emit({ type: 'log', level: 'info', message: `${folder}: ${label}` });
    return addon;
  });

  emit({ type: 'busy', value: false, label: 'Ready' });
  return { addons };
}

async function cloneReplace(dir, url, ref, onProgress) {
  const tmpDir = `${dir}.tmp`;
  const bakDir = `${dir}.bak`;
  await fsp.rm(tmpDir, { recursive: true, force: true });
  await git.clone({
    fs,
    http,
    dir: tmpDir,
    url,
    ref: ref || undefined,
    singleBranch: !ref || ref === 'master' || ref === 'main',
    onProgress: (p) =>
      onProgress &&
      onProgress({
        type: 'progress',
        folder: path.basename(dir),
        phase: p.phase,
        percent: percent(p)
      })
  });

  const existed = await pathExists(dir);
  if (existed) {
    await fsp.rm(bakDir, { recursive: true, force: true });
    await fsp.rename(dir, bakDir);
  }
  try {
    await fsp.rename(tmpDir, dir);
  } catch (err) {
    if (existed) await fsp.rename(bakDir, dir).catch(() => undefined);
    throw err;
  }
  await fsp.rm(bakDir, { recursive: true, force: true }).catch(() => undefined);
}

async function pullAddon(dir, remoteName, branch, force, onProgress, folder) {
  const progress = (p) =>
    onProgress &&
    onProgress({
      type: 'progress',
      folder,
      phase: p.phase,
      percent: percent(p)
    });

  if (force) {
    await git.checkout({
      fs,
      dir,
      force: true,
      ref: `${remoteName}/${branch}`,
      onProgress: progress
    });
  }

  await git.pull({
    fs,
    http,
    dir,
    ref: branch,
    remote: remoteName,
    singleBranch: true,
    author: AUTHOR,
    onProgress: progress
  });
}

async function updateOne(addonsDir, folder, { force, bindings, onProgress }) {
  const emit = (payload) => onProgress && onProgress(payload);
  const dir = path.join(addonsDir, folder);
  emit({ type: 'addon', addon: { folder, status: 'updating' } });
  emit({ type: 'log', level: 'info', message: `Updating ${folder}…` });

  try {
    const gitRepo = await pathExists(path.join(dir, '.git'));
    const remotes = gitRepo ? await git.listRemotes({ fs, dir }).catch(() => null) : null;
    const remote = remotes && remotes[0];
    const bound = bindings && bindings[folder];

    if (!remote) {
      const url = bound;
      if (!url) throw new Error('No git remote');
      await cloneReplace(dir, normalizeGitUrl(url), undefined, onProgress);
    } else {
      const dirty = await isDirty(dir);
      if (dirty && !force) {
        const addon = await inspectAddon(addonsDir, folder, bindings);
        emit({ type: 'addon', addon });
        emit({
          type: 'log',
          level: 'warn',
          message: `${folder}: local changes, skipped`
        });
        return addon;
      }
      const branch = await currentBranch(dir);
      await git.fetch({ fs, http, dir, remote: remote.remote, tags: true });
      await pullAddon(dir, remote.remote, branch, force, onProgress, folder);
    }

    const addon = await inspectAddon(addonsDir, folder, bindings);
    emit({ type: 'addon', addon: { ...addon, status: addon.status === 'error' ? addon.status : 'upToDate' } });
    emit({ type: 'log', level: 'ok', message: `${folder}: updated` });
    return { ...addon, status: 'upToDate' };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    const addon = {
      folder,
      status: 'error',
      error: message
    };
    emit({ type: 'addon', addon });
    emit({ type: 'log', level: 'error', message: `${folder}: ${message}` });
    return addon;
  }
}

async function update(addonsDir, { folders, force = false, bindings = {}, ignored = {}, skipIgnored = false, onProgress } = {}) {
  const emit = (payload) => onProgress && onProgress(payload);
  if (!addonsDir) return { results: [], error: 'No AddOns folder set' };

  const isIgnored = (folder) => ignored && ignored[folder] === true;
  let targets = folders;
  if (!targets || !targets.length) {
    const listed = await listFolders(addonsDir);
    const inspected = [];
    for (const folder of listed) {
      inspected.push(await inspectAddon(addonsDir, folder, bindings));
    }
    targets = inspected
      .filter((a) => a.status === 'outOfDate' || (force && a.status === 'dirty'))
      .map((a) => a.folder);
  }
  if (skipIgnored) {
    targets = targets.filter((folder) => {
      if (!isIgnored(folder)) return true;
      emit({ type: 'log', level: 'info', message: `${folder}: ignored` });
      return false;
    });
  }

  if (!targets.length) {
    emit({ type: 'log', level: 'ok', message: 'Nothing to update' });
    emit({ type: 'busy', value: false, label: 'Ready' });
    return { results: [] };
  }

  emit({ type: 'busy', value: true, label: `Updating ${targets.length} addon(s)…` });
  const results = [];
  for (const folder of targets) {
    results.push(await updateOne(addonsDir, folder, { force, bindings, onProgress }));
  }
  emit({ type: 'busy', value: false, label: 'Ready' });
  return { results };
}

async function install(addonsDir, url, folderName, onProgress) {
  const emit = (payload) => onProgress && onProgress(payload);
  if (!addonsDir) throw new Error('No AddOns folder set');
  await fsp.mkdir(addonsDir, { recursive: true });

  const gitUrl = normalizeGitUrl(url);
  const folder = folderName && folderName.trim() ? folderName.trim() : folderFromUrl(gitUrl);
  if (isUnsafeFolder(folder)) throw new Error(`Invalid folder name: ${folder}`);

  emit({ type: 'log', level: 'info', message: `Cloning ${gitUrl} → ${folder}` });
  emit({ type: 'addon', addon: { folder, title: folder, git: gitUrl, status: 'updating' } });
  emit({ type: 'busy', value: true, label: `Cloning ${folder}…` });

  const dir = path.join(addonsDir, folder);
  if (await pathExists(path.join(dir, '.git'))) {
    const updated = await updateOne(addonsDir, folder, {
      force: false,
      bindings: { [folder]: gitUrl },
      onProgress
    });
    return { ok: true, folder, git: gitUrl, addon: updated };
  }
  let ref;
  try {
    const info = await git.getRemoteInfo({ http, url: gitUrl });
    if (info.HEAD && info.HEAD.startsWith('refs/heads/')) {
      ref = info.HEAD.slice('refs/heads/'.length);
    }
  } catch {
    ref = undefined;
  }

  await cloneReplace(dir, gitUrl, ref, onProgress);
  const addon = await inspectAddon(addonsDir, folder, { [folder]: gitUrl });
  emit({ type: 'addon', addon });
  emit({ type: 'log', level: 'ok', message: `${folder}: installed` });
  emit({ type: 'busy', value: false, label: 'Ready' });
  return { ok: true, folder, git: gitUrl, addon };
}

module.exports = {
  scan,
  update,
  install,
  normalizeGitUrl,
  folderFromUrl
};
