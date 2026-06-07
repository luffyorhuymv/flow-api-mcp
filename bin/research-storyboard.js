// Click "Develop a storyboard" to enter video workflow
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

const storyBtn = page.locator('button:has-text("Develop a storyboard")').first();
if (!(await storyBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
  console.log('No storyboard button — reloading');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
}

await storyBtn.click();
await page.waitForTimeout(3000);
await page.screenshot({ path: path.join(projectRoot, 'data', 'storyboard-mode.png'), fullPage: true });
console.log('URL after storyboard click:', page.url());

// Type a simple prompt and see what model options appear
const input = page.locator('[role="textbox"]').first();
await input.click();
await input.fill('A cat walking in a garden');
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(projectRoot, 'data', 'storyboard-prompt.png'), fullPage: true });

// Now click tuneSettings by index
const settingsBtn = page.locator('button[aria-label*="Settings" i], button:has-text("Settings")').filter({ hasText: /tune/ }).first();
const visible = await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false);
console.log('Settings button visible:', visible);
if (visible) {
  await settingsBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(projectRoot, 'data', 'storyboard-settings.png'), fullPage: true });
  // Dump options
  const opts = await page.locator('[role="option"], [role="menuitem"], [role="radio"]').evaluateAll((els) =>
    els.map((e) => e.textContent?.trim().slice(0, 100))
  );
  console.log('--- options ---');
  console.log(JSON.stringify(opts, null, 2));
}

await closeBrowser();
