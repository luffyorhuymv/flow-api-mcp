// Find the new project button + look for project type selector (image / video / storyboard)
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

await page.screenshot({ path: path.join(projectRoot, 'data', 'projects-list.png'), fullPage: true });

// Look for "New project" or "Create" button
const newBtn = page.locator('button:has-text("New project"), button:has-text("Create"), a:has-text("New project")').first();
if (!(await newBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
  console.log('NO New project button visible');
  await closeBrowser();
  process.exit(1);
}

const btnText = await newBtn.textContent();
console.log('Found new-project button:', btnText);
await newBtn.click();
await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(2000);

console.log('URL after click:', page.url());
await page.screenshot({ path: path.join(projectRoot, 'data', 'new-project-modal.png'), fullPage: true });

// Dump all clickable items in the modal
const items = await page.locator('button, [role="button"], [role="radio"], [role="option"], [role="menuitem"]').evaluateAll((els) =>
  els
    .map((e) => ({
      tag: e.tagName,
      text: e.textContent?.trim().slice(0, 100),
      aria: e.getAttribute('aria-label'),
      role: e.getAttribute('role'),
    }))
    .filter((b) => (b.text && b.text.length > 0) || b.aria)
);
console.log(`\n--- ${items.length} items in new-project UI ---`);
console.log(JSON.stringify(items, null, 2));

await closeBrowser();
