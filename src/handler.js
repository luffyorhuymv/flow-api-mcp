import path from 'node:path';
import { getBrowser, closeBrowser } from './browser.js';
import { generateImage, generateVideo, FlowError, IMAGE_MODELS, ASPECT_RATIOS, VIDEO_MODELS, VIDEO_ASPECT_RATIOS } from './flow.js';
import { logger, ensureDir } from './utils/logger.js';
import { toolDefinitions } from './tools/index.js';

export function buildConfig(env = process.env, projectRoot) {
  const resolve = (p) => (projectRoot ? path.resolve(projectRoot, p) : path.resolve(p));
  const config = {
    chromeProfileDir: resolve(env.CHROME_PROFILE_DIR || './data/chrome-profile'),
    outputDir: resolve(env.OUTPUT_DIR || './output'),
    locale: env.LOCALE || 'en',
    headless: (env.HEADLESS || 'true') === 'true',
    useSystemChrome: (env.USE_SYSTEM_CHROME || 'true') === 'true',
    flowUrl: env.FLOW_URL || 'https://labs.google/fx/tools/flow',
    generationTimeoutMs: parseInt(env.GENERATION_TIMEOUT_MS || '180000', 10),
    pollIntervalMs: parseInt(env.POLL_INTERVAL_MS || '2000', 10),
    actionTimeoutMs: parseInt(env.ACTION_TIMEOUT_MS || '30000', 10),
  };
  ensureDir(config.chromeProfileDir);
  ensureDir(config.outputDir);
  return config;
}

export async function handleToolCall(name, args, config) {
  const browser = getBrowser(config);
  try {
    switch (name) {
      case 'generate_image': {
        const result = await generateImage({
          browser,
          config,
          prompt: args.prompt,
          model: args.model,
          aspectRatio: args.aspect_ratio,
          outputDir: args.output_dir,
          projectId: args.project_id,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              ...result,
              files: result.files.map((f) => f.path),
            }, null, 2),
          }],
        };
      }

      case 'flow_status': {
        const status = await browser.isLoggedIn();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              ...status,
              uptimeSec: browser.uptimeSec(),
              models: IMAGE_MODELS,
              aspectRatios: ASPECT_RATIOS,
              videoModels: VIDEO_MODELS,
              videoAspectRatios: VIDEO_ASPECT_RATIOS,
              config: {
                flowUrl: config.flowUrl,
                outputDir: config.outputDir,
                chromeProfileDir: config.chromeProfileDir,
              },
            }, null, 2),
          }],
        };
      }

      case 'flow_login': {
        const timeoutSec = args.timeout_sec || 300;
        if (browser.context) await browser.close();
        await browser.launch({ headed: true });
        const page = await browser.ensurePage();
        await page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });
        logger.info('login window opened - waiting for user');
        const deadline = Date.now() + timeoutSec * 1000;
        let loggedIn = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const url = page.url();
          if (!url.includes('accounts.google.com')) {
            try {
              const has = await page.locator('a[href*="/project/"]').first().isVisible({ timeout: 2000 });
              if (has) { loggedIn = true; break; }
            } catch {}
          }
        }
        await browser.close();
        if (!loggedIn) {
          return { content: [{ type: 'text', text: `Login timed out after ${timeoutSec}s. Run \`flow_login\` again to retry.` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, loggedIn: true, message: 'Login successful. Session saved.' }) }] };
      }

      case 'flow_close': {
        await closeBrowser();
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, message: 'Browser closed.' }) }] };
      }

      case 'generate_video': {
        const result = await generateVideo({
          browser,
          config,
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          count: args.count,
          outputDir: args.output_dir,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              ...result,
              files: result.files.map((f) => f.path),
              note: 'Video generation took several minutes. Each scene produces a separate .mp4 file.',
            }, null, 2),
          }],
        };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    if (err instanceof FlowError) {
      logger.error('flow error', { code: err.code, msg: err.message });
      return { content: [{ type: 'text', text: `[${err.code}] ${err.message}` }], isError: true };
    }
    logger.error('unexpected error', { msg: err.message, stack: err.stack });
    return { content: [{ type: 'text', text: `Unexpected error: ${err.message}` }], isError: true };
  }
}

export { toolDefinitions };
