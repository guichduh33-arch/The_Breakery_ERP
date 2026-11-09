import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { files, hash, PRODUCTION_REF } from './verify-shop.mjs';
import { layout, literal, MODES, readConfig, readDigestFile, readZipEntry, restoreLauncher, rewriteLauncher,
  stage, switchLauncher, verify, verifyRestored } from './install-shop.mjs';

const SHA = 'a'.repeat(40), OLD_SHA = 'c'.repeat(40);
const roots = [], realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = (name) => { const root = mkdtempSync(join(tmpdir(), name)); roots.push(root); return root; };
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };

// Zip minimal (stocké ou deflate), au format des archives produites par Compress-Archive.
function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const body = deflate ? deflateRawSync(data) : data, nameBytes = Buffer.from(name);
    const fields = (header, size) => { const b = Buffer.alloc(size); b.writeUInt32LE(header, 0); return b; };
    const local = fields(0x04034b50, 30);
    local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const dir = fields(0x02014b50, 46);
    dir.writeUInt16LE(deflate ? 8 : 0, 10); dir.writeUInt32LE(crc32(data), 16); dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBytes.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body); central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// Paquet installable minimal ; le faux bridge affiche ce que le lanceur lui transmet.
function makePackage(root, { installable = true } = {}) {
  const content = { 'payload/apps/pos/dist/index.html': '<script src="assets/main.js"></script>',
    'payload/apps/pos/dist/assets/main.js': `const url='https://${PRODUCTION_REF}.supabase.co';`,
    'payload/apps/print-bridge/dist/server.js': 'console.log(JSON.stringify({ entry: import.meta.url, pos: process.env.POS_DIST_DIR, hub: process.env.HUB_BUFFER_FILE }));',
    'payload/apps/print-bridge/package.json': '{"type":"module"}', 'verify-shop.mjs': 'export {};', 'install-shop.ps1': '# installer' };
  for (const [path, text] of Object.entries(content)) put(join(root, path), text);
  const manifest = { version: 1, installable, sha: SHA, projectRef: PRODUCTION_REF, platform: 'win32-x64',
    proofs: ['ci.yml', 'pgtap-pr.yml'].map((workflow) => ({ workflow, sha: SHA, runId: 1, runAttempt: 1 })),
    files: files(root).map((path) => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: hash(bytes) }; }) };
  writeFileSync(join(root, 'release.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

// Lanceur au format du start.cjs réel : configuration externe, POS_DIST_DIR, import() du bridge.
const launcherSource = (c) => `'use strict';
const { readFileSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const config = JSON.parse(readFileSync(${JSON.stringify(c.externalConfigPath)}, 'utf8'));
for (const [key, value] of Object.entries(config.env)) process.env[key] = value;
process.env.POS_DIST_DIR = ${JSON.stringify(c.oldPosDist)};
import(pathToFileURL(${JSON.stringify(c.oldBridgeEntry)}).href).catch((error) => { console.error(error); process.exit(1); });
`;

function makeShop({ installable = true } = {}) {
  const shop = temp('shop-pc-'), packageRoot = join(shop, 'update', 'package');
  const manifest = makePackage(packageRoot, { installable });
  const releasesDir = join(shop, 'releases'), previousRelease = join(releasesDir, OLD_SHA);
  const c = { version: 2, sha: SHA, taskName: 'Breakery Test', taskPath: '\\', taskUser: 'Cashier',
    nodePath: join(shop, 'node', 'node.exe'), launcherPath: join(releasesDir, 'bootstrap-20261029', 'runtime', 'start.cjs'),
    externalConfigPath: join(shop, 'security', 'config.json'), previousRelease, releasesDir,
    oldBridgeEntry: join(previousRelease, 'apps', 'print-bridge', 'dist', 'server.js'), oldPosDist: join(previousRelease, 'apps', 'pos', 'dist'),
    caCertificate: join(shop, 'security', 'ca.crt'), archivePath: join(shop, 'update', 'shop-release.zip'),
    origins: ['https://pos.example.test:3001/', 'https://pos.example.test/'] };
  put(c.nodePath, 'node'); put(c.caCertificate, 'ca');
  put(c.externalConfigPath, JSON.stringify({ env: { HUB_BUFFER_FILE: join(shop, 'data', 'buffer.jsonl') } }));
  put(c.oldBridgeEntry, 'console.log(JSON.stringify({ entry: "old" }));'); put(join(previousRelease, 'apps', 'print-bridge', 'package.json'), '{"type":"module"}');
  put(join(c.oldPosDist, 'index.html'), 'old');
  put(c.launcherPath, launcherSource(c));
  const archive = zip(files(packageRoot).map((name) => ({ name, data: readFileSync(join(packageRoot, name)), deflate: name === 'release.json' })));
  put(c.archivePath, archive); put(`${c.archivePath}.sha256`, `\uFEFF${hash(archive)}\r\n`);
  Object.assign(c, { nodeSha256: hash(readFileSync(c.nodePath)), launcherSha256: hash(readFileSync(c.launcherPath)),
    externalConfigSha256: hash(readFileSync(c.externalConfigPath)) });
  const served = Object.fromEntries(c.origins.map((origin) => [origin, { sha: OLD_SHA, root: c.oldPosDist }]));
  globalThis.fetch = async (input) => {
    const url = new URL(input), site = served[`${url.origin}/`];
    if (!site) throw new TypeError('fetch failed');
    if (url.pathname === '/health') return Response.json({ status: 'ok', release_sha: site.sha });
    const path = join(site.root, ...url.pathname.slice(1).split('/'));
    return existsSync(path) ? new Response(readFileSync(path)) : new Response('missing', { status: 404 });
  };
  const serveNew = (origin) => { served[origin] = { sha: SHA, root: layout(c).next.posDist }; };
  const serveOld = (origin) => { served[origin] = { sha: OLD_SHA, root: c.oldPosDist }; };
  return { shop, packageRoot, manifest, c, served, serveNew, serveOld };
}
const runLauncher = (path) => JSON.parse(spawnSync(process.execPath, [path], { encoding: 'utf8' }).stdout);

test('rewrites the escaped Windows paths of a real-shaped launcher and keeps its external configuration', () => {
  const old = { previousRelease: 'C:\\BreakeryV3\\releases\\ce1d4a39', oldBridgeEntry: 'C:\\BreakeryV3\\releases\\ce1d4a39\\apps\\print-bridge\\dist\\server.js',
    oldPosDist: 'C:\\BreakeryV3\\releases\\ce1d4a39\\apps\\pos\\dist', externalConfigPath: 'C:\\BreakeryV3\\security\\production\\config.json' };
  const next = { bridgeEntry: 'C:\\BreakeryV3\\releases\\a35fd5f5\\apps\\print-bridge\\dist\\server.js', posDist: 'C:\\BreakeryV3\\releases\\a35fd5f5\\apps\\pos\\dist' };
  const source = launcherSource(old);
  assert.ok(source.includes('C:\\\\BreakeryV3\\\\releases\\\\ce1d4a39\\\\apps\\\\pos\\\\dist'), 'fixture stores double backslashes like start.cjs');
  assert.ok(!source.includes(old.oldPosDist), 'plain Windows paths never appear in the real launcher');
  const updated = rewriteLauncher(source, old, next);
  assert.ok(updated.includes(JSON.stringify(next.bridgeEntry)) && updated.includes(JSON.stringify(next.posDist)));
  assert.ok(updated.includes(JSON.stringify(old.externalConfigPath)));
  assert.equal(updated.replace(literal(next.bridgeEntry), literal(old.oldBridgeEntry)).replace(literal(next.posDist), literal(old.oldPosDist)), source);
  assert.throws(() => rewriteLauncher(source.replace(JSON.stringify(old.oldBridgeEntry), '"other.js"'), old, next), /exactly one/);
  assert.throws(() => rewriteLauncher(source + JSON.stringify(old.oldPosDist), old, next), /exactly one/);
  for (const extra of [literal(`${old.previousRelease}\\registry.json`), `${old.previousRelease}\\registry.json`,
    'c:/breakeryv3/releases/ce1d4a39/buffer.jsonl', literal('C:\\BREAKERYV3\\RELEASES\\CE1D4A39\\x')]) {
    assert.throws(() => rewriteLauncher(`${source}// ${extra}\n`, old, next), /previous-release/);
  }
  assert.throws(() => rewriteLauncher(source.replace(JSON.stringify(old.externalConfigPath), '"elsewhere.json"'), old, next), /External configuration/);
  assert.throws(() => rewriteLauncher(source.replace(literal(old.oldPosDist), old.oldPosDist), old, next), /exactly one/);
  assert.throws(() => rewriteLauncher(source.replace(JSON.stringify(old.oldPosDist), JSON.stringify(`${old.oldPosDist}-old`)), old, next), /exactly one/);
  assert.throws(() => rewriteLauncher(source.replace(JSON.stringify(old.oldPosDist), JSON.stringify(`x${old.oldPosDist}`)), old, next), /exactly one/);
  const single = source.replace(JSON.stringify(old.oldPosDist), `'${literal(old.oldPosDist)}'`);
  assert.ok(rewriteLauncher(single, old, next).includes(`'${literal(next.posDist)}'`), 'single-quoted literals are accepted');
});

test('accepts only an explicit version 2 configuration that keeps persistent files outside swapped releases', () => {
  const { c } = makeShop();
  assert.equal(readConfig(JSON.stringify(c)).sha, SHA);
  const bad = (patch) => assert.throws(() => readConfig(JSON.stringify({ ...c, ...patch })));
  bad({ version: 1 }); bad({ sha: 'A'.repeat(40) }); bad({ launcherSha256: 'x' }); bad({ nodePath: 'node.exe' });
  bad({ taskUser: '' }); bad({ origins: [] }); bad({ origins: ['http://pos.example.test/'] });
  bad({ origins: ['https://pos.example.test/app/'] }); bad({ origins: ['https://pos.example.test'] });
  bad({ origins: [c.origins[0], c.origins[0]] }); bad({ origins: ['https://user:pw@pos.example.test/'] });
  bad({ oldPosDist: join(c.releasesDir, 'other', 'apps', 'pos', 'dist') });
  bad({ previousRelease: join(c.releasesDir, '..', 'elsewhere') });
  bad({ externalConfigPath: join(c.previousRelease, 'config.json') });
  bad({ launcherPath: join(c.releasesDir, SHA, 'start.cjs') });
  bad({ externalConfigPath: join(c.previousRelease.toUpperCase(), 'config.json') });
  bad({ previousRelease: `${c.releasesDir}-other`, oldBridgeEntry: join(`${c.releasesDir}-other`, 'b.js'), oldPosDist: join(`${c.releasesDir}-other`, 'p') });
  readConfig(JSON.stringify({ ...c, externalConfigPath: join(`${c.previousRelease}-sibling`, 'config.json') }));
});

test('reads one archive entry, stored or deflated, and refuses ambiguous or corrupt archives', () => {
  const data = Buffer.from('{"sha":"x"}');
  assert.ok(readZipEntry(zip([{ name: 'a', data: Buffer.from('1') }, { name: 'release.json', data }]), 'release.json').equals(data));
  assert.ok(readZipEntry(zip([{ name: 'release.json', data, deflate: true }]), 'release.json').equals(data));
  assert.throws(() => readZipEntry(zip([{ name: 'release.json', data }, { name: 'release.json', data }]), 'release.json'), /exactly one/);
  assert.throws(() => readZipEntry(zip([{ name: 'payload/release.json', data }]), 'release.json'), /exactly one/);
  const corrupt = zip([{ name: 'release.json', data }]); corrupt[30 + 'release.json'.length] ^= 1;
  assert.throws(() => readZipEntry(corrupt, 'release.json'), /Corrupt/);
  assert.throws(() => readZipEntry(Buffer.from('not a zip at all, definitely not one'), 'release.json'), /not a zip/);
  assert.equal(readDigestFile(`\uFEFF${'AB'.repeat(32)}\r\n`), 'ab'.repeat(32));
  assert.throws(() => readDigestFile('nothing'), /digest/);
});

test('stages, switches and verifies a release on every origin without touching the external configuration', async () => {
  const { c, packageRoot, served, serveNew } = makeShop();
  const original = readFileSync(c.launcherPath), external = readFileSync(c.externalConfigPath), l = layout(c);
  assert.equal(runLauncher(c.launcherPath).entry, 'old');
  const report = await stage(c, packageRoot);
  assert.equal(report.state, 'staged');
  assert.deepEqual(report.previousHealth, Object.fromEntries(c.origins.map((o) => [o, OLD_SHA])));
  assert.ok(readFileSync(c.launcherPath).equals(original), 'staging never touches the running launcher');
  assert.ok(readFileSync(l.backup).equals(original));
  switchLauncher(c);
  const started = runLauncher(c.launcherPath);
  assert.equal(fileURLToPath(started.entry), l.next.bridgeEntry);
  assert.equal(started.pos, l.next.posDist);
  assert.equal(started.hub, join(dirname(c.externalConfigPath), '..', 'data', 'buffer.jsonl'));
  await assert.rejects(verify(c, packageRoot), /not served/);
  serveNew(c.origins[0]);
  await assert.rejects(verify(c, packageRoot), new RegExp(`not served on ${c.origins[1]}`));
  served[c.origins[1]] = { sha: SHA, root: c.oldPosDist };
  await assert.rejects(verify(c, packageRoot), /Served POS differs/);
  serveNew(c.origins[1]);
  writeFileSync(c.externalConfigPath, '{"env":{}}');
  await assert.rejects(verify(c, packageRoot), /External configuration changed/);
  writeFileSync(c.externalConfigPath, external);
  await verify(c, packageRoot);
  const final = JSON.parse(readFileSync(l.report, 'utf8'));
  assert.equal(final.state, 'verified'); assert.deepEqual(final.origins, c.origins);
  assert.ok(readFileSync(c.externalConfigPath).equals(external));
  assert.ok(existsSync(c.oldBridgeEntry), 'the previous release stays available for a return');
});

test('restores the previous launcher automatically and proves the previous release is served again', async () => {
  const { c, packageRoot, serveNew, serveOld } = makeShop();
  const original = readFileSync(c.launcherPath);
  await stage(c, packageRoot); switchLauncher(c);
  serveNew(c.origins[0]);
  await assert.rejects(verify(c, packageRoot));
  await assert.rejects(verifyRestored(c), /rolled-back/);
  writeFileSync(layout(c).backup, 'tampered backup');
  assert.throws(() => restoreLauncher(c), /backup differs/);
  writeFileSync(layout(c).backup, original);
  writeFileSync(layout(c).restore, 'foreign copy');
  assert.throws(() => restoreLauncher(c), /Unexpected restore copy/);
  writeFileSync(layout(c).restore, original);
  restoreLauncher(c);
  assert.equal(existsSync(layout(c).restore), false);
  assert.ok(readFileSync(c.launcherPath).equals(original));
  assert.equal(runLauncher(c.launcherPath).entry, 'old');
  await assert.rejects(verifyRestored(c), new RegExp(`not served again on ${c.origins[0]}`));
  serveOld(c.origins[0]);
  await verifyRestored(c);
  assert.equal(JSON.parse(readFileSync(layout(c).report, 'utf8')).state, 'rolled-back');
  assert.throws(() => switchLauncher(c), /expected staged/);
});

test('restores a launcher renamed by a switch whose report write failed', async () => {
  const { c, packageRoot } = makeShop();
  const original = readFileSync(c.launcherPath);
  await stage(c, packageRoot);
  renameSync(layout(c).temp, c.launcherPath);
  restoreLauncher(c);
  assert.ok(readFileSync(c.launcherPath).equals(original));
});

test('restore before the switch keeps the untouched launcher and refuses a foreign one', async () => {
  const { c, packageRoot } = makeShop();
  const original = readFileSync(c.launcherPath);
  await stage(c, packageRoot);
  writeFileSync(c.launcherPath, 'edited by hand');
  assert.throws(() => switchLauncher(c), /drift/);
  assert.throws(() => restoreLauncher(c), /Unexpected launcher/);
  writeFileSync(c.launcherPath, original);
  restoreLauncher(c);
  assert.ok(readFileSync(c.launcherPath).equals(original));
});

test('refuses every unverified input before writing anything', async () => {
  const cases = [
    [/Archive differs/, ({ c }) => writeFileSync(`${c.archivePath}.sha256`, 'b'.repeat(64))],
    [/Extracted package differs/, ({ packageRoot }) => writeFileSync(join(packageRoot, 'release.json'), readFileSync(join(packageRoot, 'release.json'), 'utf8').replace('"version": 1', '"version":1'))],
    [/integrity/, ({ packageRoot }) => writeFileSync(join(packageRoot, 'payload/apps/pos/dist/assets/main.js'), 'tampered')],
    [/identity/, ({ c }) => { c.sha = 'b'.repeat(40); }],
    [/Node runtime/, ({ c }) => writeFileSync(c.nodePath, 'other node')],
    [/External configuration differs/, ({ c }) => writeFileSync(c.externalConfigPath, '{"env":{}}')],
    [/Launcher changed/, ({ c }) => writeFileSync(c.launcherPath, readFileSync(c.launcherPath, 'utf8') + '\n')],
    [/fetch failed/, ({ served, c }) => { delete served[c.origins[1]]; }],
    [/already exist/, ({ c }) => mkdirSync(join(c.releasesDir, c.sha))],
    [/Launcher layout is not verified/, ({ c }) => {
      writeFileSync(c.launcherPath, readFileSync(c.launcherPath, 'utf8').replace(JSON.stringify(c.oldPosDist), JSON.stringify(`${c.oldPosDist}-other`)));
      c.launcherSha256 = hash(readFileSync(c.launcherPath));
    }],
    [/without BOM/, ({ c }) => {
      writeFileSync(c.launcherPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(c.launcherPath)]));
      c.launcherSha256 = hash(readFileSync(c.launcherPath));
    }],
  ];
  for (const [name, mutate] of cases) {
    const shop = makeShop(); mutate(shop);
    const launcher = readFileSync(shop.c.launcherPath), existed = existsSync(join(shop.c.releasesDir, shop.c.sha));
    await assert.rejects(stage(shop.c, shop.packageRoot), name);
    assert.ok(readFileSync(shop.c.launcherPath).equals(launcher), `${name}: launcher unchanged`);
    assert.equal(existsSync(join(shop.c.releasesDir, shop.c.sha)), existed, `${name}: no release copied`);
    for (const path of [layout(shop.c).backup, layout(shop.c).temp]) assert.equal(existsSync(path), false, `${name}: no launcher copy written`);
  }
  const validation = makeShop({ installable: false });
  await assert.rejects(stage(validation.c, validation.packageRoot), /cannot be installed/);
});

test('installer drives only helper modes that exist and never extracts with Expand-Archive', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = readFileSync(join(here, 'install-shop.ps1'), 'utf8');
  const modes = [...script.matchAll(/(?:Invoke|Wait)-Helper '([a-z]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(modes)].sort(), Object.keys(MODES).sort());
  assert.ok(!/Expand-Archive/i.test(script));
  assert.ok(readFileSync(join(here, 'package-shop.mjs'), 'utf8').includes("'install-shop.mjs'"), 'the helper travels in the package');
  const example = JSON.parse(readFileSync(join(here, 'shop-update.example.json'), 'utf8'));
  assert.equal(example.version, 2);
});
