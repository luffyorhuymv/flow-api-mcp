#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { generateImage, IMAGE_MODELS, ASPECT_RATIOS } from '../src/flow.js';
import { logger, ensureDir } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

const config = {
  chromeProfileDir: path.resolve(projectRoot, process.env.CHROME_PROFILE_DIR || './data/chrome-profile'),
  outputDir: path.resolve(projectRoot, process.env.OUTPUT_DIR || './output'),
  locale: process.env.LOCALE || 'en',
  headless: (process.env.HEADLESS || 'true') === 'true',
  useSystemChrome: (process.env.USE_SYSTEM_CHROME || 'true') === 'true',
  flowUrl: process.env.FLOW_URL || 'https://labs.google/fx/tools/flow',
  generationTimeoutMs: parseInt(process.env.GENERATION_TIMEOUT_MS || '180000', 10),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
  actionTimeoutMs: parseInt(process.env.ACTION_TIMEOUT_MS || '30000', 10),
};

const BANNER = `
flow-api-mcp v1.0.0
Google Labs Flow -> MCP bridge
`;

function usage() {
  console.log(BANNER);
  console.log('Usage:');
  console.log('  flow-api login              Open browser to sign in to Google (one-time)');
  console.log('  flow-api status             Check session and list models');
  console.log('  flow-api import-cookies [f] Import Chrome cookie JSON into profile');
  console.log('  flow-api test "<prompt>"    Generate a single image from CLI');
  console.log('  flow-api serve              Start MCP server (stdio)');
  console.log('  flow-api serve-http [port]  Start MCP server over HTTP (default :5555)');
  console.log('  flow-api --help             Show this help');
  console.log('');
  console.log('Config: ' + path.join(projectRoot, '.env'));
  console.log('Profile: ' + config.chromeProfileDir);
  console.log('Output:  ' + config.outputDir);
}

async function cmdLogin() {
  ensureDir(config.chromeProfileDir);
  const browser = getBrowser(config);
  await browser.launch({ headed: true });
  const page = await browser.ensurePage();
  await page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });
  console.log('Browser opened at: ' + page.url());
  console.log('Please sign in to your Google account in the window.');
  console.log('After signing in, you can close the browser - the session will be saved.');
  console.log('Press Ctrl+C to exit.');
  process.on('SIGINT', async () => {
    console.log('\nSaving session and exiting...');
    await browser.close();
    process.exit(0);
  });
  await new Promise(() => {});
}

async function cmdStatus() {
  const browser = getBrowser(config);
  const status = await browser.isLoggedIn();
  console.log(JSON.stringify({ ...status, models: IMAGE_MODELS, aspectRatios: ASPECT_RATIOS }, null, 2));
  await browser.close();
  if (!status.loggedIn) {
    process.exit(1);
  }
}

async function cmdTest(prompt) {
  if (!prompt) {
    console.error('Usage: flow-api test "<prompt>"');
    process.exit(1);
  }
  const browser = getBrowser(config);
  const result = await generateImage({ browser, config, prompt });
  console.log('OK - generated:');
  for (const f of result.files) {
    console.log('  ' + f.path + ' (' + f.bytes + ' bytes)');
  }
  await browser.close();
}

async function cmdServe() {
  await import('../src/server.js');
}

async function cmdServeHttp(port) {
  const { buildConfig } = await import('../src/handler.js');
  const { startHttpServer } = await import('../src/http.js');
  const config = buildConfig(process.env, projectRoot);
  const host = process.env.HTTP_HOST || '127.0.0.1';
  startHttpServer({ port: Number(port) || 5555, host, config });
}

async function cmdImportCookies() {
  await import('./import-cookies.js');
}

const args = process.argv.slice(2);
const cmd = args[0];

(async () => {
  try {
    if (!cmd || cmd === '--help' || cmd === '-h') {
      usage();
      return;
    }
    switch (cmd) {
      case 'login': return cmdLogin();
      case 'status': return cmdStatus();
      case 'import-cookies': return cmdImportCookies();
      case 'test': return cmdTest(args.slice(1).join(' '));
      case 'serve': return cmdServe();
      case 'serve-http': return cmdServeHttp(args[1]);
      default:
        console.error('Unknown command: ' + cmd);
        usage();
        process.exit(1);
    }
  } catch (err) {
    logger.error('cli error', { msg: err.message, stack: err.stack });
    if (cmd === 'serve') {
      process.exit(1);
    } else {
      await closeBrowser().catch(() => {});
      process.exit(1);
    }
  }
})();
