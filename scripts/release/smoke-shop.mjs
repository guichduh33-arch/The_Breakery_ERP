// Essai HTTPS du bridge empaqueté, sans paiement, imprimante ni base de données.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyShop } from './verify-shop.mjs';

const root = resolve(process.argv[2] ?? '');
const manifest = verifyShop(root, process.env.RELEASE_SHA);
const temp = mkdtempSync(join(tmpdir(), 'shop-smoke-'));
let child;
try {
  const cert = join(temp, 'certificate.pem'), key = join(temp, 'private.key');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const port = await new Promise((accept, reject) => {
    const server = net.createServer(); server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => accept(value)); });
  });
  const origin = `https://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(root, 'payload/apps/print-bridge/dist/server.js')], {
    cwd: temp, stdio: 'ignore', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      PORT: String(port), HUB_TLS_CERT: cert, HUB_TLS_KEY: key, HUB_ALLOWED_ORIGINS: origin,
      HUB_REGISTRY_FILE: join(temp, 'registry.json'), HUB_BUFFER_FILE: join(temp, 'buffer.jsonl'),
      POS_DIST_DIR: join(root, 'payload/apps/pos/dist') },
  });
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((done) => setTimeout(done, 200));
    healthy = await new Promise((done) => {
      const req = https.get(`${origin}/health`, { ca: readFileSync(cert), timeout: 1000 }, (res) => {
        let body = ''; res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => { try { done(res.statusCode === 200 && JSON.parse(body).release_sha === manifest.sha); } catch { done(false); } });
      });
      req.on('error', () => done(false)); req.on('timeout', () => { req.destroy(); done(false); });
    });
    if (healthy) break;
    if (child.exitCode !== null) throw new Error('Packaged bridge failed to start');
  }
  if (!healthy) throw new Error('Packaged bridge did not become healthy');
  execFileSync(process.execPath, [join(root, 'verify-shop.mjs'), '--served', origin], {
    env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdio: 'pipe', timeout: 60000,
  });
  console.log(JSON.stringify({ smokeVerified: true, sha: manifest.sha, platform: process.platform }));
} finally {
  if (child && child.exitCode === null) {
    child.kill(); await new Promise((done) => { child.once('exit', done); setTimeout(done, 5000); });
  }
  rmSync(temp, { recursive: true, force: true });
}
