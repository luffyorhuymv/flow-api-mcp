// Click Scenes in sidebar to see direct video creation
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

// Click "Scenes" in sidebar
const scenesBtn = page.locator('button:has-text("Scenes"), button:has-text("View scenes")').first();
if (await scenesBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
  await scenesBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(projectRoot, 'data', 'scenes-view.png'), fullPage: true });
  console.log('Scenes clicked. URL:', page.url());

  // Dump items in scenes view
  const items = await page.locator('button, [role="button"], a').evaluateAll((els) =>
    els
      .map((e) => ({ tag: e.tagName, text: e.textContent?.trim().slice(0, 80) }))
      .filter((b) => b.text && b.text.length > 0)
  );
  console.log(`--- ${items.length} items in Scenes view ---`);
  console.log(JSON.stringify(items, null, 2));
}

await closeBrowser();
