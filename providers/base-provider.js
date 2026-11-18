import EventEmitter from 'events';
import path from 'path';
import fs from 'fs';

export class BaseJobProvider extends EventEmitter {
  constructor(name, browserManager, profileManager, tracker, agent = null) {
    super();
    this.name = name;
    this.browserManager = browserManager;
    this.profileManager = profileManager;
    this.tracker = tracker;
    this.agent = agent;
    this.userConfirmedCaptcha = false;
  }

  confirmCaptchaResolved() {
    this.userConfirmedCaptcha = true;
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, provider: this.name, message: msg, type });
    console.log(`[${this.name.toUpperCase()} ${timestamp}] ${msg}`);
  }

  /**
   * Universal CAPTCHA detector and auto-click handler for Google reCAPTCHA, Cloudflare Turnstile, hCaptcha, and Picture Challenges
   */
  async handleCaptcha(page, ctx = null, job = {}) {
    const targetCtx = ctx || page;
    try {
      const allFrames = page && typeof page.frames === 'function' ? page.frames() : [];
      let detectedType = null;
      let checkboxClicked = false;
      let instructions = null;
      let isPictureChallenge = false;
      let isTextCaptcha = false;

      // 1. Google reCAPTCHA v2 / Enterprise (Anchor Checkbox & Image Picture Grid)
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('recaptcha')) {
          // Check for picture challenge grid (bframe)
          if (u.includes('bframe') || u.includes('image')) {
            const hasPictureGrid = await f.evaluate(() => {
              const imgSelect = document.querySelector('#rc-imageselect, .rc-imageselect-desc, .rc-imageselect-instructions');
              const text = document.querySelector('.rc-imageselect-desc-wrapper, .rc-imageselect-desc, .rc-imageselect-instructions')?.innerText?.trim() || null;
              return { hasGrid: !!imgSelect, text };
            }).catch(() => null);

            if (hasPictureGrid && hasPictureGrid.hasGrid) {
              detectedType = 'Google reCAPTCHA Picture Puzzle';
              isPictureChallenge = true;
              instructions = hasPictureGrid.text || 'Select all matching images to verify';
            }
          }

          // Check for initial checkbox anchor
          if (u.includes('anchor') || u.includes('api2') || u.includes('enterprise')) {
            if (!detectedType) detectedType = 'Google reCAPTCHA';
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
      }

      // 2. Cloudflare Turnstile (Physical bounding box targeting on top window)
      const cfIframe = await page.$('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]').catch(() => null);
      if (cfIframe) {
        detectedType = 'Cloudflare Turnstile';
        await cfIframe.scrollIntoViewIfNeeded().catch(() => {});
        const box = await cfIframe.boundingBox().catch(() => null);
        if (box) {
          const clickX = box.x + 28 + (Math.random() * 4);
          const clickY = box.y + (box.height / 2) + ((Math.random() - 0.5) * 4);
          this.log('🛡️ Cloudflare Turnstile widget located. Clicking checkbox with trusted CDP pointer event...');
          await this.browserManager.humanMouseMove(clickX, clickY, page);
          await this.browserManager.delay(Math.floor(Math.random() * 150) + 150);
          await page.mouse.click(clickX, clickY).catch(() => {});
          checkboxClicked = true;
          await this.browserManager.delay(2000);
        }
      }

      // Also check across frames for Turnstile
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('challenges.cloudflare.com') || u.includes('turnstile')) {
          detectedType = 'Cloudflare Turnstile';
          const cfCheckbox = await f.$('input[type="checkbox"], #cf-stage, .ctp-checkbox-label, label, span.mark').catch(() => null);
          if (cfCheckbox) {
            const isChecked = await f.evaluate(el => el.getAttribute('aria-checked') === 'true' || el.checked).catch(() => false);
            if (!isChecked) {
              await this.browserManager.humanClick(cfCheckbox, f);
              checkboxClicked = true;
              await this.browserManager.delay(2000);
            }
          }
        }
      }

      // 3. hCaptcha Checkbox & Picture Puzzle Frame
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('hcaptcha.com')) {
          if (u.includes('challenge') || u.includes('frame=challenge')) {
            const hChallenge = await f.evaluate(() => {
              const hasChallenge = !!document.querySelector('.challenge-container, .task-image, .prompt-text');
              const text = document.querySelector('.prompt-text, .challenge-header')?.innerText?.trim() || null;
              return { hasChallenge, text };
            }).catch(() => null);

            if (hChallenge && hChallenge.hasChallenge) {
              detectedType = 'hCaptcha Picture Puzzle';
              isPictureChallenge = true;
              instructions = hChallenge.text || 'Select all matching images to verify';
            }
          }

          if (!detectedType) detectedType = 'hCaptcha';
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

      // 4. Arkose Labs / FunCaptcha Puzzle
      for (const f of allFrames) {
        const u = f.url().toLowerCase();
        if (u.includes('arkoselabs') || u.includes('funcaptcha')) {
          detectedType = 'Arkose Labs Picture Challenge';
          isPictureChallenge = true;
          instructions = 'Solve the image alignment / picture puzzle';
        }
      }

      // 5. Traditional Image/Distorted Text Picture CAPTCHAs in Form
      if (!detectedType) {
        const imgCaptchaInfo = await targetCtx.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img'));
          const captchaImg = imgs.find(img => {
            const src = (img.src || '').toLowerCase();
            const alt = (img.alt || '').toLowerCase();
            const id = (img.id || '').toLowerCase();
            const cls = (img.className || '').toLowerCase();
            return (
              src.includes('captcha') ||
              alt.includes('captcha') ||
              id.includes('captcha') ||
              cls.includes('captcha') ||
              src.includes('securimage') ||
              src.includes('verification_code')
            );
          });

          const captchaInput = document.querySelector(
            'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[name*="security_code" i], input[name*="verification" i]'
          );

          if (captchaImg || captchaInput) {
            return {
              hasImg: !!captchaImg,
              imgSrc: captchaImg ? captchaImg.src : null,
              hasInput: !!captchaInput
            };
          }
          return null;
        }).catch(() => null);

        if (imgCaptchaInfo) {
          detectedType = 'Distorted Text CAPTCHA Picture';
          isPictureChallenge = true;
          isTextCaptcha = true;
          instructions = 'Type the characters shown in the CAPTCHA picture';
        }
      }

      // 6. Main Page / Security Wall Inspection
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

      return {
        detected: !!detectedType,
        type: detectedType,
        clicked: checkboxClicked,
        instructions,
        isPictureChallenge,
        isTextCaptcha
      };
    } catch (e) {
      return { detected: false, type: null, clicked: false, instructions: null, isPictureChallenge: false, isTextCaptcha: false };
    }
  }

  /**
   * Actively waits for human-in-the-loop CAPTCHA puzzle resolution, alerting the user via dashboard with live picture mirroring
   */
  async waitForCaptchaResolution(page, ctx = null, job = {}, maxWaitSeconds = 120, options = {}) {
    const targetCtx = ctx || page;

    // Detect type first
    const captchaInfo = await this.handleCaptcha(page, targetCtx, job);
    const captchaType = captchaInfo.type || 'Human Verification Challenge';

    this.log(`🛡️ CAPTCHA challenge detected: "${captchaType}". Alerting candidate on dashboard and capturing live snapshot...`, 'warning');

    // Take high-resolution screenshot of the challenge
    let screenshotUrl = null;
    const screenshotPath = await this.browserManager.takeScreenshot('captcha-challenge', page);
    if (screenshotPath) {
      const filename = path.basename(screenshotPath);
      screenshotUrl = `/screenshots/${filename}`;
    }

    // Notify UI dashboard with job details, screenshot URL, and instructions
    this.emit('captcha-challenge', {
      type: captchaType,
      job: { title: job?.title || 'Active Target', company: job?.company || '' },
      maxWaitSeconds,
      screenshotUrl,
      instructions: captchaInfo.instructions,
      isPictureChallenge: captchaInfo.isPictureChallenge,
      isTextCaptcha: captchaInfo.isTextCaptcha
    });

    // Bring browser page into focus so candidate sees the challenge immediately
    try {
      if (page && !page.isClosed()) {
        await page.bringToFront().catch(() => {});
        await page.evaluate(() => window.focus()).catch(() => {});
      }
    } catch (e) {}

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

      if (this.userConfirmedCaptcha) {
        this.userConfirmedCaptcha = false;
        resolved = true;
        this.log('Candidate confirmed CAPTCHA resolution on dashboard. Resuming immediately...');
        break;
      }

      resolved = await checkStatus();
      if (resolved) {
        break;
      }

      // Every 4 seconds, refresh snapshot of the CAPTCHA picture and re-attempt auto-click
      if (Math.round(elapsed) > 0 && Math.round(elapsed) % 4 === 0) {
        const updatePath = await this.browserManager.takeScreenshot('captcha-challenge', page);
        if (updatePath) {
          const fn = path.basename(updatePath);
          this.emit('captcha-update', {
            screenshotUrl: `/screenshots/${fn}?t=${Date.now()}`
          });
        }
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
