// Test project reuse: 1) generate, 2) reuse projectId
import { withBrowser } from './_runner.js';
import { generateImage } from '../src/flow.js';
import { buildConfig } from '../src/handler.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
loadConfig({ path: path.join(projectRoot, '.env') });

const config = buildConfig(process.env, projectRoot);
const t0 = Date.now();
const log = (m, e = {}) => console.log(`[+${Math.round((Date.now() - t0) / 1000)}s] ${m}`, e);

await withBrowser(async (browser) => {
  // Step 1: generate in new project
  log('Step 1: generate in NEW project');
  const r1 = await generateImage({
    browser, config,
    prompt: 'A simple red apple on a white background',
    aspectRatio: '1:1',
  });
  log('Step 1 done', { projectId: r1.projectId, count: r1.files.length });

  // Step 2: reuse projectId
  log('Step 2: generate in EXISTING project');
  const r2 = await generateImage({
    browser, config,
    prompt: 'A simple green pear on a white background',
    aspectRatio: '1:1',
    projectId: r1.projectId,
  });
  log('Step 2 done', { projectId: r2.projectId, count: r2.files.length });

  // Verify same project
  if (r1.projectId === r2.projectId) {
    log('PASS — same project reused', { projectId: r1.projectId });
  } else {
    log('FAIL — different projects', { r1: r1.projectId, r2: r2.projectId });
    process.exit(1);
  }
}, { headed: false });
