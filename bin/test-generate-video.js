// Real end-to-end test of generate_video
import { withBrowser } from './_runner.js';
import { generateVideo } from '../src/flow.js';
import { buildConfig } from '../src/handler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

const config = buildConfig(process.env, projectRoot);

const startTs = Date.now();
function log(msg, extra = {}) {
  console.log(`[+${Math.round((Date.now() - startTs) / 1000)}s] ${msg}`, extra);
}

await withBrowser(async (browser) => {
  log('Starting video generation test');
  try {
    const result = await generateVideo({
      browser,
      config,
      prompt: 'A single short scene: a hummingbird hovering over a red flower in slow motion, soft golden backlight.',
      aspectRatio: '16:9',
      count: 1,
    });
    log('SUCCESS', { files: result.files });
  } catch (e) {
    log('FAILED', { code: e.code, message: e.message });
    process.exit(1);
  }
}, { headed: false });
