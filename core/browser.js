import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable stealth plugin
puppeteer.use(StealthPlugin());

// QWERTY keyboard proximity map for authentic human typo & self-correction emulation
const QWERTY_NEIGHBORS = {
  q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'ol',
  a: 'qwsz', s: 'awedxz', d: 'serfcx', f: 'drtgvc', g: 'ftyhbv', h: 'gyujnb', j: 'huikmn', k: 'jiolm', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk'
};

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
      '--window-size=1920,1080',
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

      // Set clean hardware specs (never monkey-patch EventTarget or addEventListener)
      await this.activePage.evaluateOnNewDocument(() => {
        try {
          delete Object.getPrototypeOf(navigator).webdriver;
        } catch (e) {}
        try {
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
          Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        } catch (e) {}
      });

      attachSafeDialogHandler(this.activePage);

      // Listen for popup tabs/windows and attach handlers immediately
      this.browser.on('targetcreated', async target => {
        try {
          const p = await target.page();
          if (p) {
            attachSafeDialogHandler(p);
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
   * Inject a visual human-like cursor overlay so the user can see natural cursor motion
   * Uses Shadow DOM and CustomEvent to avoid polluting window properties or global DOM identifiers
   */
  async injectHumanCursor(pageOrFrame) {
    try {
      const page = this._resolvePage(pageOrFrame);
      if (!page || page.isClosed()) return;
      await page.evaluate(() => {
        if (document.getElementById('__hc_host__')) return;
        const host = document.createElement('div');
        host.id = '__hc_host__';
        host.style.position = 'fixed';
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '0';
        host.style.height = '0';
        host.style.pointerEvents = 'none';
        host.style.zIndex = '2147483647';

        const shadow = host.attachShadow({ mode: 'open' });

        const cursor = document.createElement('div');
        cursor.style.position = 'fixed';
        cursor.style.top = '0';
        cursor.style.left = '0';
        cursor.style.width = '18px';
        cursor.style.height = '18px';
        cursor.style.borderRadius = '50%';
        cursor.style.backgroundColor = 'rgba(59, 130, 246, 0.75)';
        cursor.style.border = '2px solid rgba(255, 255, 255, 0.95)';
        cursor.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.8), 0 2px 6px rgba(0,0,0,0.35)';
        cursor.style.pointerEvents = 'none';
        cursor.style.transition = 'transform 0.05s ease-out, opacity 0.2s';
        cursor.style.transform = 'translate(350px, 350px)';
        cursor.style.display = 'block';

        const dot = document.createElement('div');
        dot.style.position = 'absolute';
        dot.style.top = '5px';
        dot.style.left = '5px';
        dot.style.width = '4px';
        dot.style.height = '4px';
        dot.style.borderRadius = '50%';
        dot.style.backgroundColor = '#ffffff';
        cursor.appendChild(dot);
        shadow.appendChild(cursor);

        const style = document.createElement('style');
        style.textContent = `
          @keyframes __cursor_ripple {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(2.2); opacity: 0; }
          }
        `;
        shadow.appendChild(style);

        document.documentElement.appendChild(host);

        window.addEventListener('__cur_tick__', (e) => {
          const detail = e.detail;
          if (!detail) return;
          const { x, y, isClick } = detail;
          if (x === undefined || y === undefined) return;
          cursor.style.transform = `translate(${x - 9}px, ${y - 9}px) scale(${isClick ? 0.75 : 1})`;
          if (isClick) {
            const ripple = document.createElement('div');
            ripple.style.position = 'fixed';
            ripple.style.top = `${y - 14}px`;
            ripple.style.left = `${x - 14}px`;
            ripple.style.width = '28px';
            ripple.style.height = '28px';
            ripple.style.borderRadius = '50%';
            ripple.style.border = '2px solid rgba(59, 130, 246, 0.9)';
            ripple.style.pointerEvents = 'none';
            ripple.style.animation = '__cursor_ripple 0.4s ease-out forwards';
            shadow.appendChild(ripple);
            setTimeout(() => ripple.remove(), 400);
          }
        });
      }).catch(() => {});
    } catch (e) {}
  }

  /**
   * Human-like smooth mouse movement with cubic Bézier curve physics, Fitts's law overshoot,
   * biological micro-tremor, and deceleration
   */
  async humanMouseMove(targetX, targetY, page = null, allowOvershoot = true) {
    const targetPage = this._resolvePage(page);
    if (!targetPage || !targetPage.mouse) return;
    try {
      await this.injectHumanCursor(targetPage).catch(() => {});
      const startX = this.cursorPos.x;
      const startY = this.cursorPos.y;
      const distance = Math.hypot(targetX - startX, targetY - startY);
      if (distance < 2) return;

      // Fitts's Law: For larger distances (>110px), humans naturally overshoot slightly and pull back
      let overshootX = null;
      let overshootY = null;

      if (allowOvershoot && distance > 110 && Math.random() < 0.72) {
        const angle = Math.atan2(targetY - startY, targetX - startX);
        const overshootMag = Math.min(13, distance * 0.035);
        overshootX = targetX + Math.cos(angle) * overshootMag + (Math.random() - 0.5) * 4;
        overshootY = targetY + Math.sin(angle) * overshootMag + (Math.random() - 0.5) * 4;
      }

      const primaryDestX = overshootX !== null ? overshootX : targetX;
      const primaryDestY = overshootY !== null ? overshootY : targetY;

      const steps = Math.max(12, Math.min(36, Math.floor(distance / 18)));

      // Randomized natural deflection control points for cubic Bézier trajectory
      const cp1X = startX + (primaryDestX - startX) * 0.25 + (Math.random() - 0.5) * (distance * 0.18);
      const cp1Y = startY + (primaryDestY - startY) * 0.25 + (Math.random() - 0.5) * (distance * 0.18);
      const cp2X = startX + (primaryDestX - startX) * 0.75 + (Math.random() - 0.5) * (distance * 0.12);
      const cp2Y = startY + (primaryDestY - startY) * 0.75 + (Math.random() - 0.5) * (distance * 0.12);

      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // Cubic Bézier calculation
        let cx = Math.pow(1 - t, 3) * startX +
                 3 * Math.pow(1 - t, 2) * t * cp1X +
                 3 * (1 - t) * Math.pow(t, 2) * cp2X +
                 Math.pow(t, 3) * primaryDestX;
        let cy = Math.pow(1 - t, 3) * startY +
                 3 * Math.pow(1 - t, 2) * t * cp1Y +
                 3 * (1 - t) * Math.pow(t, 2) * cp2Y +
                 Math.pow(t, 3) * primaryDestY;

        // Subtle biological tremor (micro-jitter) in mid-flight
        if (t > 0.12 && t < 0.88) {
          cx += (Math.random() - 0.5) * 1.6;
          cy += (Math.random() - 0.5) * 1.6;
        }

        await targetPage.mouse.move(cx, cy).catch(() => {});
        targetPage.evaluate((detail) => {
          window.dispatchEvent(new CustomEvent('__cur_tick__', { detail }));
        }, { x: cx, y: cy, isClick: false }).catch(() => {});

        this.cursorPos = { x: cx, y: cy };
        // Ease-out deceleration curve
        const delay = Math.floor(6 + Math.pow(t, 1.8) * 10);
        await this.delay(delay);
      }

      // If overshot, execute rapid 3-step neuromuscular correction back into target
      if (overshootX !== null) {
        await this.delay(Math.floor(Math.random() * 30) + 25);
        const corrSteps = 4;
        for (let j = 1; j <= corrSteps; j++) {
          const ct = j / corrSteps;
          const ccx = overshootX + (targetX - overshootX) * ct;
          const ccy = overshootY + (targetY - overshootY) * ct;
          await targetPage.mouse.move(ccx, ccy).catch(() => {});
          targetPage.evaluate((detail) => {
            window.dispatchEvent(new CustomEvent('__cur_tick__', { detail }));
          }, { x: ccx, y: ccy, isClick: false }).catch(() => {});
          this.cursorPos = { x: ccx, y: ccy };
          await this.delay(12);
        }
      }

      this.cursorPos = { x: targetX, y: targetY };
      await targetPage.mouse.move(targetX, targetY).catch(() => {});
      targetPage.evaluate((detail) => {
        window.dispatchEvent(new CustomEvent('__cur_tick__', { detail }));
      }, { x: targetX, y: targetY, isClick: false }).catch(() => {});
    } catch (e) {}
  }

  /**
   * Human-like natural smooth scrolling with physical mouse wheel dispatch and momentum
   */
  async humanScroll(amount = 400, page = null) {
    const target = this._resolvePage(page);
    if (!target) return;
    try {
      const slices = Math.floor(Math.random() * 4) + 6;
      const sliceDelta = amount / slices;
      for (let i = 0; i < slices; i++) {
        if (target.mouse && typeof target.mouse.wheel === 'function') {
          await target.mouse.wheel({ deltaY: sliceDelta }).catch(() => {});
        }
        await target.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), sliceDelta).catch(() => {});
        await this.delay(Math.floor(Math.random() * 90) + 60);
      }
      // 18% probability of a brief human counter-scroll (re-skimming text)
      if (Math.random() < 0.18 && Math.abs(amount) > 200) {
        const backDelta = amount > 0 ? -85 : 85;
        await this.delay(180);
        if (target.mouse && typeof target.mouse.wheel === 'function') {
          await target.mouse.wheel({ deltaY: backDelta }).catch(() => {});
        }
        await target.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), backDelta).catch(() => {});
        await this.delay(220);
      }
    } catch (e) {}
  }

  /**
   * Natural cursor fidget (idle human movement while reading or waiting)
   */
  async randomFidget(page = null) {
    const targetPage = this._resolvePage(page);
    if (!targetPage || !targetPage.mouse) return;
    try {
      const deltaX = (Math.random() - 0.5) * 80;
      const deltaY = (Math.random() - 0.5) * 50;
      const targetX = Math.max(60, Math.min(1180, this.cursorPos.x + deltaX));
      const targetY = Math.max(60, Math.min(820, this.cursorPos.y + deltaY));
      await this.humanMouseMove(targetX, targetY, targetPage, false);
    } catch (e) {}
  }

  /**
   * Human-like reading and skimming behavior with realistic pauses
   */
  async humanSkim(page = null, durationMs = 2200) {
    const targetPage = this._resolvePage(page);
    if (!targetPage) return;
    try {
      await this.humanScroll(Math.floor(Math.random() * 200) + 150, targetPage);
      await this.delay(Math.floor(durationMs * 0.45));
      await this.randomFidget(targetPage);
      await this.delay(Math.floor(durationMs * 0.55));
    } catch (e) {}
  }

  /**
   * Authentic eye-tracking and job reading emulation before applying
   */
  async humanReadJobPosting(page, jobTitle = '') {
    const targetPage = this._resolvePage(page);
    if (!targetPage) return;
    try {
      await this.injectHumanCursor(targetPage).catch(() => {});
      // 1. Initial glance at job title / compensation at top of page (700-1100ms)
      await this.delay(Math.floor(Math.random() * 400) + 700);

      const titleEl = await targetPage.$('h1, h2.jobTitle, .jobs-unified-top-card__job-title').catch(() => null);
      if (titleEl) {
        const box = await titleEl.boundingBox().catch(() => null);
        if (box) {
          const glanceX = box.x + box.width * (0.3 + Math.random() * 0.3);
          const glanceY = box.y + box.height * 0.5;
          await this.humanMouseMove(glanceX, glanceY, targetPage, false);
          await this.delay(Math.floor(Math.random() * 350) + 400);
        }
      }

      // 2. Smooth physical scroll down into responsibilities
      await this.humanScroll(Math.floor(Math.random() * 120) + 320, targetPage);
      await this.delay(Math.floor(Math.random() * 600) + 800);

      // 3. Natural reading gaze hover near requirements
      await this.randomFidget(targetPage);
      await this.humanScroll(Math.floor(Math.random() * 100) + 250, targetPage);
      await this.delay(Math.floor(Math.random() * 800) + 1200);

      // 4. Smooth scroll back up to the apply button
      await this.humanScroll(-500, targetPage);
      await this.delay(Math.floor(Math.random() * 300) + 400);
    } catch (e) {}
  }

  /**
   * Human-like typing with variable cadence, authentic typo & self-correction, burst rhythm, and controlled React synchronization
   */
  async humanType(selectorOrEl, text, page = null) {
    const targetPage = this._resolvePage(page);
    const ctx = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await ctx.$(selectorOrEl) : selectorOrEl;
    if (!element) return;

    try {
      await this.injectHumanCursor(targetPage).catch(() => {});
      await element.scrollIntoViewIfNeeded().catch(() => {});
      const box = await element.boundingBox().catch(() => null);
      if (box && targetPage && targetPage.mouse) {
        const offsetX = box.x + box.width * (0.25 + Math.random() * 0.35);
        const offsetY = box.y + box.height * (0.35 + Math.random() * 0.3);
        await this.humanMouseMove(offsetX, offsetY, targetPage);
        await this.delay(Math.floor(Math.random() * 80) + 40);
        await targetPage.mouse.click(offsetX, offsetY).catch(() => {});
      }
    } catch (e) {}

    let typed = false;
    try {
      await element.focus().catch(() => {});
      if (targetPage && targetPage.keyboard) {
        // Clear existing content humanly
        await targetPage.keyboard.down('Control').catch(() => {});
        await targetPage.keyboard.press('KeyA').catch(() => {});
        await targetPage.keyboard.up('Control').catch(() => {});
        await targetPage.keyboard.press('Backspace').catch(() => {});
      }
      await this.delay(80);

      if (targetPage && targetPage.keyboard) {
        const strVal = String(text);
        if (strVal.length <= 40) {
          // Short answers (numbers, Yes/No): realistic human keystroke intervals with occasional typo fix
          for (let i = 0; i < strVal.length; i++) {
            const char = strVal[i];
            const lowerChar = char.toLowerCase();

            // 2.5% chance of realistic typo on alphabetic letters in words
            if (strVal.length > 8 && QWERTY_NEIGHBORS[lowerChar] && Math.random() < 0.025) {
              const neighbors = QWERTY_NEIGHBORS[lowerChar];
              const wrongChar = neighbors[Math.floor(Math.random() * neighbors.length)];
              await targetPage.keyboard.type(wrongChar, { delay: 40 }).catch(() => {});
              // Cognitive realization pause
              await this.delay(Math.floor(Math.random() * 80) + 140);
              await targetPage.keyboard.press('Backspace').catch(() => {});
              await this.delay(65);
            }

            let delay = Math.floor(Math.random() * 40) + 28;
            if (char === ' ' || char === ',' || char === '.') delay += 90;
            await targetPage.keyboard.type(char, { delay }).catch(() => {});
          }
        } else {
          // Long statements / cover letters: human burst typing
          const chunks = strVal.match(/.{1,4}/g) || [strVal];
          for (const chunk of chunks) {
            await targetPage.keyboard.type(chunk, { delay: Math.floor(Math.random() * 18) + 14 }).catch(() => {});
            if (chunk.includes(' ') || chunk.includes('.')) {
              await this.delay(Math.floor(Math.random() * 55) + 30);
            }
          }
        }
        typed = true;
      }
    } catch (err) {}

    // Synchronize React state descriptors to ensure inputs never desync
    try {
      await element.evaluate((el, val) => {
        const setter = Object.getOwnPropertyDescriptor(
          el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
          'value'
        )?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, String(text)).catch(() => {});
    } catch (e) {}

    await this.delay(Math.floor(Math.random() * 180) + 120);
  }

  /**
   * Human-like click with off-center targeting, natural hesitation, physical down/up hold, and visual ripple
   */
  async humanClick(selectorOrEl, page = null) {
    const targetPage = this._resolvePage(page);
    const ctx = page || this.activePage;
    let element = typeof selectorOrEl === 'string' ? await ctx.$(selectorOrEl) : selectorOrEl;
    if (!element) return false;

    try {
      await this.injectHumanCursor(targetPage).catch(() => {});
      await element.scrollIntoViewIfNeeded().catch(() => {});
      const box = await element.boundingBox().catch(() => null);
      if (box && targetPage && targetPage.mouse) {
        // Natural off-center targeting
        const offsetX = box.x + box.width * (0.35 + Math.random() * 0.3);
        const offsetY = box.y + box.height * (0.35 + Math.random() * 0.3);
        await this.humanMouseMove(offsetX, offsetY, targetPage).catch(() => {});
        // Pre-click hesitation
        await this.delay(Math.floor(Math.random() * 90) + 50);

        // Visual click effect
        targetPage.evaluate((detail) => {
          window.dispatchEvent(new CustomEvent('__cur_tick__', { detail }));
        }, { x: offsetX, y: offsetY, isClick: true }).catch(() => {});

        // Physical mouse down & hold & up
        await targetPage.mouse.down().catch(() => {});
        await this.delay(Math.floor(Math.random() * 50) + 45);
        await targetPage.mouse.up().catch(() => {});
        await this.delay(Math.floor(Math.random() * 160) + 90);
        return true;
      }
    } catch (e) {}

    // Fallback direct DOM click
    try {
      await element.evaluate(el => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        el.click();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      });
      return true;
    } catch (evalErr) {}

    return false;
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
