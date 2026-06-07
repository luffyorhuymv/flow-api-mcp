#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';
import { parseCookieFile, importCookiesIntoContext } from '../src/cookie-importer.js';
import { withBrowser } from './_runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

async function main() {
  const inputPath = path.resolve(
    projectRoot,
    process.argv[2] || './data/cookies-import.json'
  );

  console.log('Source:    ' + inputPath);
  const rawCookies = parseCookieFile(inputPath);
  console.log('Raw count: ' + rawCookies.length);

  const result = await withBrowser(async (browser) => {
    return await importCookiesIntoContext(browser.context, rawCookies);
  });

  console.log('Imported:  ' + result.imported);
  console.log('Skipped:   ' + JSON.stringify(result.skipped));
  console.log('Profile:   ' + (process.env.CHROME_PROFILE_DIR || './data/chrome-profile'));
  console.log('Run `npx flow-api status` to verify login.');
}

main().catch((e) => {
  console.error('Failed: ' + e.message);
  process.exit(1);
});
