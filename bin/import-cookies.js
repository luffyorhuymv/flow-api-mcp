#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';
import { getBrowser, closeBrowser } from '../src/browser.js';
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

const ALLOWED_DOMAINS = [
  'google.com',
  'google.com.vn',
  'accounts.google.com',
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'labs.google',
  'gstatic.com',
  'googleusercontent.com',
  'docs.google.com',
  'drive.google.com',
  'clients6.google.com',
];

const KEEP_PREFIXES = ['__Secure-', '__Host-'];

function isAllowedDomain(domain) {
  const d = (domain || '').toLowerCase().replace(/^\./, '');
  if (!d) return false;
  if (d === 'localhost') return false;
  return ALLOWED_DOMAINS.some((allowed) => d === allowed || d.endsWith('.' + allowed));
}

function isCookieAllowed(cookie) {
  if (!cookie || !cookie.name || cookie.value == null) return false;
  if (cookie.session) return true;
  if (!cookie.expirationDate || cookie.expirationDate * 1000 < Date.now()) return false;
  return true;
}

function mapSameSite(sameSite) {
  switch ((sameSite || '').toLowerCase()) {
    case 'no_restriction':
      return 'None';
    case 'lax':
      return 'Lax';
    case 'strict':
      return 'Strict';
    default:
      return 'Lax';
  }
}

function mapSecureForName(name, secure) {
  if (KEEP_PREFIXES.some((p) => name.startsWith(p))) return true;
  return !!secure;
}

function convertCookie(cookie) {
  let domain = (cookie.domain || '').toLowerCase();
  if (cookie.hostOnly) {
    domain = domain.replace(/^\./, '');
  }
  if (!domain) {
    throw new Error('cookie missing domain: ' + cookie.name);
  }

  const sameSite = mapSameSite(cookie.sameSite);
  const secure = mapSecureForName(cookie.name, cookie.secure);

  if (cookie.name.startsWith('__Host-')) {
    if (domain !== 'labs.google' || cookie.path !== '/' || !secure) {
      throw new Error(
        `__Host- cookie "${cookie.name}" violates host-only rules (domain=${domain}, path=${cookie.path}, secure=${secure})`
      );
    }
  }

  const out = {
    name: cookie.name,
    value: String(cookie.value),
    domain,
    path: cookie.path || '/',
    secure,
    httpOnly: !!cookie.httpOnly,
    sameSite,
  };

  if (!cookie.session && cookie.expirationDate) {
    out.expires = Math.floor(cookie.expirationDate);
  } else if (cookie.session) {
    out.expires = -1;
  }

  return out;
}

function filterAndConvert(rawCookies) {
  const result = [];
  const skipped = { expired: 0, domain: 0, invalid: 0, security: 0 };
  for (const raw of rawCookies) {
    try {
      if (!isCookieAllowed(raw)) {
        skipped.expired++;
        continue;
      }
      if (!isAllowedDomain(raw.domain)) {
        skipped.domain++;
        continue;
      }
      const converted = convertCookie(raw);
      result.push(converted);
    } catch (e) {
      logger.warn('skipping cookie', { name: raw.name, reason: e.message });
      skipped.security++;
    }
  }
  return { cookies: result, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  let inputPath = args[0];
  if (!inputPath) {
    inputPath = path.join(projectRoot, 'data', 'cookies-import.json');
  }
  inputPath = path.resolve(inputPath);

  if (!fs.existsSync(inputPath)) {
    console.error('Cookie file not found: ' + inputPath);
    process.exit(1);
  }

  let rawCookies;
  try {
    rawCookies = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
  } catch (e) {
    console.error('Failed to parse cookie file: ' + e.message);
    process.exit(1);
  }
  if (!Array.isArray(rawCookies)) {
    console.error('Cookie file must be a JSON array of Chrome cookie objects');
    process.exit(1);
  }

  console.log('Source:     ' + inputPath);
  console.log('Raw count:  ' + rawCookies.length);

  const { cookies, skipped } = filterAndConvert(rawCookies);
  console.log('Imported:   ' + cookies.length);
  console.log('Skipped:    ' + JSON.stringify(skipped));

  const browser = getBrowser(config);
  try {
    await browser.launch({ headed: false });
    const context = browser.context;
    await context.clearCookies();
    await context.addCookies(cookies);
    console.log('Cookies written to profile: ' + config.chromeProfileDir);
  } catch (e) {
    console.error('Failed to inject cookies: ' + e.message);
    await closeBrowser().catch(() => {});
    process.exit(1);
  }
  await closeBrowser();
  console.log('Done. Run `npx flow-api status` to verify login.');
}

main();
