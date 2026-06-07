// Inspect Flow UI to find video tab, video models, and model selector
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

// Open most recent project
await page.waitForTimeout(2000);
let card = page.locator('a[href*="/project/"]').first();
if (await card.isVisible({ timeout: 2000 }).catch(() => false)) {
  await card.click();
} else {
  console.log('No projects in list, clicking New project');
  const newBtn = page.locator('button:has-text("New project"), a:has-text("New project")').first();
  await newBtn.click();
}
await page.waitForURL(/\/project\/[a-f0-9-]+/, { timeout: 15000 });
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(3000);

console.log('URL:', page.url());
const tabs = await page.locator('button, [role="tab"]').evaluateAll((els) =>
  els
    .map((e) => ({
      tag: e.tagName,
      text: e.textContent?.trim().slice(0, 40),
      aria: e.getAttribute('aria-label'),
      role: e.getAttribute('role'),
    }))
    .filter((b) => /(image|video|movie|scene|frame|all|asset)/i.test(b.text || b.aria || ''))
);
console.log('--- mode tabs ---');
console.log(JSON.stringify(tabs, null, 2));

// Look for any button mentioning "Video", "Movie", or "Veo"
const videoBtns = await page.locator('button, a').evaluateAll((els) =>
  els
    .map((e) => ({
      text: e.textContent?.trim().slice(0, 60),
      aria: e.getAttribute('aria-label'),
    }))
    .filter((b) => /veo|video|movie|omni/i.test(b.text || b.aria || ''))
);
console.log('--- video-related buttons ---');
console.log(JSON.stringify(videoBtns, null, 2));

// Click "Tools" / "Settings" to find model selector
const toolsBtn = page.locator('button:has-text("Tools"), button[aria-label*="Tools" i]').first();
if (await toolsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await toolsBtn.click();
  await page.waitForTimeout(2000);
  const modelList = await page.locator('[role="menuitem"], [role="option"], [role="listbox"] *').evaluateAll((els) =>
    els.map((e) => e.textContent?.trim().slice(0, 80)).filter(Boolean).slice(0, 30)
  );
  console.log('--- tools/menu items ---');
  console.log(JSON.stringify(modelList, null, 2));
}

await page.screenshot({ path: path.join(projectRoot, 'data', 'video-research.png'), fullPage: true });
console.log('Screenshot: data/video-research.png');
await closeBrowser();
