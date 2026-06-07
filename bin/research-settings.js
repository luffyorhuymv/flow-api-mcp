// Click "tuneSettings" to see model selector
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

const settingsBtn = page.locator('button:has-text("tuneSettings")').first();
if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await settingsBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(projectRoot, 'data', 'settings-open.png'), fullPage: true });

  // Dump ALL options in the open panel
  const items = await page.locator('button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], label').evaluateAll((els) =>
    els
      .map((e) => ({
        tag: e.tagName,
        text: e.textContent?.trim().slice(0, 100),
        role: e.getAttribute('role'),
        selected: e.getAttribute('aria-selected') || e.getAttribute('aria-checked'),
      }))
      .filter((b) => b.text && b.text.length > 0)
  );
  console.log(`--- ${items.length} items in settings panel ---`);
  console.log(JSON.stringify(items, null, 2));
}

await closeBrowser();
