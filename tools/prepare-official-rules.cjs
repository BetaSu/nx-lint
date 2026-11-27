'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, '.acceptance/official-nx-rules');
const manifest = require('../tests/fixtures/nx-rules-source-manifest.json');
async function prepare() {
  await Promise.all(manifest.files.map(async (entry) => {
    const destination = path.join(fixture, entry.path);
    const digest = (content) => createHash('sha256').update(content).digest('hex');
    if (fs.existsSync(destination) && digest(fs.readFileSync(destination)) === entry.sha256) return;
    const response = await fetch(entry.url);
    if (!response.ok) throw new Error('Cannot fetch upstream fixture: ' + entry.path);
    const content = Buffer.from(await response.arrayBuffer());
    if (digest(content) !== entry.sha256) throw new Error('Upstream fixture checksum mismatch: ' + entry.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }));
  console.log('Verified ' + manifest.files.length + ' unmodified official Nx rule fixture files at ' + manifest.commit + '.');
}
if (require.main === module) prepare().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, manifest, prepare };
