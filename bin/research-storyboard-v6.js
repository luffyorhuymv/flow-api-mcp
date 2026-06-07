// v6: simpler prompt + better error detection
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage } from './_runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const screenshotDir = path.join(projectRoot, 'data', 'storyboard-v6');

async function main() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(screenshotDir, { recursive: true });

  await withPage(async (browser, page) => {
    async function sendMessage(text) {
      const input = page.locator('[role="textbox"]').first();
      await input.click();
      await page.waitForTimeout(300);
      await input.fill(text);
      await page.waitForTimeout(500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    }

    console.log('1) New project...');
    await page.goto(browser.config.flowUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("New project")').first().click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Settings
    const settingsBtn = page.locator('button:has-text("tuneSettings")').first();
    if (await settingsBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1500);
      const oneX = page.locator('button:has-text("1x")').last();
      if (await oneX.isVisible({ timeout: 1000 }).catch(() => false)) await oneX.click();
      const never = page.locator('text=Never').first();
      if (await never.isVisible({ timeout: 1000 }).catch(() => false)) await never.click();
      await page.locator('button:has-text("Save")').first().click();
      await page.waitForTimeout(1500);
    }

    console.log('2) Send SIMPLE storyboard prompt...');
    await sendMessage('A cat in a garden. Two scenes: first the cat walks, then it stops to watch a butterfly.');
    console.log('  → sent');

    // Wait for plan OR error
    let planReady = false;
    let errored = false;
    for (let i = 0; i < 36; i++) {
      await page.waitForTimeout(5000);
      const errCount = await page.locator('text=/went wrong|sorry|unable/i').count();
      if (errCount > 0) {
        errored = true;
        console.log(`  → error at ${(i + 1) * 5}s`);
        break;
      }
      const planCount = await page.locator('text=/frame \\d|scene \\d|ready to go|move on/i').count();
      if (planCount > 0) {
        planReady = true;
        console.log(`  → plan ready at ${(i + 1) * 5}s`);
        break;
      }
    }
    await page.screenshot({ path: path.join(screenshotDir, '10-plan.png'), fullPage: true });

    if (errored) {
      console.log('Aborting - agent errored');
      return;
    }
    if (!planReady) {
      console.log('Aborting - no plan after 3 min');
      return;
    }

    console.log('3) Send "go"...');
    await sendMessage('Looks great, please generate the videos.');
    console.log('  → sent go');

    // Poll for videos
    let lastSig = '';
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(10000);
      const stats = await page.evaluate(() => {
        const videos = document.querySelectorAll('video');
        const srcs = Array.from(videos).map((v) => v.getAttribute('src') || '');
        const errs = document.querySelectorAll('[class*="error" i]').length;
        return { videoCount: videos.length, srcs, errs };
      });
      const sig = `${stats.videoCount}|${stats.srcs.join('|')}|${stats.errs}`;
      if (sig !== lastSig) {
        console.log(`  [${(i + 1) * 10}s] videos=${stats.videoCount}, errs=${stats.errs}`);
        stats.srcs.slice(0, 3).forEach((s, j) => console.log(`    src[${j}]: ${s.slice(0, 100)}`));
        lastSig = sig;
      }
      if ((i + 1) % 3 === 0) {
        await page.screenshot({ path: path.join(screenshotDir, `11-t${(i + 1) * 10}s.png`), fullPage: true });
      }
      if (stats.videoCount > 0 && stats.srcs.filter((s) => s.length > 0).length === stats.videoCount) {
        console.log('  → ALL VIDEOS HAVE SRCS!');
        break;
      }
    }

    await page.screenshot({ path: path.join(screenshotDir, '99-final.png'), fullPage: true });
  }, { headed: false });
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
