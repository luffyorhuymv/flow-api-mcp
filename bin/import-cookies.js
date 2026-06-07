#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { parseCookieFile, importCookiesIntoContext } from '../src/cookie-importer.js';
import { logger } from '../src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

const config = {
  chromeProfileDir: path.resolve(
    projectRoot,
    process.env.CHROME_PROFILE_DIR || './data/chrome-profile'
  ),
  headless: (process.env.HEADLESS || 'true') === 'true',
  actionTimeoutMs: parseInt(process.env.ACTION_TIMEOUT_MS || '30000', 10),
};

async function main() {
  const inputPath = path.resolve(
    projectRoot,
    process.argv[2] || './data/cookies-import.json'
  );

  console.log('Source:    ' + inputPath);
  const rawCookies = parseCookieFile(inputPath);
  console.log('Raw count: ' + rawCookies.length);

  const browser = getBrowser(config);
  try {
    await browser.launch({ headed: false });
    const result = await importCookiesIntoContext(browser.context, rawCookies);
    console.log('Imported:  ' + result.imported);
    console.log('Skipped:   ' + JSON.stringify(result.skipped));
    console.log('Profile:   ' + config.chromeProfileDir);
    console.log('Run `npx flow-api status` to verify login.');
  } catch (e) {
    console.error('Failed: ' + e.message);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
  await closeBrowser();
}

main();
