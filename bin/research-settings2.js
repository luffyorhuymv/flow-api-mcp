// Click tuneSettings by position
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
await page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2000);

const newBtn = page.locator('button:has-text("New project")').first();
await newBtn.click();
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2000);

console.log('Clicking at position (1365, 830) — tuneSettings...');
await page.mouse.click(1365, 830);
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(projectRoot, 'data', 'settings-open.png'), fullPage: true });
console.log('Screenshot: data/settings-open.png');

// Dump options
const items = await page.locator('button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], label').evaluateAll((els) =>
  els
    .map((e) => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 80) }))
    .filter((b) => b.text && b.text.length > 0 && b.text.length < 80)
);
console.log(`--- ${items.length} items after click ---`);
console.log(JSON.stringify(items, null, 2));

await closeBrowser();
