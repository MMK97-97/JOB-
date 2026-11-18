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
    this.cursorPos = { x: 350, y: 350 };
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

      // Helper to attach safe dialog handler
      const attachSafeDialogHandler = (targetPage) => {
        targetPage.on('dialog', async dialog => {
          try {
            const type = dialog.type();
            console.log(`[BROWSER DIALOG] Modal intercepted: ${type} "${dialog.message()}"`);
            if (type === 'beforeunload') {
              // Crucial: Dismiss beforeunload to STAY on the application page!
              // Calling accept() instructs Chrome to discard and leave the application form.
              await dialog.dismiss();
            } else {
              await dialog.accept();
            }
          } catch (e) {}
        });
      };

      // Clean webdriver flags and auto-kill beforeunload popups ("Leave site? Changes you made may not be saved")
      await this.activePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = {
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        };
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        try {
          Object.defineProperty(window, 'onbeforeunload', {
            get: () => null,
            set: () => {}
          });
          const originalAEL = EventTarget.prototype.addEventListener;
          EventTarget.prototype.addEventListener = function(type, listener, options) {
            if (type === 'beforeunload' || type === 'unload') return;
            return originalAEL.apply(this, arguments);
          };
        } catch (e) {}
      });

      attachSafeDialogHandler(this.activePage);

      // Listen for popup tabs/windows and attach handlers immediately
      this.browser.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) {
            attachSafeDialogHandler(p);
            await p.evaluateOnNewDocument(() => {
              try {
                Object.defineProperty(window, 'onbeforeunload', {
                  get: () => null,
                  set: () => {}
                });
                const originalAEL = EventTarget.prototype.addEventListener;
                EventTarget.prototype.addEventListener = function(type, listener, options) {
                  if (type === 'beforeunload' || type === 'unload') return;
                  return originalAEL.apply(this, arguments);
                };
              } catch (e) {}
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

      const attachSafeDialog = (p) => {
        p.on('dialog', async dialog => {
          try {
            if (dialog.type() === 'beforeunload') {
              await dialog.dismiss();
            } else {
              await dialog.accept();
            }
          } catch (e) {}
        });
      };

      attachSafeDialog(this.activePage);

      this.browser.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) attachSafeDialog(p);
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
          try {
            window.onbeforeunload = null;
            if (window.EventTarget && window.EventTarget.prototype) {
              const originalAEL = window.EventTarget.prototype.addEventListener;
              window.EventTarget.prototype.addEventListener = function(type, listener, options) {
                if (type === 'beforeunload' || type === 'unload') return;
                return originalAEL.apply(this, arguments);
              };
            }
          } catch (e) {}
        }).catch(() => {});
      }
    } catch (e) {}
  }

  async getPage() {
    if (!this.browser) await this.launch();
    if (!this.activePage || this.activePage.isClosed()) {
      const pages = await this.browser.pages().catch(() => []);
      const openPage = pages.find(p => p && !p.isClosed());
      if (openPage) {
        this.activePage = openPage;
      } else {
        this.activePage = await this.browser.newPage();
        this.activePage.on('dialog', async dialog => {
          try {
            if (dialog.type() === 'beforeunload') await dialog.dismiss();
            else await dialog.accept();
          } catch (e) {}
        });
      }
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
   * Human-like smooth mouse movement with cubic Bézier curve physics and deceleration
   */
  async humanMouseMove(targetX, targetY, page = null) {
    const targetPage = this._resolvePage(page);
    if (!targetPage || !targetPage.mouse) return;
    try {
      const startX = this.cursorPos.x;
      const startY = this.cursorPos.y;
      const distance = Math.hypot(targetX - startX, targetY - startY);
      const steps = Math.max(10, Math.min(32, Math.floor(distance / 22)));

      // Randomized natural deflection control points for cubic Bézier trajectory
      const cp1X = startX + (targetX - startX) * 0.25 + (Math.random() - 0.5) * (distance * 0.18);
      const cp1Y = startY + (targetY - startY) * 0.25 + (Math.random() - 0.5) * (distance * 0.18);
      const cp2X = startX + (targetX - startX) * 0.75 + (Math.random() - 0.5) * (distance * 0.12);
      const cp2Y = startY + (targetY - startY) * 0.75 + (Math.random() - 0.5) * (distance * 0.12);

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // Cubic Bézier calculation
        const cx = Math.pow(1 - t, 3) * startX +
                   3 * Math.pow(1 - t, 2) * t * cp1X +
                   3 * (1 - t) * Math.pow(t, 2) * cp2X +
                   Math.pow(t, 3) * targetX;
        const cy = Math.pow(1 - t, 3) * startY +
                   3 * Math.pow(1 - t, 2) * t * cp1Y +
                   3 * (1 - t) * Math.pow(t, 2) * cp2Y +
                   Math.pow(t, 3) * targetY;

        await targetPage.mouse.move(cx, cy).catch(() => {});
        this.cursorPos = { x: cx, y: cy };
        // Human deceleration curve (ease-out as reaching target)
        const delay = Math.floor(8 + Math.pow(t, 1.8) * 12);
        await this.delay(delay);
      }
      this.cursorPos = { x: targetX, y: targetY };
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

  async takeScreenshot(name = 'action', targetPage = null) {
    try {
      if (!this.browser) return null;
      let page = targetPage || this.activePage;

      // If page is null or closed, attempt to locate an open page
      if (!page || page.isClosed()) {
        const pages = await this.browser.pages().catch(() => []);
        page = pages.find(p => p && !p.isClosed()) || null;
        if (page) this.activePage = page;
      }

      if (!page || page.isClosed()) return null;

      const screenshotDir = path.resolve(__dirname, '../data/screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const filename = `${name}-${Date.now()}.png`;
      const fullPath = path.join(screenshotDir, filename);

      await page.screenshot({ path: fullPath, fullPage: false }).catch(() => null);
      return fs.existsSync(fullPath) ? fullPath : null;
    } catch (e) {
      // Never crash the agent when capturing a screenshot
      return null;
    }
  }

  registerAgent(agent) {
    this.agent = agent;
  }

  delay(ms) {
    if (!this.agent) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
    return new Promise(resolve => {
      const start = Date.now();
      const interval = setInterval(() => {
        // Immediate breakout if agent has been stopped
        if (this.agent && !this.agent.isRunning) {
          clearInterval(interval);
          resolve();
          return;
        }
        // If agent is paused, hold without consuming elapsed time
        if (this.agent && this.agent.isPaused) {
          return;
        }
        if (Date.now() - start >= ms) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }
}
