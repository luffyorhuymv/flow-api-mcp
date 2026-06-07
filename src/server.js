import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { config as loadConfig } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolDefinitions, textResult, jsonResult } from './tools/index.js';
import { getBrowser, closeBrowser } from './browser.js';
import { generateImage, FlowError, IMAGE_MODELS, ASPECT_RATIOS } from './flow.js';
import { logger, ensureDir } from './utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

loadConfig({ path: path.join(projectRoot, '.env') });

const config = {
  chromeProfileDir: path.resolve(projectRoot, process.env.CHROME_PROFILE_DIR || './data/chrome-profile'),
  outputDir: path.resolve(projectRoot, process.env.OUTPUT_DIR || './output'),
  locale: process.env.LOCALE || 'en',
  headless: (process.env.HEADLESS || 'true') === 'true',
  flowUrl: process.env.FLOW_URL || 'https://labs.google/fx/tools/flow',
  generationTimeoutMs: parseInt(process.env.GENERATION_TIMEOUT_MS || '180000', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
  actionTimeoutMs: parseInt(process.env.ACTION_TIMEOUT_MS || '30000', 10),
};

ensureDir(config.chromeProfileDir);
ensureDir(config.outputDir);

const server = new Server(
  { name: 'flow-api-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

async function handleTool(name, args) {
  const browser = getBrowser(config);
  try {
    switch (name) {
      case 'generate_image': {
        const result = await generateImage({
          browser,
          config,
          prompt: args.prompt,
          model: args.model,
          aspectRatio: args.aspect_ratio,
          outputDir: args.output_dir,
        });
        return jsonResult({
          ok: true,
          ...result,
          files: result.files.map((f) => f.path),
        });
      }

      case 'flow_status': {
        const status = await browser.isLoggedIn();
        return jsonResult({
          ok: true,
          ...status,
          uptimeSec: browser.uptimeSec(),
          models: IMAGE_MODELS,
          aspectRatios: ASPECT_RATIOS,
          config: {
            flowUrl: config.flowUrl,
            outputDir: config.outputDir,
            chromeProfileDir: config.chromeProfileDir,
          },
        });
      }

      case 'flow_login': {
        const timeoutSec = args.timeout_sec || 300;
        if (browser.context) await browser.close();
        await browser.launch({ headed: true });
        const page = await browser.ensurePage();
        await page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });
        logger.info('login window opened - waiting for user');
        const start = Date.now();
        const deadline = start + timeoutSec * 1000;
        let loggedIn = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const url = page.url();
          if (!url.includes('accounts.google.com')) {
            try {
              const has = await page.locator('a[href*="/project/"]').first().isVisible({ timeout: 2000 });
              if (has) {
                loggedIn = true;
                break;
              }
            } catch {
              /* keep polling */
            }
          }
        }
        await browser.close();
        if (!loggedIn) {
          return textResult(
            `Login timed out after ${timeoutSec}s. Run \`flow_login\` again to retry.`,
            true,
          );
        }
        return jsonResult({ ok: true, loggedIn: true, message: 'Login successful. Session saved.' });
      }

      case 'flow_close': {
        await closeBrowser();
        return jsonResult({ ok: true, message: 'Browser closed.' });
      }

      default:
        return textResult(`Unknown tool: ${name}`, true);
    }
  } catch (err) {
    if (err instanceof FlowError) {
      logger.error('flow error', { code: err.code, msg: err.message, extra: err.extra });
      return textResult(`[${err.code}] ${err.message}${err.extra ? '\n' + JSON.stringify(err.extra) : ''}`, true);
    }
    logger.error('unexpected error', { msg: err.message, stack: err.stack });
    return textResult(`Unexpected error: ${err.message}`, true);
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  return handleTool(name, args);
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
