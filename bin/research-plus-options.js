// Click + button to expand, then look for Omni chip
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

// Click + in the bottom-right chat input
const plusBtn = page.locator('button:has(i:text("add"))').last();
const addBtns = await page.locator('button:has(i:text("add"))').evaluateAll((els) =>
  els.map((e) => ({ text: e.textContent?.trim(), rect: e.getBoundingClientRect() }))
);
console.log('add buttons:');
addBtns.forEach((b, i) => console.log(`  [${i}] "${b.text}" @ x=${Math.round(b.rect.x)},y=${Math.round(b.rect.y)},w=${Math.round(b.rect.width)},h=${Math.round(b.rect.height)}`));

// Click the last (bottom-right) add button
await plusBtn.click();
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(projectRoot, 'data', 'after-plus.png'), fullPage: true });

// Dump items with "video" or "omni" or "veo"
const items = await page.locator('button, [role="button"], [role="menuitem"], [role="option"]').evaluateAll((els) =>
  els
    .map((e) => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 80) }))
    .filter((b) => /video|omni|veo|image|frame|movie|scene/i.test(b.text || ''))
);
console.log(`--- ${items.length} media-type items ---`);
console.log(JSON.stringify(items, null, 2));

await closeBrowser();
