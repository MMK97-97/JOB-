import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable stealth plugin
puppeteer.use(StealthPlugin());

export class BrowserManager {
  constructor(options = {}) {
    const defaultChrome = process.platform === 'linux'
      ? '/usr/bin/google-chrome'
      : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

    this.options = {
      headless: process.env.HEADLESS === 'true' ? true : (options.headless ?? false),
      slowMo: options.slowMo ?? 50,
      userDataDir: options.userDataDir || path.resolve(__dirname, '../data/chrome-profile'),
      chromePath: process.env.CHROME_PATH || options.chromePath || defaultChrome,
      ...options
    };
    this.browser = null;
    this.activePage = null;
  }

  async launch() {
    if (this.browser) return this.browser;

    // Ensure user data dir exists
    if (!fs.existsSync(this.options.userDataDir)) {
      fs.mkdirSync(this.options.userDataDir, { recursive: true });
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,900',
      '--start-maximized',
      '--lang=en-US,en'
    ];

    try {
      this.browser = await puppeteer.launch({
        headless: this.options.headless ? 'new' : false,
        executablePath: this.options.chromePath,
        userDataDir: this.options.userDataDir,
        args: launchArgs,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation']
      });

      const pages = await this.browser.pages();
      this.activePage = pages.length > 0 ? pages[0] : await this.browser.newPage();

      // Configure viewport & realistic User Agent
      await this.activePage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      );

      // Clean webdriver flags and auto-kill beforeunload popups ("Leave site? Changes you made may not be saved")
      await this.activePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {} };
        window.onbeforeunload = null;
        window.addEventListener('beforeunload', (e) => {
          e.stopImmediatePropagation();
        }, true);
      });

      // Auto-accept any browser dialogs so navigations never hang or prompt modal
      this.activePage.on('dialog', async dialog => {
        try {
          console.log(`[BROWSER DIALOG] Auto-handling modal: ${dialog.type()} "${dialog.message()}"`);
          await dialog.accept();
        } catch (e) {}
      });

      // Listen for popup tabs/windows and attach handlers immediately
      this.browser.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) {
            p.on('dialog', async dialog => {
              try { await dialog.accept(); } catch (e) {}
            });
            await p.evaluateOnNewDocument(() => {
              window.onbeforeunload = null;
              window.addEventListener('beforeunload', (e) => {
                e.stopImmediatePropagation();
              }, true);
            }).catch(() => {});
          }
        } catch (e) {}
      });

      return this.browser;
    } catch (err) {
      console.error('Failed to launch browser with Chrome executable. Falling back to default Chromium...', err.message);
      // Fallback without executablePath if path fails
      this.browser = await puppeteer.launch({
        headless: this.options.headless ? 'new' : false,
        userDataDir: this.options.userDataDir,
        args: launchArgs,
        defaultViewport: null
      });
      const pages = await this.browser.pages();
      this.activePage = pages.length > 0 ? pages[0] : await this.browser.newPage();

      // Auto-accept any browser dialogs (e.g., "Leave site?") so navigations never hang
      this.activePage.on('dialog', async dialog => {
        try { await dialog.accept(); } catch (e) {}
      });

      this.browser.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) {
            p.on('dialog', async dialog => {
              try { await dialog.accept(); } catch (e) {}
            });
          }
        } catch (e) {}
      });

      return this.browser;
    }
  }

  _resolvePage(pageOrFrame) {
    const raw = pageOrFrame || this.activePage;
    if (!raw) return null;
    if (typeof raw.page === 'function') {
      return raw.page(); // Frame -> Page
    }
    return raw;
  }

  async dismissBeforeUnload(pageOrFrame) {
    try {
      const page = this._resolvePage(pageOrFrame);
      if (page && !page.isClosed()) {
        await page.evaluate(() => {
          window.onbeforeunload = null;
        }).catch(() => {});
      }
    } catch (e) {}
  }

  async getPage() {
    if (!this.browser) await this.launch();
    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.browser.newPage();
      this.activePage.on('dialog', async dialog => {
        try { await dialog.accept(); } catch (e) {}
      });
    }
    return this.activePage;
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.activePage = null;
    }
  }

  /**
   * Human-like smooth mouse movement with curved trajectory
   */
  async humanMouseMove(targetX, targetY, page = null) {
    const targetPage = this._resolvePage(page);
    if (!targetPage || !targetPage.mouse) return;
    try {
      const steps = Math.floor(Math.random() * 8) + 12;
      for (let i = 1; i <= steps; i++) {
        const jitterX = (Math.random() - 0.5) * 4;
        const jitterY = (Math.random() - 0.5) * 4;
        await targetPage.mouse.move(targetX + jitterX, targetY + jitterY).catch(() => {});
        await this.delay(Math.floor(Math.random() * 15) + 10);
      }
    } catch (e) {}
  }

  /**
   * Human-like natural smooth scrolling
   */
  async humanScroll(amount = 400, page = null) {
    const target = page || this.activePage;
    if (!target) return;
    try {
      const slices = Math.floor(Math.random() * 4) + 5;
      const sliceDelta = amount / slices;
      for (let i = 0; i < slices; i++) {
        await target.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), sliceDelta).catch(() => {});
        await this.delay(Math.floor(Math.random() * 120) + 100);
      }
    } catch (e) {}
  }

  /**
   * Human-like typing with variable cadence and natural pauses
   */
  async humanType(selectorOrEl, text, page = null) {
    const targetPage = this._resolvePage(page);
    const ctx = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await ctx.$(selectorOrEl) : selectorOrEl;
    if (!element) return;

    try {
      await element.scrollIntoViewIfNeeded().catch(() => {});
      const box = await element.boundingBox().catch(() => null);
      if (box && targetPage && targetPage.mouse) {
        await this.humanMouseMove(box.x + box.width / 2, box.y + box.height / 2, targetPage).catch(() => {});
      }
    } catch (e) {}

    let typed = false;
    try {
      await element.focus().catch(() => {});
      await element.click({ clickCount: 3 }).catch(() => {});
      if (targetPage && targetPage.keyboard) {
        await targetPage.keyboard.press('Backspace').catch(() => {});
      }
      await this.delay(100);

      if (targetPage && targetPage.keyboard) {
        for (let i = 0; i < text.length; i++) {
          const char = text[i];
          let delay = Math.floor(Math.random() * 45) + 25;
          if (char === ' ' || char === ',' || char === '.') delay += 100;
          await targetPage.keyboard.type(char, { delay }).catch(() => {});
        }
        typed = true;
      }
    } catch (err) {}

    // Fallback: direct DOM value set with standard events
    if (!typed) {
      try {
        await element.evaluate((el, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, text).catch(() => {});
      } catch (e) {}
    }

    await this.delay(Math.floor(Math.random() * 200) + 150);
  }

  /**
   * Human-like click with natural hover, trajectory, and DOM fallback
   */
  async humanClick(selectorOrEl, page = null) {
    const targetPage = this._resolvePage(page);
    const ctx = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await ctx.$(selectorOrEl) : selectorOrEl;
    if (!element) return false;

    try {
      await element.scrollIntoViewIfNeeded().catch(() => {});
      const box = await element.boundingBox().catch(() => null);
      if (box && targetPage && targetPage.mouse) {
        const offsetX = box.x + box.width * (0.35 + Math.random() * 0.3);
        const offsetY = box.y + box.height * (0.35 + Math.random() * 0.3);
        await this.humanMouseMove(offsetX, offsetY, targetPage).catch(() => {});
        await this.delay(Math.floor(Math.random() * 120) + 80);
      }
    } catch (e) {}

    let clicked = false;
    try {
      await element.click();
      clicked = true;
    } catch (clickErr) {
      // DOM direct click fallback - handles iframes, obscured elements, animations
      try {
        await element.evaluate(el => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();
          el.click();
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        });
        clicked = true;
      } catch (evalErr) {}
    }

    await this.delay(Math.floor(Math.random() * 250) + 150);
    return clicked;
  }

  async humanPause(min = 1200, max = 2600) {
    const duration = Math.floor(Math.random() * (max - min)) + min;
    await this.delay(duration);
  }

  async takeScreenshot(name = 'action') {
    if (!this.activePage) return null;
    const screenshotDir = path.resolve(__dirname, '../data/screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const filename = `${name}-${Date.now()}.png`;
    const fullPath = path.join(screenshotDir, filename);
    await this.activePage.screenshot({ path: fullPath, fullPage: false });
    return fullPath;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
