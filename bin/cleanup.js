#!/usr/bin/env node
// Cleanup stuck Chrome processes and remove profile locks.
// Use when: data/chrome-profile/SingletonLock persists after a crash, or
//           "browser already launched" errors, or fresh-context behavior
//           (no cookies persist between runs).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { config as loadConfig } from 'dotenv';
import { closeBrowser } from '../src/browser.js';
import { getBrowser } from '../src/browser.js';
import { buildConfig } from '../src/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

const config = buildConfig(process.env, projectRoot);
const profileDir = config.chromeProfileDir;

async function run() {
  console.log('=== flow-api cleanup ===\n');

  // 1. Graceful close via Playwright (in case this process owns the browser)
  try {
    const browser = getBrowser(config);
    if (browser.context) {
      console.log('[1/4] closing browser via Playwright...');
      await closeBrowser();
    } else {
      console.log('[1/4] no active browser in this process');
    }
  } catch (e) {
    console.log('[1/4] Playwright close skipped:', e.message);
  }

  // 2. Kill Chrome processes attached to our profile dir
  console.log('[2/4] killing Chrome processes for profile...');
  try {
    if (process.platform === 'win32') {
      execSync(
        `Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*${profileDir.replace(/\\/g, '\\\\')}*' -or $_.MainWindowTitle -like '*Chrome*' } | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} Start-Sleep -Milliseconds 200; Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }`,
        { shell: 'powershell', stdio: 'pipe' }
      );
    } else {
      execSync(
        `pkill -f "${profileDir}" || true; pkill -f "chromium.*${path.basename(profileDir)}" || true`,
        { stdio: 'pipe' }
      );
    }
    console.log('  done');
  } catch (e) {
    console.log('  (none or error):', e.message);
  }

  // 3. Remove lock files in profile dir
  console.log('[3/4] removing profile lock files...');
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK', 'LOCKFILE', 'lockfile'];
  let removed = 0;
  if (fs.existsSync(profileDir)) {
    for (const name of lockFiles) {
      const p = path.join(profileDir, name);
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          console.log(`  removed: ${name}`);
          removed++;
        } catch (e) {
          console.log(`  cannot remove ${name}: ${e.message}`);
        }
      }
    }
  } else {
    console.log('  profile dir does not exist, nothing to clean');
  }
  if (removed === 0) console.log('  (no lock files found)');

  // 4. Quick health check
  console.log('[4/4] verifying profile is usable...');
  try {
    const browser = getBrowser(config);
    await browser.launch({ headed: false });
    const cookies = await browser.context.cookies();
    console.log(`  ✓ profile OK, ${cookies.length} cookies loaded`);
    await closeBrowser();
  } catch (e) {
    console.log(`  ✗ launch failed: ${e.message}`);
    process.exitCode = 1;
  }

  console.log('\n=== cleanup complete ===');
}

run().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
