import fs from 'node:fs';
import path from 'node:path';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] ?? LOG_LEVELS.info;

function ts() {
  return new Date().toISOString().split('T')[1].slice(0, 8);
}

function fmt(level, msg, extra) {
  const base = `[${ts()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra && Object.keys(extra).length > 0) {
    return `${base} ${JSON.stringify(extra)}`;
  }
  return base;
}

function log(level, msg, extra) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
  const line = fmt(level, msg, extra);
  if (level === 'error') {
    console.error(line);
  } else {
    console.error(line);
  }
}

export const logger = {
  debug: (msg, extra) => log('debug', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
};

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir);
}

export function safeFilename(s, maxLen = 60) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen) || 'image';
}
