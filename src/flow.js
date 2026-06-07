import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { logger, ensureDir } from './utils/logger.js';
import { extractImageUuids, extractVideoUuids, downloadImagesFromPage, downloadVideosFromPage, safeFilename } from './utils/downloader.js';

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

export const VIDEO_ASPECT_RATIOS = ['16:9', '9:16'];
export const VIDEO_MODELS = [
  { id: 'omni-flash', label: 'Omni Flash' },
  { id: 'veo-3', label: 'Veo 3' },
  { id: 'veo-3.1', label: 'Veo 3.1' },
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

// ============================================================================
// VIDEO (storyboard workflow)
// ============================================================================
//
// Flow's storyboard is a multi-step agent workflow:
//   1. Click "Develop a storyboard" chip (or any storyboard-related chip — Flow
//      rotates the chip labels between sessions)
//   2. Send prompt; agent creates a Frame N plan
//   3. Send confirmation ("Looks good, generate all videos.")
//   4. Agent calls Veo for each Frame; <video> elements appear with src URLs
//   5. Download each .mp4 via the same media.getMediaUrlRedirect endpoint
//
// Settings → "Never" makes the agent auto-skip the confirmation prompt, but
// in practice the "go" follow-up is still required because the agent pauses
// after the plan to let the user inspect it.
// ============================================================================

async function clickStoryboardChip(page) {
  // Order matters: prefer creation chips over editing chips.
  // "Edit a video with Omni" requires an existing video and will fail with
  // "Something went wrong" if the project is empty.
  const preferPatterns = [
    /develop a storyboard/i,
    /build.*storyboard/i,
    /storyboard/i,
    /create.*scenes?/i,
    /cinemat/i,
  ];
  const skipPatterns = [
    /^edit a video/i,
    /^edit an image/i,
    /^organize/i,
    /^turn a concept/i,
  ];
  // Retry up to 6x (3s total) — chips may not be in DOM immediately
  // after project creation / settings interaction.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const all = await page.locator('button').evaluateAll((els) =>
      els
        .map((e, idx) => ({ idx, text: e.textContent?.trim() || '', aria: e.getAttribute('aria-label') || '' }))
        .filter((b) => b.text && b.text.length > 0 && b.text.length < 80)
    );
    for (const b of all) {
      if (skipPatterns.some((re) => re.test(b.text))) continue;
      for (const re of preferPatterns) {
        if (re.test(b.text) || re.test(b.aria)) {
          const btn = page.locator('button').nth(b.idx);
          try {
            await btn.click({ timeout: 3000 });
            logger.info('clicked storyboard chip', { text: b.text, attempt });
            return true;
          } catch {}
        }
      }
    }
    if (attempt < 5) await page.waitForTimeout(500);
  }
  return false;
}

async function configureVideoDefaults(page, aspectRatio, count) {
  const settingsBtn = page.locator('button:has-text("tuneSettings")').first();
  try {
    if (!(await settingsBtn.isVisible({ timeout: 1500 }))) return false;
    await settingsBtn.click();
    await sleep(1500);

    // Pick aspect ratio (16:9 / 9:16 buttons under "Video generation default")
    const aspectBtn = page.locator(`button:has-text("${aspectRatio}")`).last();
    if (await aspectBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await aspectBtn.click();
      logger.info('video aspect set', { aspectRatio });
    }

    // Pick count (1x / 2x / 3x / 4x)
    const countBtn = page.locator(`button:has-text("${count}x")`).last();
    if (await countBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await countBtn.click();
      logger.info('video count set', { count });
    }

    // Set Never for confirmation
    const never = page.locator('text=Never').first();
    if (await never.isVisible({ timeout: 1000 }).catch(() => false)) {
      await never.click();
    }

    await page.locator('button:has-text("Save")').first().click();
    await sleep(1500);
    return true;
  } catch (e) {
    logger.warn('configureVideoDefaults failed', { err: e.message });
    return false;
  }
}

async function sendChatMessage(page, text) {
  const input = page.locator('[role="textbox"]').first();
  await input.click();
  await sleep(300);
  await input.fill(text);
  await sleep(300);
  await page.keyboard.press('Enter');
  await sleep(1500);
  // If still has text, click arrow_forward as fallback
  const stillThere = await input.textContent().catch(() => null);
  if (stillThere && stillThere.trim() === text) {
    const sendBtn = page.locator('button:has(i:text("arrow_forward")):not([aria-disabled="true"])').last();
    try {
      await sendBtn.click({ timeout: 3000 });
      await sleep(1000);
    } catch (e) {
      throw new FlowError('CHAT_SEND_FAILED', 'Could not send chat message: ' + e.message);
    }
  }
}

async function detectAgentError(page) {
  const errLoc = page.locator('text=/went wrong|sorry,|unable to|error occurred/i').first();
  if ((await errLoc.count()) === 0) return null;
  const txt = (await errLoc.textContent().catch(() => ''))?.trim() || '';
  const fullSnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 800);
  return { message: txt, snippet: fullSnippet };
}

