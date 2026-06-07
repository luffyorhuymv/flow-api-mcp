import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toolDefinitions, handleToolCall } from './handler.js';
import { closeBrowser, getBrowser } from './browser.js';
import { importCookiesIntoContext, getCookieStatus } from './cookie-importer.js';
import { logger } from './utils/logger.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  'Content-Security-Policy': "default-src 'none'",
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function makeServer(config) {
  const server = new Server(
    { name: 'flow-api-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    return handleToolCall(name, args, config);
  });
  return server;
}

function checkAuth(req, expectedToken) {
  if (!expectedToken) return true;
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${expectedToken}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error(`body too large (>${MAX_BODY_BYTES} bytes)`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

export function startHttpServer({ port = 5555, host = '127.0.0.1', config, authToken }) {
  const transports = new Map();
  const expectedToken = authToken || process.env.HTTP_AUTH_TOKEN || '';

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (!checkAuth(req, expectedToken)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      if (url.pathname === '/health' || url.pathname === '/') {
        const status = { ok: true, service: 'flow-api-mcp', version: '1.0.0', sessions: transports.size, uptime: Math.floor(process.uptime()) };
        try {
          const browser = getBrowser(config);
          await browser.launch({ headed: false });
          status.cookies = await getCookieStatus(browser.context);
        } catch (e) {
          status.cookies = null;
          status.cookieError = e.message;
        }
        sendJson(res, 200, status);
        return;
      }

      if (url.pathname === '/admin/import-cookies' && req.method === 'POST') {
        const raw = await readBody(req);
        let cookies;
        try {
          cookies = JSON.parse(raw);
        } catch (e) {
          sendJson(res, 400, { error: 'invalid JSON: ' + e.message });
          return;
        }
        if (!Array.isArray(cookies)) {
          sendJson(res, 400, { error: 'body must be a JSON array of Chrome cookie objects' });
          return;
        }
        const browser = getBrowser(config);
        await browser.launch({ headed: false });
        const result = await importCookiesIntoContext(browser.context, cookies);
        logger.info('cookies imported via /admin/import-cookies', { imported: result.imported, skipped: result.skipped });
        sendJson(res, 200, { ok: true, ...result, source: 'http', receivedAt: new Date().toISOString() });
        return;
      }

      if (url.pathname === '/admin/cookie-status' && req.method === 'GET') {
        const browser = getBrowser(config);
        await browser.launch({ headed: false });
        const status = await getCookieStatus(browser.context);
        sendJson(res, 200, { ok: true, ...status });
        return;
      }

      if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'not found', routes: ['/health', '/mcp', '/admin/import-cookies', '/admin/cookie-status'] });
        return;
      }

      const sessionId = req.headers['mcp-session-id'];

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId);
        await transport.handleRequest(req, res);
        return;
      }

      if (req.method === 'POST' && !sessionId) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            logger.info('mcp session opened', { sessionId: id, total: transports.size });
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            transports.delete(transport.sessionId);
            logger.info('mcp session closed', { sessionId: transport.sessionId, total: transports.size });
          }
        };
        const server = makeServer(config);
        await server.connect(transport);
        await transport.handleRequest(req, res);
        return;
      }

      sendJson(res, 400, { error: 'invalid request: provide Mcp-Session-Id header or send initialize as POST' });
    } catch (err) {
      logger.error('http handler error', { err: err.message, stack: err.stack });
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
    }
  });

  httpServer.listen(port, host, () => {
    logger.info('http MCP server listening', {
      url: `http://${host}:${port}/mcp`,
      health: `http://${host}:${port}/health`,
      admin: `http://${host}:${port}/admin/import-cookies`,
      auth: expectedToken ? 'bearer-token-required' : 'none',
    });
  });

  const shutdown = async (signal) => {
    logger.info('http server shutting down', { signal });
    for (const t of transports.values()) {
      try { await t.close(); } catch {}
    }
    transports.clear();
    await new Promise((r) => httpServer.close(r));
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return httpServer;
}
