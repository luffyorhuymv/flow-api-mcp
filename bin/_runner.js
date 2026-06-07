// Shared helper: run a script with automatic browser cleanup and signal handling.
// Usage:
//   import { withBrowser } from './_runner.js';
//   await withBrowser(async (browser) => { ... });
import { getBrowser, closeBrowser } from '../src/browser.js';
import { buildConfig } from '../src/handler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

let cleanupHandlersInstalled = false;
let exiting = false;

function installCleanupHandlers() {
  if (cleanupHandlersInstalled) return;
  cleanupHandlersInstalled = true;

  const cleanup = (signal) => {
    if (exiting) return;
    exiting = true;
    console.log(`\n[runner] received ${signal}, closing browser...`);
    closeBrowser()
      .catch(() => {})
      .finally(() => process.exit(signal === 'SIGINT' || signal === 'SIGTERM' ? 130 : 1));
  };

  process.on('SIGINT', () => cleanup('SIGINT'));
  process.on('SIGTERM', () => cleanup('SIGTERM'));

  process.on('uncaughtException', (err) => {
    console.error('\n[runner] uncaught exception:', err.message);
    cleanup('uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    console.error('\n[runner] unhandled rejection:', err?.message || err);
    cleanup('unhandledRejection');
  });
}

export async function withBrowser(fn, opts = {}) {
  installCleanupHandlers();
  const config = buildConfig(process.env, projectRoot);
  const browser = getBrowser(config);
  try {
    await browser.launch({ headed: opts.headed ?? false });
    return await fn(browser);
  } finally {
    if (!exiting) {
      await closeBrowser().catch((e) => console.warn('[runner] close error:', e.message));
    }
  }
}

// Variant: run with a Playwright page (auto-creates one)
export async function withPage(fn, opts = {}) {
  return withBrowser(async (browser) => {
    const page = await browser.ensurePage();
    return await fn(browser, page);
  }, opts);
}
