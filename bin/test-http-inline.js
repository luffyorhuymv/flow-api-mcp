// Runs server in same process, makes requests, then exits. Single-process test.
import { startHttpServer } from '../src/http.js';
import { buildConfig } from '../src/handler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const config = buildConfig(process.env, projectRoot);

const PORT = 5555;
const server = startHttpServer({ port: PORT, host: '127.0.0.1', config });

// Wait briefly for server to start listening
await new Promise((r) => setTimeout(r, 800));

let sessionId = null;

function rpc(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Accept': 'application/json, text/event-stream',
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.headers['mcp-session-id'] && !sessionId) sessionId = res.headers['mcp-session-id'];
          const raw = Buffer.concat(chunks).toString('utf-8');
          let text = null;
          for (const line of raw.split('\n')) {
            if (line.startsWith('data: ')) text = line.slice(6);
          }
          if (!text && raw.trim()) text = raw;
          let parsed = null;
          if (text) { try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; } }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function ok(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); console.log('  ok:', msg); }

try {
  console.log('--- initialize ---');
  const init = await rpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'inline', version: '1' } },
  });
  ok(init.status === 200, '200');
  ok(init.body?.result?.serverInfo?.name === 'flow-api-mcp', 'name');
  ok(typeof sessionId === 'string', 'session ' + sessionId);

  console.log('--- tools/list ---');
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  ok(Array.isArray(list.body?.result?.tools) && list.body.result.tools.length === 4, '4 tools');

  console.log('--- flow_status ---');
  const st = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'flow_status', arguments: {} } });
  const stJ = JSON.parse(st.body.result.content[0].text);
  ok(stJ.ok && stJ.loggedIn, 'loggedIn');

  console.log('--- generate_image (aspect 4:3) ---');
  const t0 = Date.now();
  const gen = await rpc({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'generate_image', arguments: { prompt: 'a tiny red panda wearing a tiny top hat, portrait, watercolor', aspect_ratio: '4:3' } },
  });
  console.log(`  elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const genText = gen.body.result?.content?.[0]?.text;
  const genJ = JSON.parse(genText);
  if (!genJ.ok) {
    console.log('  FAIL response:', genText);
    throw new Error('generate_image returned ok=false: ' + genText);
  }
  ok(genJ.ok, 'gen.ok');
  ok(Array.isArray(genJ.files) && genJ.files.length > 0, `${genJ.files.length} files`);
  for (const p of genJ.files) console.log('  file:', p);

  console.log('\nALL HTTP CHECKS PASSED');
} catch (e) {
  console.error('TEST FAILED:', e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  console.log('--- shutting down server ---');
  server.close();
  process.exit(process.exitCode || 0);
}
