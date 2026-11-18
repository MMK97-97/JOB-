import EventEmitter from 'events';

export class BaseJobProvider extends EventEmitter {
  constructor(name, browserManager, profileManager, tracker, agent = null) {
    super();
    this.name = name;
    this.browserManager = browserManager;
    this.profileManager = profileManager;
    this.tracker = tracker;
    this.agent = agent;
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, provider: this.name, message: msg, type });
    console.log(`[${this.name.toUpperCase()} ${timestamp}] ${msg}`);
  }

  /**
   * Universal CAPTCHA detector and auto-click handler for Google reCAPTCHA, Cloudflare Turnstile, and hCaptcha
   */
  async handleCaptcha(page, ctx = null, job = {}) {
    const targetCtx = ctx || page;
    try {
      const allFrames = page && typeof page.frames === 'function' ? page.frames() : [];
      let detectedType = null;
      let checkboxClicked = false;

      // 1. Google reCAPTCHA v2 / Enterprise
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('recaptcha') && (u.includes('anchor') || u.includes('api2') || u.includes('enterprise'))) {
          detectedType = 'Google reCAPTCHA';
          const anchor = await f.$('#recaptcha-anchor, .recaptcha-checkbox-border, [role="checkbox"]').catch(() => null);
          if (anchor) {
            const isChecked = await f.evaluate(el => el.getAttribute('aria-checked') === 'true').catch(() => false);
            if (!isChecked) {
              this.log('🛡️ Auto-verifying reCAPTCHA "I\'m not a robot" with natural human cursor...');
              await this.browserManager.humanClick(anchor, f);
              checkboxClicked = true;
              await this.browserManager.delay(2000);
            }
          }
        }
      }

      // 2. Cloudflare Turnstile (Physical bounding box targeting on top window)
      const cfIframe = await page.$('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').catch(() => null);
      if (cfIframe) {
        detectedType = 'Cloudflare Turnstile';
        const box = await cfIframe.boundingBox().catch(() => null);
        if (box) {
          // Precise coordinate of the "Verify you are human" checkbox inside the Cloudflare widget:
          // Checkbox is centered vertically (~32px from top) and ~28px from left edge
          const clickX = box.x + 28 + (Math.random() * 4);
          const clickY = box.y + (box.height / 2) + ((Math.random() - 0.5) * 4);
          this.log('🛡️ Cloudflare Turnstile widget located. Clicking checkbox with trusted CDP pointer event...');
          await this.browserManager.humanMouseMove(clickX, clickY, page);
          await this.browserManager.delay(Math.floor(Math.random() * 150) + 150);
          await page.mouse.click(clickX, clickY).catch(() => {});
          checkboxClicked = true;
          await this.browserManager.delay(2500);
        }
      }

      // Also check across frames
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('challenges.cloudflare.com') || u.includes('turnstile')) {
          detectedType = 'Cloudflare Turnstile';
          if (!checkboxClicked) {
            const cfCheckbox = await f.$('input[type="checkbox"], #cf-stage, .ctp-checkbox-label, label, span.mark').catch(() => null);
            if (cfCheckbox) {
              await this.browserManager.humanClick(cfCheckbox, f);
              checkboxClicked = true;
              await this.browserManager.delay(2200);
            }
          }
        }
      }

      // 3. hCaptcha
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('hcaptcha.com')) {
          detectedType = 'hCaptcha';
          const hCheckbox = await f.$('#checkbox, [role="checkbox"], .check').catch(() => null);
          if (hCheckbox) {
            const isChecked = await f.evaluate(el => el.getAttribute('aria-checked') === 'true').catch(() => false);
            if (!isChecked) {
              this.log('🛡️ Auto-verifying hCaptcha checkbox with natural human cursor...');
              await this.browserManager.humanClick(hCheckbox, f);
              checkboxClicked = true;
              await this.browserManager.delay(2000);
            }
          }
        }
      }

      // 4. Main Page / Context Inspection
      if (!detectedType) {
        const mainCheck = await targetCtx.evaluate(() => {
          const body = (document.body ? document.body.innerText : '').toLowerCase();
          const title = (document.title || '').toLowerCase();
          if (document.querySelector('.cf-turnstile, [data-sitekey*="0x4AAAAAA"]')) return 'Cloudflare Turnstile';
          if (document.querySelector('.g-recaptcha, [data-sitekey]')) return 'Google reCAPTCHA';
          if (document.querySelector('.h-captcha')) return 'hCaptcha';
          if (
            title.includes('just a moment') ||
            title.includes('additional verification') ||
            title.includes('security check') ||
            body.includes('verify you are human') ||
            body.includes('additional verification required') ||
            body.includes('ray id') ||
            body.includes('security check') ||
            body.includes('cloudflare')
          ) {
            return 'Cloudflare Security Challenge';
          }
          return null;
        }).catch(() => null);
        if (mainCheck) detectedType = mainCheck;
      }

      return { detected: !!detectedType, type: detectedType, clicked: checkboxClicked };
    } catch (e) {
      return { detected: false, type: null, clicked: false };
    }
  }

  /**
   * Actively waits for human-in-the-loop CAPTCHA puzzle resolution, alerting the user via dashboard
   */
  async waitForCaptchaResolution(page, ctx = null, job = {}, maxWaitSeconds = 120, options = {}) {
    const targetCtx = ctx || page;

    // Detect type first
    const captchaInfo = await this.handleCaptcha(page, targetCtx, job);
    const captchaType = captchaInfo.type || 'Human Verification Challenge';

    this.log(`🛡️ CAPTCHA challenge detected: "${captchaType}". Alerting candidate on dashboard and waiting for completion...`, 'warning');

    // Notify UI dashboard with job details
    this.emit('captcha-challenge', {
      type: captchaType,
      job: { title: job?.title || 'Active Target', company: job?.company || '' },
      maxWaitSeconds
    });

    // Bring browser page into focus so candidate sees the challenge immediately
    await page.evaluate(() => window.focus()).catch(() => {});

    const checkStatus = async () => {
      // 1. Submit button unlocked
      const submitReady = await targetCtx.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]'));
        const sub = btns.find(b => {
          const t = (b.innerText || b.value || '').trim().toLowerCase();
          return t.includes('submit your application') || t.includes('submit application') || t === 'submit';
        });
        return sub && !sub.disabled && sub.getAttribute('aria-disabled') !== 'true';
      }).catch(() => false);

      if (submitReady) return true;

      // 2. Token populated in DOM
      const tokenReady = await targetCtx.evaluate(() => {
        const grecap = document.querySelector('[name="g-recaptcha-response"]');
        if (grecap && grecap.value && grecap.value.length > 5) return true;
        const cfturn = document.querySelector('[name="cf-turnstile-response"]');
        if (cfturn && cfturn.value && cfturn.value.length > 5) return true;
        const hcap = document.querySelector('[name="h-captcha-response"]');
        if (hcap && hcap.value && hcap.value.length > 5) return true;
        return false;
      }).catch(() => false);

      if (tokenReady) return true;

      // 3. Frames checked status
      const allFrames = page && typeof page.frames === 'function' ? page.frames() : [];
      for (const f of allFrames) {
        const checked = await f.evaluate(() => {
          const el = document.querySelector('[role="checkbox"], #recaptcha-anchor, #checkbox');
          return el && (el.getAttribute('aria-checked') === 'true' || el.classList.contains('recaptcha-checkbox-checked'));
        }).catch(() => false);
        if (checked) return true;
      }

      // 4. Challenge screen vanished on navigation/search/apply
      const stillChallenged = await page.evaluate(() => {
        const title = (document.title || '').toLowerCase();
        const body = (document.body ? document.body.innerText : '').toLowerCase();
        return (
          title.includes('just a moment') ||
          title.includes('additional verification') ||
          title.includes('security check') ||
          body.includes('verify you are human') ||
          body.includes('additional verification required') ||
          body.includes('ray id') ||
          body.includes('security check') ||
          document.querySelector('iframe[src*="challenges.cloudflare.com"]') !== null
        );
      }).catch(() => false);

      if (!stillChallenged) {
        return true;
      }

      return false;
    };

    let elapsed = 0;
    let resolved = false;

    while (elapsed < maxWaitSeconds) {
      if (options.isCancelled && options.isCancelled()) {
        this.emit('captcha-resolved', { type: captchaType, success: false });
        return false;
      }

      while (options.isPaused && options.isPaused()) {
        if (options.isCancelled && options.isCancelled()) {
          this.emit('captcha-resolved', { type: captchaType, success: false });
          return false;
        }
        await this.browserManager.delay(500);
      }

      resolved = await checkStatus();
      if (resolved) {
        break;
      }

      // Re-attempt auto-click on checkbox every 6 seconds if not solved yet
      if (Math.round(elapsed) % 6 === 0) {
        await this.handleCaptcha(page, targetCtx, job);
      }

      await this.browserManager.delay(1500);
      elapsed += 1.5;
    }

    this.emit('captcha-resolved', { type: captchaType, success: resolved });

    if (resolved) {
      this.log(`✅ CAPTCHA verification passed! Resuming application automatically...`, 'info');
      await this.browserManager.delay(1500);
      return true;
    } else {
      this.log(`⚠️ CAPTCHA timeout (${maxWaitSeconds}s) reached without verification confirmation.`, 'warning');
      return false;
    }
  }

  async search(query, location, options = {}) {
    throw new Error('search() method must be implemented by subclass');
  }

  async apply(job, options = {}) {
    throw new Error('apply() method must be implemented by subclass');
  }
}
