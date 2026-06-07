import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { logger, ensureDir } from './utils/logger.js';

class BrowserManager {
  constructor(config) {
    this.config = config;
    this.context = null;
    this.page = null;
    this.startedAt = 0;
  }

  async launch({ headed = false } = {}) {
    if (this.context) {
      logger.debug('browser already launched');
      return this.context;
    }
    const profileDir = ensureDir(this.config.chromeProfileDir);
    logger.info('launching persistent browser', { profileDir, headed });
    const useSystemChrome = (process.env.USE_SYSTEM_CHROME || 'true') === 'true';
    const onLinux = process.platform === 'linux';
    const userAgent =
      process.env.FLOW_USER_AGENT ||
      (onLinux
        ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36');
    const headlessMode =
      process.env.CHROMIUM_LAUNCHER_HEADLESS_MODE ||
      (onLinux ? 'new' : undefined);
    this.context = await chromium.launchPersistentContext(profileDir, {
      channel: useSystemChrome ? 'chrome' : undefined,
      headless: !headed && this.config.headless,
      headlessMode: headlessMode,
      viewport: { width: 1440, height: 900 },
      locale: this.config.locale,
      userAgent,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--disable-popup-blocking',
        '--disable-notifications',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--start-maximized',
        '--window-size=1440,900',
      ],
      ignoreDefaultArgs: ['--enable-automation', 'enable-automation'],
    });
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.navigator.chrome = { runtime: {} };
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
      const langs = navigator.language ? [navigator.language, 'en-US', 'en'] : ['en-US', 'en'];
      Object.defineProperty(navigator, 'languages', { get: () => langs });
    });
    this.context.setDefaultTimeout(this.config.actionTimeoutMs);
    this.page = this.context.pages()[0] || (await this.context.newPage());
    this.startedAt = Date.now();
    logger.info('browser launched', { channel: useSystemChrome ? 'chrome' : 'chromium', headlessMode, ua: userAgent.slice(0, 60) });
    return this.context;
  }

  async ensurePage() {
    if (!this.context) await this.launch();
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages()[0] || (await this.context.newPage());
    }
    return this.page;
  }

  async isLoggedIn() {
    const page = await this.ensurePage();
    await page.goto(this.config.flowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const url = page.url();
    if (url.includes('accounts.google.com')) {
      return { loggedIn: false, url, reason: 'redirected_to_google_login' };
    }
    try {
      const projectCount = await page.locator('a[href*="/project/"]').count();
      if (projectCount > 0) {
        return { loggedIn: true, url, reason: 'flow_loaded', projectCount };
      }
      const newProjectBtn = await page
        .getByRole('button', { name: /new project/i })
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (newProjectBtn) {
        return { loggedIn: true, url, reason: 'flow_loaded_new_project_button' };
      }
      return { loggedIn: false, url, reason: 'no_project_links' };
    } catch (e) {
      return { loggedIn: false, url, reason: 'flow_ui_not_detected', error: e.message };
    }
  }

  async close() {
    if (this.context) {
      try {
        await this.context.close();
      } catch (e) {
        logger.warn('error closing browser', { err: e.message });
      }
      this.context = null;
      this.page = null;
    }
  }

  uptimeSec() {
    return this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0;
  }
}

let _instance = null;
export function getBrowser(config) {
  if (!_instance) _instance = new BrowserManager(config);
  return _instance;
}

export async function closeBrowser() {
  if (_instance) {
    await _instance.close();
    _instance = null;
  }
}
