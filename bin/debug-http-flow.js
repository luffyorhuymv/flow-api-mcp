import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBrowser, closeBrowser } from '../src/browser.js';
import { buildConfig } from '../src/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const config = buildConfig(process.env, projectRoot);

const browser = getBrowser(config);
await browser.launch({ headed: false });
const page = await browser.ensurePage();
await page.goto('https://labs.google/fx/tools/flow/project/2cd4a26a-f142-4012-af6b-4605d84e8824', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(3000);
const inputs = await page.locator('div[contenteditable="true"], textarea, input[type="text"]').evaluateAll((els) =>
  els.map((e) => {
    const rect = e.getBoundingClientRect();
    return {
      tag: e.tagName,
      ce: e.getAttribute('contenteditable'),
      placeholder: e.getAttribute('placeholder'),
      ariaLabel: e.getAttribute('aria-label'),
      visible: rect.width > 0 && rect.height > 0,
      classes: (e.className || '').slice(0, 80),
    };
  }),
);
console.log('--- inputs ---');
console.log(JSON.stringify(inputs, null, 2));
await page.screenshot({ path: path.join(projectRoot, 'data', 'http-debug.png'), fullPage: true });
console.log('Screenshot: data/http-debug.png');
const text = await page.locator('body').innerText();
console.log('--- body (first 800) ---');
console.log(text.slice(0, 800));
await closeBrowser();
