import fs from 'node:fs';
import path from 'node:path';
import { logger } from './utils/logger.js';

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
  if (!d || d === 'localhost') return false;
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
    case 'no_restriction': return 'None';
    case 'lax': return 'Lax';
    case 'strict': return 'Strict';
    default: return 'Lax';
  }
}

function mapSecureForName(name, secure) {
  if (KEEP_PREFIXES.some((p) => name.startsWith(p))) return true;
  return !!secure;
}

export function convertCookie(cookie) {
  let domain = (cookie.domain || '').toLowerCase();
  if (cookie.hostOnly) domain = domain.replace(/^\./, '');
  if (!domain) throw new Error('cookie missing domain: ' + cookie.name);

  const sameSite = mapSameSite(cookie.sameSite);
  const secure = mapSecureForName(cookie.name, cookie.secure);

  if (cookie.name.startsWith('__Host-')) {
    if (domain !== 'labs.google' || cookie.path !== '/' || !secure) {
      throw new Error(`__Host- cookie "${cookie.name}" violates host-only rules`);
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

  if (!cookie.session && cookie.expirationDate) out.expires = Math.floor(cookie.expirationDate);
  else if (cookie.session) out.expires = -1;

  return out;
}

export function filterAndConvert(rawCookies) {
  const cookies = [];
  const skipped = { expired: 0, domain: 0, invalid: 0, security: 0 };
  for (const raw of rawCookies) {
    try {
      if (!isCookieAllowed(raw)) { skipped.expired++; continue; }
      if (!isAllowedDomain(raw.domain)) { skipped.domain++; continue; }
      cookies.push(convertCookie(raw));
    } catch (e) {
      logger.warn('skipping cookie', { name: raw.name, reason: e.message });
      skipped.security++;
    }
  }
  return { cookies, skipped };
}

export function parseCookieFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('Cookie file not found: ' + filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(raw)) throw new Error('Cookie file must be a JSON array');
  return raw;
}

export async function importCookiesIntoContext(context, rawCookies) {
  const { cookies, skipped } = filterAndConvert(rawCookies);
  await context.clearCookies();
  if (cookies.length > 0) await context.addCookies(cookies);
  return { imported: cookies.length, skipped, total: rawCookies.length };
}

export async function getCookieStatus(context) {
  const all = await context.cookies();
  const session = all.find((c) => c.name === '__Secure-next-auth.session-token' && c.domain === 'labs.google');
  const google = all.filter((c) => c.domain.includes('google.com') || c.domain.includes('labs.google'));
  const now = Math.floor(Date.now() / 1000);
  return {
    sessionValid: !!session,
    sessionExpiresAt: session?.expires && session.expires > 0 ? new Date(session.expires * 1000).toISOString() : null,
    sessionExpiresInDays: session?.expires && session.expires > 0 ? Math.floor((session.expires - now) / 86400) : null,
    googleCookieCount: google.length,
    totalCookieCount: all.length,
  };
}

export const _internal = { ALLOWED_DOMAINS, KEEP_PREFIXES, isAllowedDomain, isCookieAllowed, mapSameSite };
