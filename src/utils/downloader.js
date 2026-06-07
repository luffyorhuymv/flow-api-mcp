import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, safeFilename, logger } from './logger.js';

const REDIRECT_RE = /media\.getMediaUrlRedirect\?name=([a-f0-9-]+)/i;

export function extractImageUuids(page) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const uuids = new Set();
    document.querySelectorAll('img').forEach((img) => {
      const src = img.src || img.getAttribute('src') || '';
      const m = src.match(re);
      if (m && m[1] && img.naturalWidth > 64) {
        uuids.add(m[1]);
      }
    });
    return Array.from(uuids);
  }, REDIRECT_RE.source);
}

export function extractVideoUuids(page) {
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc, 'i');
    const uuids = new Set();
    const visit = (el) => {
      const src = el.src || el.currentSrc || '';
      const m = src.match(re);
      if (m && m[1]) uuids.add(m[1]);
      if (el.tagName === 'VIDEO') {
        el.querySelectorAll('source').forEach(visit);
      }
    };
    document.querySelectorAll('video').forEach(visit);
    return Array.from(uuids);
  }, REDIRECT_RE.source);
}

export async function downloadImagesFromPage(page, uuids, outDir, jobId) {
  ensureDir(outDir);
  const files = [];
  for (const uuid of uuids) {
    try {
      const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`;
      const resp = await page.context().request.get(url, { timeout: 20000 });
      if (!resp.ok()) {
        logger.warn('image fetch failed', { uuid, status: resp.status() });
        continue;
      }
      const ct = resp.headers()['content-type'] || '';
      if (!ct.startsWith('image/')) {
        logger.warn('non-image content-type', { uuid, ct });
        continue;
      }
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
      const buf = await resp.body();
      const fname = `flow_${jobId}_${uuid.slice(0, 8)}.${ext}`;
      const dest = path.join(outDir, fname);
      fs.writeFileSync(dest, buf);
      files.push({ path: dest, uuid, bytes: buf.length });
      logger.info('image saved', { path: dest, bytes: buf.length });
    } catch (err) {
      logger.error('download error', { uuid, err: err.message });
    }
  }
  return files;
}

export async function downloadVideosFromPage(page, uuids, outDir, jobId) {
  ensureDir(outDir);
  const files = [];
  for (const uuid of uuids) {
    try {
      const url = `https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=${uuid}`;
      const resp = await page.context().request.get(url, { timeout: 120000 });
      if (!resp.ok()) {
        logger.warn('video fetch failed', { uuid, status: resp.status() });
        continue;
      }
      const ct = resp.headers()['content-type'] || '';
      if (!ct.startsWith('video/') && !ct.includes('octet-stream')) {
        logger.warn('non-video content-type', { uuid, ct });
        continue;
      }
      const ext = ct.includes('webm') ? 'webm' : 'mp4';
      const buf = await resp.body();
      const fname = `flow_${jobId}_${uuid.slice(0, 8)}.${ext}`;
      const dest = path.join(outDir, fname);
      fs.writeFileSync(dest, buf);
      files.push({ path: dest, uuid, bytes: buf.length });
      logger.info('video saved', { path: dest, bytes: buf.length });
    } catch (err) {
      logger.error('video download error', { uuid, err: err.message });
    }
  }
  return files;
}

export { safeFilename };
