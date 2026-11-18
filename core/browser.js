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

      // Clean webdriver flags
      await this.activePage.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.navigator.chrome = { runtime: {} };
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
      return this.browser;
    }
  }

  async getPage() {
    if (!this.browser) await this.launch();
    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.browser.newPage();
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
    const targetPage = page || this.activePage;
    // Current mouse position estimate
    const steps = Math.floor(Math.random() * 8) + 12;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      // Curved easing with random micro-deviations
      const jitterX = (Math.random() - 0.5) * 4;
      const jitterY = (Math.random() - 0.5) * 4;
      await targetPage.mouse.move(targetX + jitterX, targetY + jitterY);
      await this.delay(Math.floor(Math.random() * 15) + 10);
    }
  }

  /**
   * Human-like natural smooth scrolling
   */
  async humanScroll(amount = 400, page = null) {
    const targetPage = page || this.activePage;
    const slices = Math.floor(Math.random() * 4) + 5;
    const sliceDelta = amount / slices;
    for (let i = 0; i < slices; i++) {
      await targetPage.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), sliceDelta);
      await this.delay(Math.floor(Math.random() * 120) + 100);
    }
  }

  /**
   * Human-like typing with variable cadence and natural pauses
   */
  async humanType(selectorOrEl, text, page = null) {
    const targetPage = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await targetPage.$(selectorOrEl) : selectorOrEl;
    if (!element) return;

    await element.scrollIntoViewIfNeeded().catch(() => {});
    const box = await element.boundingBox();
    if (box) {
      await this.humanMouseMove(box.x + box.width / 2, box.y + box.height / 2, targetPage);
    }

    await element.click({ clickCount: 3 }).catch(() => {});
    await targetPage.keyboard.press('Backspace');
    await this.delay(100);

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      // Random typing cadence
      let delay = Math.floor(Math.random() * 55) + 35;
      if (char === ' ' || char === ',' || char === '.') delay += 120; // natural punctuation pause
      await targetPage.keyboard.type(char, { delay });
    }
    await this.delay(Math.floor(Math.random() * 200) + 150);
  }

  /**
   * Human-like click with natural hover and trajectory
   */
  async humanClick(selectorOrEl, page = null) {
    const targetPage = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await targetPage.$(selectorOrEl) : selectorOrEl;
    if (!element) return;

    await element.scrollIntoViewIfNeeded().catch(() => {});
    const box = await element.boundingBox();
    if (box) {
      // Natural slight offset from center
      const offsetX = box.x + box.width * (0.35 + Math.random() * 0.3);
      const offsetY = box.y + box.height * (0.35 + Math.random() * 0.3);
      await this.humanMouseMove(offsetX, offsetY, targetPage);
      await this.delay(Math.floor(Math.random() * 150) + 100); // hover pause
    }
    await element.click();
    await this.delay(Math.floor(Math.random() * 300) + 200);
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