async function waitForPlanResponse(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const err = await detectAgentError(page);
    if (err) {
      throw new FlowError('AGENT_ERROR', `Flow agent error: ${err.message}`, { snippet: err.snippet });
    }
    const planCount = await page.locator('text=/frame \\d|scene \\d|ready to go|move on|generating the visual|proceed/i').count();
    if (planCount > 0) {
      logger.info('plan response detected', { waitedMs: Date.now() - start });
      return true;
    }
    await sleep(3000);
  }
  return false;
}

async function waitForVideos(page, timeoutMs, pollMs) {
  const start = Date.now();
  let lastCount = 0;
  while (Date.now() - start < timeoutMs) {
    const err = await detectAgentError(page);
    if (err) {
      throw new FlowError('AGENT_ERROR', `Agent errored while generating videos: ${err.message}`, { snippet: err.snippet });
    }
    const uuids = await extractVideoUuids(page);
    if (uuids.length > lastCount) {
      logger.info('new video UUIDs', { count: uuids.length, waited: Date.now() - start });
      lastCount = uuids.length;
    }
    if (uuids.length > 0) {
      // verify each has a non-blank src already
      const allReady = await page.evaluate((reSrc) => {
        const re = new RegExp(reSrc, 'i');
        const videos = document.querySelectorAll('video');
        let ready = 0;
        for (const v of videos) {
          const src = v.src || v.currentSrc || '';
          if (re.test(src) && v.readyState >= 1) ready++;
        }
        return ready;
      }, REDIRECT_RE.source);
      if (allReady >= uuids.length) {
        logger.info('all videos ready', { count: uuids.length });
        return uuids;
      }
    }
    await sleep(pollMs);
  }
  throw new FlowError('VIDEO_GENERATION_TIMEOUT', `No videos ready after ${Math.round(timeoutMs / 1000)}s`);
}

const REDIRECT_RE_SRC = 'media\\.getMediaUrlRedirect\\?name=([a-f0-9-]+)';
const REDIRECT_RE = new RegExp(REDIRECT_RE_SRC, 'i');

export async function generateVideo({ browser, config, prompt, aspectRatio = '16:9', count = 1, outputDir }) {
  if (!prompt || typeof prompt !== 'string') {
    throw new FlowError('INVALID_PROMPT', 'Prompt must be a non-empty string');
  }
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new FlowError('INVALID_ASPECT', `Aspect must be one of ${VIDEO_ASPECT_RATIOS.join(', ')}`);
  }
  if (![1, 2, 3, 4].includes(count)) {
    throw new FlowError('INVALID_COUNT', 'Count must be 1, 2, 3, or 4');
  }

  const page = await browser.ensurePage();
  const outDir = outputDir || config.outputDir;
  ensureDir(outDir);

  const jobId = randomUUID().slice(0, 8);
  logger.info('video job start', { jobId, prompt: prompt.slice(0, 80), aspectRatio, count });

  await goToNewProject(page, config.flowUrl);
  await configureVideoDefaults(page, aspectRatio, count);

  const chipClicked = await clickStoryboardChip(page);
  if (!chipClicked) {
    logger.warn('no storyboard chip found, sending direct chat prompt');
  }
  await sleep(1000);

  // Outer retry: if Flow's agent errors with "Something went wrong",
  // click "Try again" button (or recreate project + resend) up to 3 times.
  let files = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sendChatMessage(page, prompt);
      logger.info('prompt sent, waiting for agent plan', { attempt });

      const planOk = await waitForPlanResponse(page, 180000);
      if (!planOk) {
        throw new FlowError('PLAN_TIMEOUT', 'Agent did not produce a storyboard plan within 3 minutes');
      }
      await sleep(2000);

      // Send confirmation to trigger video generation
      await sendChatMessage(page, 'Looks great. Please generate the videos now.');
      logger.info('confirmation sent, waiting for videos', { attempt });

      // Video generation can take 1-5 min per scene
      const videoTimeoutMs = Math.max(config.generationTimeoutMs, 480000);
      const uuids = await waitForVideos(page, videoTimeoutMs, config.pollIntervalMs);
      files = await downloadVideosFromPage(page, uuids, outDir, jobId);
      break;
    } catch (e) {
      if (e.code !== 'AGENT_ERROR' || attempt === 3) throw e;
      logger.warn('agent error, trying Try again button', { attempt, err: e.message });
      // Try clicking the "Try again" button in-place first
      const tryAgain = page.locator('button:has-text("Try again")').first();
      const tryAgainOk = (await tryAgain.count()) > 0
        ? await tryAgain.click({ timeout: 3000 }).then(() => true).catch(() => false)
        : false;
      if (tryAgainOk) {
        await sleep(2000);
        continue;
      }
      // Fallback: re-navigate to a fresh project
      await goToNewProject(page, config.flowUrl);
      await configureVideoDefaults(page, aspectRatio, count);
      await clickStoryboardChip(page).catch(() => {});
      await sleep(2000);
    }
  }

  if (files.length === 0) {
    throw new FlowError('VIDEO_DOWNLOAD_FAILED', 'Videos were generated but download failed');
  }

  logger.info('video job done', { jobId, count: files.length });
  return {
    jobId,
    aspectRatio,
    count,
    prompt,
    files: files.map((f) => ({ path: f.path, bytes: f.bytes, uuid: f.uuid })),
  };
}
