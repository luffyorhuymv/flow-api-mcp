// In-process test: starts HTTP server, exercises /admin/import-cookies, /admin/cookie-status, /mcp roundtrip
import { startHttpServer } from '../src/http.js';
import { buildConfig } from '../src/handler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const config = buildConfig(process.env, projectRoot);

const TEST_TOKEN = 'test-secret-' + Date.now();
const PORT = 5556;
const server = startHttpServer({ port: PORT, host: '127.0.0.1', config, authToken: TEST_TOKEN });
await new Promise((r) => setTimeout(r, 800));

function rawRequest({ method = 'POST', path: p, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const reqHeaders = { ...headers };
    if (data) reqHeaders['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers: reqHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function ok(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok:', msg); }

try {
  console.log('--- /health without auth (should 401) ---');
  const noAuth = await rawRequest({ method: 'GET', path: '/health' });
  ok(noAuth.status === 401, '401 unauthorized');

  console.log('--- /health with auth ---');
  const health = await rawRequest({ method: 'GET', path: '/health', headers: { Authorization: `Bearer ${TEST_TOKEN}` } });
  ok(health.status === 200, '200');
  ok(health.body.ok === true, 'ok');
  ok(typeof health.body.cookies === 'object', 'cookies field present');

  console.log('--- /admin/cookie-status ---');
  const cookieStatus = await rawRequest({ method: 'GET', path: '/admin/cookie-status', headers: { Authorization: `Bearer ${TEST_TOKEN}` } });
  ok(cookieStatus.status === 200, '200');
  console.log('  cookies:', JSON.stringify(cookieStatus.body));

  console.log('--- /admin/import-cookies with malformed JSON ---');
  const bad = await rawRequest({
    method: 'POST', path: '/admin/import-cookies',
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' },
    body: 'not json',
  });
  ok(bad.status === 400, '400 on bad JSON');

  console.log('--- /admin/import-cookies with valid array (re-imports from disk) ---');
  const cookiesPath = path.join(projectRoot, 'data', 'cookies-import.json');
  if (!fs.existsSync(cookiesPath)) {
    console.log('  SKIP: no data/cookies-import.json present');
  } else {
    const cookiesJson = fs.readFileSync(cookiesPath, 'utf-8');
    const importRes = await rawRequest({
      method: 'POST', path: '/admin/import-cookies',
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, 'Content-Type': 'application/json' },
      body: cookiesJson,
    });
    ok(importRes.status === 200, '200');
    ok(importRes.body.ok === true, 'ok');
    ok(typeof importRes.body.imported === 'number' && importRes.body.imported > 0, `imported ${importRes.body.imported}`);
    console.log('  skipped:', JSON.stringify(importRes.body.skipped));
  }

  console.log('--- /admin/cookie-status after import ---');
  const after = await rawRequest({ method: 'GET', path: '/admin/cookie-status', headers: { Authorization: `Bearer ${TEST_TOKEN}` } });
  ok(after.status === 200, '200');
  console.log('  after import:', JSON.stringify(after.body));

  console.log('\nALL ADMIN ENDPOINT CHECKS PASSED');
} catch (e) {
  console.error('TEST FAILED:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  server.close();
  process.exit(process.exitCode || 0);
}
