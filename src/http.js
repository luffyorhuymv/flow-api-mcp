import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { toolDefinitions, handleToolCall } from './handler.js';
import { closeBrowser } from './browser.js';
import { logger } from './utils/logger.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Authorization',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

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
      res.writeHead(401, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({
        ok: true,
        service: 'flow-api-mcp',
        version: '1.0.0',
        sessions: transports.size,
        uptime: Math.floor(process.uptime()),
      }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'not found', try: '/health or /mcp' }));
      return;
    }

    const sessionId = req.headers['mcp-session-id'];

    try {
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

      res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'invalid request: provide Mcp-Session-Id header or send initialize as POST' }));
    } catch (err) {
      logger.error('http handler error', { err: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
  });

  httpServer.listen(port, host, () => {
    logger.info('http MCP server listening', {
      url: `http://${host}:${port}/mcp`,
      health: `http://${host}:${port}/health`,
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
