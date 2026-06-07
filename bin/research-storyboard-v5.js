// v5: reliable send via Enter + aria-disabled polling
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage } from './_runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const screenshotDir = path.join(projectRoot, 'data', 'storyboard-flow-v5');

async function main() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(screenshotDir, { recursive: true });

  await withPage(async (browser, page) => {
    async function sendMessage(text) {
      const input = page.locator('[role="textbox"]').first();
      await input.click();
      await page.waitForTimeout(300);
      await input.fill(text);
      await page.waitForTimeout(300);
      // Try Enter first
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      // If still has text, click arrow_forward button (the enabled one)
      const stillThere = await input.textContent();
      if (stillThere && stillThere.trim() === text) {
        console.log('    [send] Enter did not submit, clicking send button...');
        // find enabled send button (aria-disabled=false)
        const sendBtn = page.locator('button:has(i:text("arrow_forward")):not([aria-disabled="true"])').last();
        await sendBtn.click({ timeout: 5000 });
        await page.waitForTimeout(500);
      }
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

    console.log('2) Send storyboard prompt...');
    await sendMessage('Make a 2-scene video storyboard: Scene 1 - a dragon flying over snow mountains at golden hour. Scene 2 - the dragon diving toward a turquoise lake. Generate the videos using Omni Flash, 16:9.');
    console.log('  → sent');

    // Wait for plan
    console.log('3) Wait for plan response...');
    let planReady = false;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      const t = await page.locator('text=/ready to go|move on|generating the visual|proceed|frame \\d/i').count();
      if (t > 0) {
        planReady = true;
        console.log(`  → plan found (${(i + 1) * 5}s)`);
        break;
      }
    }
    if (!planReady) {
      console.log('  → no plan after 2 min, sending go anyway');
    }
    await page.screenshot({ path: path.join(screenshotDir, '10-plan.png'), fullPage: true });

    console.log('4) Send "go"...');
    await sendMessage('Go ahead, generate all scenes now.');
    console.log('  → sent go');

    // Poll for videos
    let lastSig = '';
    let videoCount = 0;
    for (let i = 0; i < 36; i++) {
      await page.waitForTimeout(10000);
      const stats = await page.evaluate(() => {
        const videos = document.querySelectorAll('video');
        const srcs = Array.from(videos).map((v) => v.getAttribute('src') || v.currentSrc || '');
        const ready = Array.from(videos).filter((v) => v.readyState >= 2).length;
        return { videoCount: videos.length, srcs, ready };
      });
      const sig = `${stats.videoCount}|${stats.srcs.join('|')}|${stats.ready}`;
      if (sig !== lastSig) {
        console.log(`  [${(i + 1) * 10}s] videos=${stats.videoCount} (ready=${stats.ready})`);
        stats.srcs.slice(0, 3).forEach((s, j) => console.log(`    src[${j}]: ${s.slice(0, 100)}`));
        lastSig = sig;
        videoCount = stats.videoCount;
      }
      if (i % 3 === 0) {
        await page.screenshot({ path: path.join(screenshotDir, `11-gen-t${(i + 1) * 10}s.png`), fullPage: true });
      }
      if (stats.videoCount > 0 && stats.srcs.filter((s) => s.length > 0).length === stats.videoCount && stats.videoCount > 0) {
        console.log('  → all videos have src URLs!');
        break;
      }
    }

    // Also check All Media view
    if (videoCount === 0) {
      console.log('5) Try All Media view...');
      const allMedia = page.locator('button:has-text("All Media")').first();
      if (await allMedia.isVisible({ timeout: 1000 }).catch(() => false)) {
        await allMedia.click();
        await page.waitForTimeout(3000);
        const stats = await page.evaluate(() => {
          const videos = document.querySelectorAll('video');
          return { videoCount: videos.length, srcs: Array.from(videos).map((v) => v.getAttribute('src') || '') };
        });
        console.log(`  All Media: ${stats.videoCount} videos`);
        await page.screenshot({ path: path.join(screenshotDir, '12-all-media.png'), fullPage: true });
      }
    }

    await page.screenshot({ path: path.join(screenshotDir, '99-final.png'), fullPage: true });
  }, { headed: false });
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
