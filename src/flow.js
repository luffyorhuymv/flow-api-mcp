import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { logger, ensureDir } from './utils/logger.js';
import { extractImageUuids, downloadImagesFromPage, safeFilename } from './utils/downloader.js';

const IMG_UUIDS_BEFORE_GEN = new Set();

export class FlowError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export const ASPECT_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];
export const IMAGE_MODELS = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { id: 'imagen-4', label: 'Imagen 4' },
];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function detectLoginWall(page) {
  const url = page.url();
  if (url.includes('accounts.google.com')) {
    throw new FlowError('AUTH_REQUIRED', 'Google login required. Run: npx flow-api login');
  }
  if (url.includes('recaptcha') || url.includes('/challenge')) {
    throw new FlowError('CAPTCHA', 'Captcha/challenge detected. Solve manually then retry.');
  }
}

async function goToNewProject(page, flowUrl) {
  logger.info('navigating to Flow', { flowUrl });
  await page.goto(flowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await detectLoginWall(page);

  logger.info('clicking New project');
  const newBtn = page.locator('button:has-text("New project"), a:has-text("New project")').first();
  try {
    await newBtn.waitFor({ state: 'visible', timeout: 10000 });
    await newBtn.click({ timeout: 5000 });
  } catch (e) {
    logger.warn('new project button not clickable, trying direct URL', { err: e.message });
    await page.goto(`${flowUrl}/project/new`, { waitUntil: 'domcontentloaded' });
  }
  await sleep(2500);

  let url = page.url();
  if (!url.includes('/project/') || url.endsWith('/project/new')) {
    logger.info('entering project from list');
    const cardLink = page.locator('a[href*="/project/"]').first();
    await cardLink.waitFor({ state: 'visible', timeout: 10000 });
    await cardLink.click();
    await page.waitForURL(/\/project\/[a-f0-9-]+/i, { timeout: 15000 });
    url = page.url();
  }
  logger.info('inside project', { url });
  return url;
}

async function switchToImageMode(page) {
  const imagesTab = page.locator('button:has-text("Images"), [role="tab"]:has-text("Images")').first();
  try {
    if (await imagesTab.isVisible({ timeout: 3000 })) {
      await imagesTab.click();
      await sleep(800);
      logger.info('switched to Image mode');
      return true;
    }
  } catch {
    logger.debug('no Images tab found, assuming already in image mode');
  }
  return false;
}

async function selectAspectRatio(page, ratio) {
  if (!ratio) return;
  const btn = page.locator(`button:has-text("${ratio}"), [aria-label*="${ratio}"]`).first();
  try {
    if (await btn.isVisible({ timeout: 2000 })) {
      await btn.click();
      await sleep(500);
      logger.info('aspect ratio set', { ratio });
    }
  } catch {
    logger.warn('aspect ratio button not found, using default', { ratio });
  }
}

async function fillPrompt(page, prompt) {
  const candidates = [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[placeholder*="image" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="Describe" i]',
    'textarea:not(.g-recaptcha-response)',
    'input[type="text"][placeholder*="prompt" i]',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    try {
      const visible = await el.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) continue;
      const tag = await el.evaluate((e) => e.tagName.toLowerCase());
      await el.click();
      if (tag === 'div' || tag === 'span') {
        await el.click();
        await el.evaluate((e) => {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(e);
          sel.removeAllRanges();
          sel.addRange(range);
        });
        await page.keyboard.press('Delete');
        await page.keyboard.type(prompt, { delay: 30 });
      } else {
        await el.fill('');
        await el.fill(prompt);
      }
      await page.waitForTimeout(1200);
      logger.info('prompt filled', { selector: sel, len: prompt.length });
      return sel;
    } catch (e) {
      logger.debug('prompt candidate failed', { sel, err: e.message });
    }
  }
  throw new FlowError('PROMPT_INPUT_NOT_FOUND', 'Could not locate prompt input field');
}

async function clickGenerate(page) {
  const candidates = [
    'button:has(i:text("arrow_forward"))',
    'button:has(span:text("arrow_forward"))',
    'button:has(i.google-symbols:text("arrow_forward"))',
    'button[aria-label="Create"]',
  ];
  const deadline = Date.now() + 30000;
  for (const sel of candidates) {
    try {
      const btn = page.locator(sel).first();
      const visible = await btn.isVisible({ timeout: 2000 }).catch(() => false);
      logger.debug('generate candidate', { sel, visible });
      if (!visible) continue;
      while (Date.now() < deadline) {
        const enabled = await btn
          .evaluate((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true')
          .catch(() => false);
        if (enabled) break;
        await sleep(500);
      }
      const enabled = await btn
        .evaluate((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true')
        .catch(() => false);
      logger.debug('generate candidate final state', { sel, enabled });
      if (!enabled) {
        logger.debug('generate button never enabled, trying next', { sel });
        continue;
      }
      await btn.click();
      logger.info('generate clicked', { sel });
      return;
    } catch (e) {
      logger.debug('generate candidate failed', { sel, err: e.message });
    }
  }
  throw new FlowError('GENERATE_BUTTON_NOT_FOUND', 'Could not find Generate button');
}

async function waitForNewImages(page, baselineUuids, timeoutMs, pollMs) {
  const start = Date.now();
  let lastCount = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    const uuids = await extractImageUuids(page);
    const newOnes = uuids.filter((u) => !baselineUuids.has(u));
    if (newOnes.length > 0) {
      logger.info('new images detected', { count: newOnes.length, waited: Date.now() - start });
      return newOnes;
    }
    if (uuids.length !== lastCount) {
      logger.debug('dom image count changed', { count: uuids.length });
      lastCount = uuids.length;
    }
  }
  throw new FlowError('GENERATION_TIMEOUT', `No new images after ${Math.round(timeoutMs / 1000)}s`);
}

export async function generateImage({ browser, config, prompt, model, aspectRatio, outputDir }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new FlowError('INVALID_PROMPT', 'Prompt must be a non-empty string');
  }
  const page = await browser.ensurePage();
  const outDir = outputDir || config.outputDir;
  ensureDir(outDir);

  const jobId = randomUUID().slice(0, 8);
  logger.info('job start', { jobId, prompt: prompt.slice(0, 80), model, aspectRatio });

  await goToNewProject(page, config.flowUrl);
  await switchToImageMode(page);
  await selectAspectRatio(page, aspectRatio);
  await fillPrompt(page, prompt);

  const baseline = new Set(await extractImageUuids(page));
  IMG_UUIDS_BEFORE_GEN.clear();
  baseline.forEach((u) => IMG_UUIDS_BEFORE_GEN.add(u));

  await clickGenerate(page);
  const uuids = await waitForNewImages(page, baseline, config.generationTimeoutMs, config.pollIntervalMs);
  const files = await downloadImagesFromPage(page, uuids, outDir, jobId);

  if (files.length === 0) {
    throw new FlowError('DOWNLOAD_FAILED', 'Images were generated but download failed');
  }

  logger.info('job done', { jobId, count: files.length });
  return {
    jobId,
    model: model || 'nano-banana-2',
    aspectRatio: aspectRatio || 'default',
    prompt,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes, uuid: f.uuid })),
  };
}
