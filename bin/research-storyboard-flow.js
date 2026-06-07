// v4: try direct chat (no chip) — agent may auto-detect storyboard intent
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage } from './_runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const screenshotDir = path.join(projectRoot, 'data', 'storyboard-flow');

async function main() {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(screenshotDir, { recursive: true });

  await withPage(async (browser, page) => {
    console.log('1) New project...');
    await page.goto(browser.config.flowUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.locator('button:has-text("New project")').first().click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Set Settings: 1x videos, 16:9, Omni, Never
    const settingsBtn = page.locator('button:has-text("tuneSettings")').first();
    if (await settingsBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForTimeout(1500);
      const oneX = page.locator('button:has-text("1x")').last();
      if (await oneX.isVisible({ timeout: 1000 }).catch(() => false)) {
        await oneX.click();
        console.log('  → video count = 1x');
      }
      const never = page.locator('text=Never').first();
      if (await never.isVisible({ timeout: 1000 }).catch(() => false)) {
        await never.click();
      }
      await page.locator('button:has-text("Save")').first().click();
      await page.waitForTimeout(1500);
    }

    // Find a storyboard/video-related chip and click it
    console.log('2) Scan chips for storyboard/video...');
    const chips = await page.locator('button').evaluateAll((els) =>
      els.map((e) => e.textContent?.trim()).filter((t) => t && t.length > 0 && t.length < 60)
    );
    console.log('  available chips:', JSON.stringify(chips));
    const storyboardKeywords = /storyboard|video|scenes|cinemat|omni/i;
    const bestChip = chips.find((c) => storyboardKeywords.test(c)) || chips.find((c) => c && !/^arrow_|^add|^article|^tune|^edit_square|^close|^left|^menu|^dashboard|^accessibility|^movie|^apps|^delete|^more_vert|^settings|^help|^search|^filter|^content|^flag|^Untitled/i.test(c));
    console.log('  best chip:', bestChip);

    if (bestChip) {
      await page.locator(`button:has-text("${bestChip.slice(0, 30)}")`).first().click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: path.join(screenshotDir, '10-after-chip.png'), fullPage: true });

    // Direct prompt to chat — make it clear we want a storyboard
    console.log('3) Send storyboard prompt...');
    const input = page.locator('[role="textbox"]').first();
    await input.click();
    await page.waitForTimeout(500);
    const prompt = 'Create a 2-scene cinematic storyboard video: Scene 1 - a dragon flies over snow mountains at golden hour. Scene 2 - the dragon dives down toward a turquoise lake. Generate video for each scene. Use the Omni Flash model, 16:9 aspect.';
    await page.keyboard.type(prompt, { delay: 15 });
    await page.waitForTimeout(500);
    await page.locator('button:has(i:text("arrow_forward"))').last().click();
    console.log('  → sent');

    // Poll for plan
    let planReady = false;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      const t = await page.locator('text=/ready to go|move on|generating the visual|proceed|frame|scene/i').count();
      if (t > 2) {
        planReady = true;
        console.log(`  → plan appears (${(i + 1) * 5}s)`);
        break;
      }
    }
    await page.screenshot({ path: path.join(screenshotDir, '11-after-prompt.png'), fullPage: true });

    if (planReady) {
      console.log('4) Send confirmation "go"...');
      await input.click();
      await page.waitForTimeout(500);
      await page.keyboard.type('Go ahead, generate all scenes now.', { delay: 15 });
      await page.locator('button:has(i:text("arrow_forward"))').last().click();
      console.log('  → sent confirmation');

      // Poll for videos (up to 6 min)
      let lastSig = '';
      for (let i = 0; i < 36; i++) {
        await page.waitForTimeout(10000);
        const stats = await page.evaluate(() => {
          const videos = document.querySelectorAll('video');
          const srcs = Array.from(videos).map((v) => v.getAttribute('src') || v.currentSrc || '<no-src>');
          const hasDuration = Array.from(videos).some((v) => v.duration > 0);
          return { videoCount: videos.length, srcs, hasDuration };
        });
        const sig = `${stats.videoCount}|${stats.srcs.join('|')}`;
        if (sig !== lastSig) {
          console.log(`  [${(i + 1) * 10}s] videos=${stats.videoCount}, hasDuration=${stats.hasDuration}`);
          stats.srcs.slice(0, 3).forEach((s, j) => console.log(`    video[${j}]: ${s.slice(0, 100)}`));
          lastSig = sig;
        }
        if (i % 3 === 0) {
          await page.screenshot({ path: path.join(screenshotDir, `12-gen-t${(i + 1) * 10}s.png`), fullPage: true });
        }
        if (stats.videoCount > 0 && stats.srcs.every((s) => s && !s.includes('<no-src>') && s.length > 0)) {
          console.log('  → videos have src URLs!');
          break;
        }
      }
    }

    await page.screenshot({ path: path.join(screenshotDir, '99-final.png'), fullPage: true });
  }, { headed: false });
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
