#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const serverPath = path.join(projectRoot, 'bin', 'flow-api.js');

class McpClient {
  constructor(cmd, args, cwd) {
    this.cmd = cmd;
    this.args = args;
    this.cwd = cwd;
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.nextId = 1;
    this.notifications = [];
    this.stderr = [];
  }

  async start() {
    this.proc = spawn(this.cmd, this.args, {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.notifications.push(msg);
      }
    });
    this.proc.stderr.on('data', (chunk) => {
      this.stderr.push(chunk.toString());
    });
    this.proc.on('exit', (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`server exited with code ${code}`));
      }
      this.pending.clear();
    });
  }

  request(method, params = {}, timeoutMs = 180000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.proc.stdin.write(payload);
    });
  }

  notify(method, params = {}) {
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    this.proc.stdin.write(payload);
  }

  async stop() {
    if (!this.proc) return;
    try {
      this.proc.stdin.end();
      await new Promise((r) => setTimeout(r, 500));
    } catch {}
    if (!this.proc.killed) {
      this.proc.kill();
    }
    this.proc = null;
  }

  stderrText() {
    return this.stderr.join('');
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  console.log('Starting MCP server at', serverPath);
  const client = new McpClient('node', [serverPath, 'serve'], projectRoot);
  await client.start();
  console.log('--- initialize ---');
  const init = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-test-client', version: '1.0.0' },
  }, 15000);
  console.log('  init response:', JSON.stringify(init));
  assert(init.serverInfo?.name === 'flow-api-mcp', 'server name = flow-api-mcp');
  assert(typeof init.capabilities === 'object' && init.capabilities !== null, 'capabilities object present');
  assert('tools' in init.capabilities, 'tools capability declared');
  client.notify('notifications/initialized', {});

  console.log('--- tools/list ---');
  const list = await client.request('tools/list', {}, 15000);
  assert(Array.isArray(list.tools) && list.tools.length === 4, '4 tools registered');
  const names = list.tools.map((t) => t.name);
  for (const n of ['generate_image', 'flow_status', 'flow_login', 'flow_close']) {
    assert(names.includes(n), `tool "${n}" present`);
  }

  console.log('--- tools/call flow_status ---');
  const status = await client.request('tools/call', { name: 'flow_status', arguments: {} }, 60000);
  assert(Array.isArray(status.content) && status.content[0]?.type === 'text', 'text content returned');
  const statusJson = JSON.parse(status.content[0].text);
  assert(statusJson.ok === true, 'status.ok = true');
  assert(statusJson.loggedIn === true, 'status.loggedIn = true');
  assert(Array.isArray(statusJson.models) && statusJson.models.length === 3, '3 models listed');

  console.log('--- tools/call generate_image ---');
  const gen = await client.request('tools/call', {
    name: 'generate_image',
    arguments: {
      prompt: 'a tiny robot reading a book in a cozy library, watercolor style',
      aspect_ratio: '1:1',
    },
  }, 240000);
  assert(Array.isArray(gen.content) && gen.content[0]?.type === 'text', 'text content returned');
  const genJson = JSON.parse(gen.content[0].text);
  if (!genJson.ok) {
    console.log('Server stderr:', client.stderrText().slice(-2000));
    throw new Error('generate_image failed: ' + genJson.text || JSON.stringify(genJson));
  }
  assert(genJson.ok === true, 'gen.ok = true');
  assert(Array.isArray(genJson.files) && genJson.files.length > 0, `gen.files has ${genJson.files?.length || 0} entries`);
  for (const p of genJson.files) {
    assert(typeof p === 'string' && p.endsWith('.jpg'), `file path: ${p}`);
  }

  console.log('--- tools/call flow_close ---');
  const closed = await client.request('tools/call', { name: 'flow_close', arguments: {} }, 15000);
  assert(JSON.parse(closed.content[0].text).ok === true, 'close ok');

  await client.stop();
  console.log('\nALL CHECKS PASSED');
  console.log('Server stderr sample (last 500 chars):', client.stderrText().slice(-500));
}

main().catch((err) => {
  console.error('TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
