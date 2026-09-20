import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireArtifact(relativePath) {
  const filename = path.join(root, relativePath);
  const stat = fs.statSync(filename);
  assert.equal(stat.isFile(), true, `${relativePath} must be a file`);
  assert.ok(stat.size > 0, `${relativePath} must not be empty`);
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

for (const directory of ['dist', 'dist-firefox']) {
  for (const artifact of [
    'manifest.json',
    'background.js',
    'src/anki/content.js',
    'src/anki/manager.html',
    'src/anki/manager.js',
    'src/options/options.html',
    'src/options/options.js',
    'src/popup/popup.html',
    'src/popup/popup.js',
  ]) {
    requireArtifact(`${directory}/${artifact}`);
  }

  const options = read(`${directory}/src/options/options.html`);
  const popup = read(`${directory}/src/popup/popup.html`);
  assert.equal(count(options, 'options.js'), 1, `${directory} options bundle must load once`);
  assert.equal(count(popup, 'popup.js'), 1, `${directory} popup bundle must load once`);
}

const chromium = JSON.parse(read('dist/manifest.json'));
assert.equal(chromium.manifest_version, 3);
assert.equal(chromium.background.service_worker, 'background.js');
assert.equal('scripts' in chromium.background, false);
assert.equal(chromium.permissions.includes('alarms'), true);

const firefox = JSON.parse(read('dist-firefox/manifest.json'));
assert.equal(firefox.manifest_version, 3);
assert.deepEqual(firefox.background.scripts, ['background.js']);
assert.equal('service_worker' in firefox.background, false);
assert.equal(firefox.permissions.includes('alarms'), true);
assert.equal(firefox.permissions.includes('offscreen'), false);
assert.equal(firefox.permissions.includes('sidePanel'), false);

console.log(JSON.stringify({
  chromium: { directory: 'dist', background: 'service_worker' },
  firefox: { directory: 'dist-firefox', background: 'scripts' },
  verified: true,
}));
