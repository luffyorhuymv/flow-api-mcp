import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 5555;
const MCP_PATH = '/mcp';

let sessionId = null;

function request(body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Accept': 'application/json, text/event-stream',
      ...extraHeaders,
    };
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    const req = http.request(
      { host: HOST, port: PORT, path: MCP_PATH, method: 'POST', headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if (res.headers['mcp-session-id'] && !sessionId) {
            sessionId = res.headers['mcp-session-id'];
            console.log('  session:', sessionId);
          }
          let parsed = null;
          let text = null;
          if (raw) {
            const lines = raw.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) text = line.slice(6);
              else if (line.startsWith('event: message')) continue;
            }
            if (text) {
              try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
            } else {
              try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  console.log('--- initialize ---');
  const init = await request({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'http-test', version: '1.0.0' },
    },
  });
  console.log('  status:', init.status, 'body keys:', init.body && Object.keys(init.body));
  assert(init.status === 200, 'initialize returns 200');
  assert(init.body?.result?.serverInfo?.name === 'flow-api-mcp', 'server name correct');
  assert(typeof init.body?.result?.capabilities?.tools === 'object', 'tools capability present');
  assert(typeof sessionId === 'string' && sessionId.length > 0, 'session id received');

  console.log('--- notifications/initialized (skipped, not strictly required) ---');

  console.log('--- tools/list ---');
  const list = await request({
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
  });
  assert(list.status === 200, 'tools/list 200');
  const tools = list.body?.result?.tools;
  assert(Array.isArray(tools) && tools.length === 4, `4 tools (got ${tools?.length})`);

  console.log('--- tools/call flow_status ---');
  const status = await request({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'flow_status', arguments: {} },
  });
  assert(status.status === 200, 'flow_status 200');
  const statusText = status.body?.result?.content?.[0]?.text;
  const statusJson = JSON.parse(statusText);
  assert(statusJson.ok === true, 'status.ok');
  assert(statusJson.loggedIn === true, 'status.loggedIn');
  assert(Array.isArray(statusJson.models) && statusJson.models.length === 3, '3 models');

  console.log('--- tools/call generate_image (4:3, 1 prompt) ---');
  const start = Date.now();
  const gen = await request({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: {
      name: 'generate_image',
      arguments: {
        prompt: 'a tiny red panda wearing a tiny top hat, portrait, watercolor',
        aspect_ratio: '4:3',
      },
    },
  }, {}, 240000);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  assert(gen.status === 200, `generate_image 200 (took ${elapsed}s)`);
  const genText = gen.body?.result?.content?.[0]?.text;
  const genJson = JSON.parse(genText);
  if (!genJson.ok) {
    console.log('  body:', genText);
    throw new Error('generate_image returned ok=false');
  }
  assert(genJson.ok === true, 'gen.ok');
  assert(Array.isArray(genJson.files) && genJson.files.length === 4, `4 files (got ${genJson.files?.length})`);
  for (const p of genJson.files) {
    console.log('  file:', p);
  }

  console.log('\nALL HTTP CHECKS PASSED in ' + elapsed + 's');
}

main().catch((err) => {
  console.error('TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
