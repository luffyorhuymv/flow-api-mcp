// Click the + button to see new content options
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

// Click new project to enter empty project
const newBtn = page.locator('button:has-text("New project")').first();
await newBtn.click();
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2000);

// Find the + (add) button at bottom right (not Add Media which is at top of media area)
const plusBtn = page.locator('button:has-text("add_2Create"), button[aria-label*="Create" i]').last();
const exists = await plusBtn.isVisible({ timeout: 2000 }).catch(() => false);
console.log('plus/create button visible:', exists);
if (exists) {
  await plusBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(projectRoot, 'data', 'create-options.png'), fullPage: true });

  const items = await page.locator('button, [role="button"], [role="menuitem"], [role="option"]').evaluateAll((els) =>
    els
      .map((e) => ({
        tag: e.tagName,
        text: e.textContent?.trim().slice(0, 100),
        aria: e.getAttribute('aria-label'),
      }))
      .filter((b) => (b.text && b.text.length > 0 && b.text.length < 60) || /image|video|frame|scene|character/i.test(b.aria || ''))
  );
  console.log(`--- ${items.length} items after click ---`);
  console.log(JSON.stringify(items, null, 2));
}

await closeBrowser();
