const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

const REQUIRED = ['call-bind-apply-helpers'];

module.exports = async function afterPack(context) {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) return;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qtau-asar-'));
  asar.extractAll(asarPath, tmp);

  const projectModules = path.join(process.cwd(), 'node_modules');
  for (const name of REQUIRED) {
    const from = path.join(projectModules, name);
    const to = path.join(tmp, 'node_modules', name);
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.cpSync(from, to, { recursive: true });
    }
  }

  await asar.createPackage(tmp, asarPath);
  fs.rmSync(tmp, { recursive: true, force: true });
};
