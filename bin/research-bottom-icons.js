// Close the modal, click the small icon at bottom-right (likely mode toggle)
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

// Find ALL buttons in the bottom-right chat input area (within bottom-right region)
const bottomButtons = await page.locator('button').evaluateAll((els) =>
  els
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { text: e.textContent?.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((b) => b.x > 1100 && b.y > 800)
);
console.log('--- bottom-right buttons ---');
console.log(JSON.stringify(bottomButtons, null, 2));

// The icons between + and → — look for their position. Try the leftmost ones (excluding +)
for (const b of bottomButtons) {
  if (!/Create|add/i.test(b.text) && b.w < 60) {
    console.log(`\nClicking button: "${b.text}" at (${b.x},${b.y})`);
    await page.locator(`button`).nth(await page.locator('button').evaluateAll((els, x, y) => {
      return els.findIndex((e) => {
        const r = e.getBoundingClientRect();
        return Math.round(r.x) === x && Math.round(r.y) === y;
      });
    }, b.x, b.y)).click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(projectRoot, 'data', `click-${b.x}-${b.y}.png`), fullPage: true });
    console.log(`Screenshot: data/click-${b.x}-${b.y}.png`);

    // Dump model/aspect options
    const options = await page.locator('[role="option"], [role="menuitem"]').evaluateAll((els) =>
      els.map((e) => e.textContent?.trim().slice(0, 80))
    );
    console.log('--- options shown ---');
    console.log(JSON.stringify(options, null, 2));
    break; // just click the first candidate
  }
}

await closeBrowser();
