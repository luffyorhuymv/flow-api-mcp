import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config as loadConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolDefinitions, handleToolCall, buildConfig } from './handler.js';
import { closeBrowser } from './browser.js';
import { logger } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

loadConfig({ path: path.join(projectRoot, '.env') });
const config = buildConfig(process.env, projectRoot);

const server = new Server(
  { name: 'flow-api-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  return handleToolCall(name, args, config);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server started', { transport: 'stdio', tools: toolDefinitions.length });
}

process.on('SIGINT', async () => {
  logger.info('shutting down');
  await closeBrowser();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

main().catch((err) => {
  logger.error('fatal', { msg: err.message, stack: err.stack });
  process.exit(1);
});

export { config };
