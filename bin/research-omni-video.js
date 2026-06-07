// Click "Edit a video with Omni" to enter video workflow
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

const omniBtn = page.locator('button:has-text("Edit a video with Omni")').first();
if (await omniBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  console.log('Clicking "Edit a video with Omni"...');
  await omniBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(projectRoot, 'data', 'omni-video-mode.png'), fullPage: true });

  // Dump full UI
  const items = await page.locator('button, [role="button"], [role="tab"], [role="radio"]').evaluateAll((els) =>
    els
      .map((e) => ({
        tag: e.tagName,
        text: e.textContent?.trim().slice(0, 80),
        aria: e.getAttribute('aria-label'),
      }))
      .filter((b) => (b.text && b.text.length > 0) || b.aria)
  );
  console.log(`--- ${items.length} items in video mode ---`);
  console.log(JSON.stringify(items, null, 2));

  // Look for model selector
  const modelList = await page.locator('select, [role="listbox"]').evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      options: e.tagName === 'SELECT'
        ? Array.from(e.options).map((o) => o.text)
        : Array.from(e.querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim().slice(0, 40)),
    }))
  );
  console.log('--- model selectors ---');
  console.log(JSON.stringify(modelList, null, 2));
}

await closeBrowser();
