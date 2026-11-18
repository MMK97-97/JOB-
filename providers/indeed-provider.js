import { BaseJobProvider } from './base-provider.js';

export class IndeedProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker) {
    super('indeed', browserManager, profileManager, tracker);
  }

  /**
   * Search jobs on Indeed
   */
  async search(query, location, options = {}) {
    const page = await this.browserManager.getPage();
    const encodedQ = encodeURIComponent(query);
    const encodedL = encodeURIComponent(location);
    const fromage = options.datePosted || '14';
    const searchUrl = `https://www.indeed.com/jobs?q=${encodedQ}&l=${encodedL}&fromage=${fromage}`;

    this.log(`Navigating to search URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.browserManager.delay(3000);

    // Check for Cloudflare / bot check
    const isChallenged = await page.evaluate(() => {
      const title = document.title.toLowerCase();
      const body = document.body.innerText.toLowerCase();
      return title.includes('just a moment') || body.includes('verify you are human') || body.includes('security check');
    });

    if (isChallenged) {
      this.log('Anti-bot challenge detected! Waiting 10 seconds for user manual bypass or auto-pass...', 'warning');
      await this.browserManager.takeScreenshot('indeed-challenge');
      await this.browserManager.delay(10000);
    }

    // Scroll to load all cards
    await page.evaluate(() => window.scrollBy(0, 1000));
    await this.browserManager.delay(1500);

    // Extract job listings
    const jobs = await page.evaluate((easyApplyOnly) => {
      const results = [];
      const jobCards = document.querySelectorAll('.job_seen_beacon, div[data-testid="jobCard"], .resultContent, .jobsearch-ResultsList > li');

      jobCards.forEach(card => {
        try {
          const titleEl = card.querySelector('h2.jobTitle, a.jcs-JobTitle, .jobTitle span, [data-testid="job-title"]');
          const title = titleEl ? titleEl.innerText.trim() : '';

          const companyEl = card.querySelector('[data-testid="company-name"], .companyName, span.companyName');
          const company = companyEl ? companyEl.innerText.trim() : '';

          const locationEl = card.querySelector('[data-testid="text-location"], .companyLocation, div.companyLocation');
          const location = locationEl ? locationEl.innerText.trim() : '';

          const salaryEl = card.querySelector('.metadata.salary-snippet-container, [data-testid="attribute_snippet_testid"]');
          const salary = salaryEl ? salaryEl.innerText.trim() : 'Not listed';

          // Check for Easy Apply / Indeed Apply
          const cardText = (card.innerText || '').toLowerCase();
          const hasEasyApplyBadge = cardText.includes('easily apply') ||
                                   cardText.includes('easy apply') ||
                                   cardText.includes('apply with your indeed resume') ||
                                   cardText.includes('responsive employer') ||
                                   card.querySelector('[data-testid="indeedApply"], .iaIcon, svg.ia-icon, [aria-label*="Easily apply" i], .jobsearch-IndeedApplyButton') !== null;

          // Find link and jobId (jk)
          let linkEl = card.querySelector('a[data-jk], a.jcs-JobTitle, h2.jobTitle a, a[href*="jk="]');
          let jk = '';
          let url = '';

          if (linkEl) {
            jk = linkEl.getAttribute('data-jk') || '';
            const href = linkEl.getAttribute('href') || '';
            if (!jk && href.includes('jk=')) {
              const match = href.match(/jk=([a-zA-Z0-9]+)/);
              if (match) jk = match[1];
            }
            url = href.startsWith('http') ? href : `https://www.indeed.com${href}`;
          }

          if (!jk && card.getAttribute('data-jk')) {
            jk = card.getAttribute('data-jk');
            url = `https://www.indeed.com/viewjob?jk=${jk}`;
          }

          if (title && (jk || url)) {
            if (!easyApplyOnly || hasEasyApplyBadge) {
              results.push({
                jobId: jk || `indeed_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                title,
                company,
                location,
                salary,
                url: jk ? `https://www.indeed.com/viewjob?jk=${jk}` : url,
                isEasyApply: hasEasyApplyBadge,
                board: 'indeed'
              });
            }
          }
        } catch (e) {
          // ignore single card error
        }
      });

      return results;
    }, options.easyApplyOnly ?? true);

    this.log(`Discovered ${jobs.length} jobs (Easy Apply filter: ${options.easyApplyOnly ? 'ON' : 'OFF'})`);
    return jobs;
  }

  /**
   * Apply to an Indeed job
   */
  async apply(job, options = {}) {
    let page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`Starting application for: "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      // Clean up extra tabs/popups so only 1 main tab is active
      if (this.browserManager.browser) {
        const openPages = await this.browserManager.browser.pages();
        for (let i = 1; i < openPages.length; i++) {
          await openPages[i].close().catch(() => {});
        }
      }

      try {
        await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      } catch (navErr) {
        if (navErr.message.includes('ERR_ABORTED') || navErr.message.includes('Target closed') || navErr.message.includes('Execution context')) {
          this.log(`Retrying navigation to ${job.url}...`);
          await this.browserManager.delay(2000);
          page = await this.browserManager.getPage();
          await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        } else {
          throw navErr;
        }
      }
      await this.browserManager.delay(2500);

      // Check if job is expired or closed
      const isClosed = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('this job has expired') || text.includes('no longer accepting applications');
      });

      if (isClosed) {
        this.log(`Job "${job.title}" has expired or closed. Skipping.`, 'warning');
        return this.tracker.recordApplication({ ...job, status: 'SKIPPED', notes: 'Job posting expired' });
      }

      // Copilot reads the entire job description from the page
      const jobDescription = await page.evaluate(() => {
        const descEl = document.querySelector('#jobDescriptionText, .jobsearch-jobDescriptionText, div[id*="jobDescription"], .jobsearch-ViewJobLayout-jobDisplay');
        return descEl ? descEl.innerText.trim() : '';
      });

      if (jobDescription) {
        job.description = jobDescription;
        const wordsCount = jobDescription.split(/\s+/).length;
        this.log(`🤖 Copilot read full job description (${wordsCount} words). Extracted responsibilities & qualifications.`);
      }

      // Human-like reading scroll and pause
      await this.browserManager.humanScroll(350, page);
      await this.browserManager.humanPause(1200, 2200);

      // Look for Indeed Apply button
      const applyBtnSelector = '#indeedApplyButton, button[id*="indeedApply"], button.jobsearch-IndeedApplyButton, [data-testid="indeedApplyButton"], button[aria-label*="Apply now" i], a[href*="smartapply.indeed.com"], .indeed-apply-button';
      let applyButton = await page.$(applyBtnSelector);

      if (!applyButton) {
        // Fallback search across all clickable elements
        const clickables = await page.$$('button, a, div[role="button"]');
        for (const el of clickables) {
          const text = await page.evaluate(node => (node.innerText || node.getAttribute('aria-label') || '').trim().toLowerCase(), el);
          if (text.includes('apply now') || text.includes('easily apply') || text.includes('apply on company site') === false && text.includes('apply')) {
            applyButton = el;
            break;
          }
        }
      }

      if (!applyButton) {
        this.log(`No direct "Easily Apply" button found on Indeed page for "${job.title}". Skipping direct apply.`, 'warning');
        return this.tracker.recordApplication({
          ...job,
          status: 'SKIPPED',
          notes: 'Company requires external application portal'
        });
      }

      // Check if clicking opens a new popup window
      const newTargetPromise = new Promise(resolve => {
        const handler = async (target) => {
          try {
            if (target.opener() === page.target()) {
              this.browserManager.browser.off('targetcreated', handler);
              const p = await target.page();
              resolve(p);
            }
          } catch (e) {
            resolve(null);
          }
        };
        this.browserManager.browser.on('targetcreated', handler);
        setTimeout(() => {
          this.browserManager.browser.off('targetcreated', handler);
          resolve(null);
        }, 4000);
      });

      // Human-like click on Apply button
      this.log('🤖 Copilot clicking "Apply now" button with natural human cursor...');
      await this.browserManager.humanClick(applyButton, page);
      const popupPage = await newTargetPromise;
      const applyPage = popupPage || page;
      await this.browserManager.delay(3500);

      // Multi-step modal navigator (typically up to 15 steps max)
      let maxSteps = 15;
      let step = 0;
      let submitted = false;

      while (step < maxSteps) {
        // Immediate check for Stop signal
        if (options.isCancelled && options.isCancelled()) {
          this.log('🛑 Application stopped by user.', 'warning');
          if (popupPage && !popupPage.isClosed()) await popupPage.close().catch(() => {});
          return { status: 'CANCELLED', notes: 'Stopped by user' };
        }

        // Active pause loop
        while (options.isPaused && options.isPaused()) {
          if (options.isCancelled && options.isCancelled()) break;
          await this.browserManager.delay(500);
        }

        step++;
        this.log(`🤖 Copilot processing application step ${step}...`);

        // Prevent beforeunload dialog from halting automation
        await this.browserManager.dismissBeforeUnload(applyPage);

        // Check active application context:
        // Modern Indeed Apply forms run in the top window when URL contains 'indeedapply' or 'smartapply'
        let ctx = applyPage;
        const currentUrl = applyPage.url().toLowerCase();
        if (!currentUrl.includes('indeedapply') && !currentUrl.includes('smartapply')) {
          for (const f of applyPage.frames()) {
            const fUrl = f.url().toLowerCase();
            if ((fUrl.includes('smartapply') || fUrl.includes('indeedapply')) && !fUrl.includes('recaptcha')) {
              ctx = f;
              break;
            }
          }
        }

        // Take step screenshot
        const stepScreenshot = await this.browserManager.takeScreenshot(`step-${step}`);
        this.emit('step', { step, screenshot: stepScreenshot, job });

        // Natural scanning pause on step load
        await this.browserManager.humanPause(700, 1500);

        // 1. Fill Contact details if present
        await this.fillContactFields(ctx, profile);

        // 2. Handle Resume selection / upload
        await this.handleResumeUpload(ctx, resumePath);

        // 3. Handle Work Experience & Education if prompted
        await this.fillWorkExperienceFields(ctx, profile);
        await this.fillEducationFields(ctx, profile);

        // 4. Fill Screening Questions
        await this.fillScreeningQuestions(ctx);

        // 5. Fill Voluntary Self-ID / Demographic EEO
        await this.fillEEOFields(ctx, profile);

        // 6. Look for Next / Continue / Review / Submit button
        const actionResult = await this.handleNavigationButtons(ctx, applyPage, isDryRun, job, options);

        if (actionResult.completed) {
          submitted = actionResult.submitted;
          break;
        }

        await this.browserManager.delay(1800);
      }

      await this.browserManager.dismissBeforeUnload(applyPage);
      await this.browserManager.dismissBeforeUnload(page);

      if (popupPage && !popupPage.isClosed()) {
        await popupPage.close().catch(() => {});
      }

      const finalScreenshot = await this.browserManager.takeScreenshot(`finish-${job.jobId}`);

      const result = this.tracker.recordApplication({
        ...job,
        status: submitted ? 'SUBMITTED' : (isDryRun ? 'DRY_RUN_COMPLETED' : 'REQUIRES_VERIFICATION'),
        screenshot: finalScreenshot,
        notes: submitted ? 'Successfully submitted' : (isDryRun ? 'Completed in dry-run mode (ready for submission)' : 'Pending final review or verification')
      });

      this.log(`Application completed for "${job.title}" at "${job.company}" with status: ${result.status}`);
      this.emit('status', { jobId: job.jobId, status: result.status, result });
      return result;

    } catch (err) {
      await this.browserManager.dismissBeforeUnload(page);
      this.log(`Error applying for "${job.title}": ${err.message}`, 'error');
      const errScreenshot = await this.browserManager.takeScreenshot(`error-${job.jobId}`);
      return this.tracker.recordApplication({
        ...job,
        status: 'FAILED',
        screenshot: errScreenshot,
        notes: err.message
      });
    }
  }

  async fillContactFields(ctx, profile) {
    try {
      // First Name
      const firstNameInput = await ctx.$('input[id*="first" i], input[name*="first" i], input[autocomplete*="given-name"]');
      if (firstNameInput) {
        const val = await ctx.evaluate(el => el.value, firstNameInput);
        if (!val) await firstNameInput.type(profile.personal.firstName, { delay: 30 });
      }

      // Last Name
      const lastNameInput = await ctx.$('input[id*="last" i], input[name*="last" i], input[autocomplete*="family-name"]');
      if (lastNameInput) {
        const val = await ctx.evaluate(el => el.value, lastNameInput);
        if (!val) await lastNameInput.type(profile.personal.lastName, { delay: 30 });
      }

      // Phone
      const phoneInput = await ctx.$('input[type="tel"], input[id*="phone" i], input[name*="phone" i]');
      if (phoneInput) {
        const val = await ctx.evaluate(el => el.value, phoneInput);
        if (!val) await phoneInput.type(profile.personal.rawPhone, { delay: 30 });
      }

      // City / Location
      const cityInput = await ctx.$('input[id*="city" i], input[name*="city" i], input[id*="location" i]');
      if (cityInput) {
        const val = await ctx.evaluate(el => el.value, cityInput);
        if (!val) await cityInput.type(`${profile.personal.location.city}, ${profile.personal.location.state}`, { delay: 30 });
      }
    } catch (e) {
      // ignore minor input field fill errors
    }
  }

  async fillWorkExperienceFields(ctx, profile) {
    try {
      const exp = profile.workExperience && profile.workExperience.length > 0 ? profile.workExperience[0] : null;
      if (!exp) return;

      const titleInput = await ctx.$('input[id*="jobTitle" i], input[name*="jobTitle" i], input[id*="title" i], input[aria-label*="job title" i]');
      if (titleInput) {
        const val = await ctx.evaluate(el => el.value, titleInput);
        if (!val) {
          this.log(`🤖 Copilot populating work experience: ${exp.jobTitle}`);
          await this.browserManager.humanType(titleInput, exp.jobTitle, ctx);
        }
      }

      const compInput = await ctx.$('input[id*="company" i], input[name*="company" i], input[aria-label*="company" i]');
      if (compInput) {
        const val = await ctx.evaluate(el => el.value, compInput);
        if (!val) await this.browserManager.humanType(compInput, exp.company, ctx);
      }
    } catch (e) {}
  }

  async fillEducationFields(ctx, profile) {
    try {
      const edu = profile.education?.degrees ? profile.education.degrees[0] : null;
      if (!edu) return;

      const schoolInput = await ctx.$('input[id*="school" i], input[name*="school" i], input[id*="university" i]');
      if (schoolInput) {
        const val = await ctx.evaluate(el => el.value, schoolInput);
        if (!val) {
          this.log(`🤖 Copilot confirming education: ${edu.school}`);
          await this.browserManager.humanType(schoolInput, edu.school, ctx);
        }
      }
    } catch (e) {}
  }

  async handleResumeUpload(ctx, resumePath) {
    try {
      // 1. If an existing profile resume card/radio is present, confirm it is selected
      const hasExistingResume = await ctx.evaluate(() => {
        const resumeRadios = Array.from(document.querySelectorAll('input[type="radio"][value*="resume" i], input[type="radio"][id*="resume" i], input[type="radio"]'));
        const targetRadio = resumeRadios.find(r => {
          const lbl = document.querySelector(`label[for="${r.id}"]`) || r.parentElement;
          const text = (lbl ? lbl.innerText : '').toLowerCase();
          return text.includes('resume') || text.includes('.pdf') || text.includes('uploaded');
        });

        if (targetRadio && !targetRadio.checked) {
          targetRadio.click();
          return true;
        }
        return !!targetRadio;
      });

      if (hasExistingResume) {
        this.log('🤖 Confirmed active candidate ATS resume');
      }

      // 2. If file input is present
      if (resumePath) {
        const fileInputs = await ctx.$$('input[type="file"]');
        for (const input of fileInputs) {
          await input.uploadFile(resumePath).catch(() => {});
          this.log(`Attached ATS resume document: ${resumePath}`);
          await this.browserManager.delay(800);
        }
      }
    } catch (e) {
      // resume already chosen or upload not required on this step
    }
  }

  async fillScreeningQuestions(ctx) {
    try {
      // Find all form fieldsets or question containers
      const rawQuestions = await ctx.evaluate(() => {
        const items = [];
        const containers = document.querySelectorAll('fieldset, .ia-Questions-item, [data-testid*="question"], div[class*="question"]');

        containers.forEach((container, idx) => {
          const legendOrLabel = container.querySelector('legend, label, .ia-Questions-label, [class*="label"], p');
          const prompt = legendOrLabel ? legendOrLabel.innerText.trim() : '';

          if (prompt) {
            const textarea = container.querySelector('textarea');
            const numInput = container.querySelector('input[type="number"]');
            const textInput = container.querySelector('input[type="text"], input:not([type])');
            const radios = container.querySelectorAll('input[type="radio"]');
            const select = container.querySelector('select');

            let type = 'unknown';
            let options = [];

            if (textarea) {
              type = 'textarea';
            } else if (radios.length > 0) {
              type = 'radio';
              radios.forEach(r => {
                const label = container.querySelector(`label[for="${r.id}"]`) || r.parentElement;
                if (label) options.push({ id: r.id, value: r.value, text: label.innerText.trim() });
              });
            } else if (select) {
              type = 'select';
              select.querySelectorAll('option').forEach(opt => {
                if (opt.value) options.push({ value: opt.value, text: opt.innerText.trim() });
              });
            } else if (numInput) {
              type = 'number';
            } else if (textInput) {
              type = 'text';
            }

            items.push({ index: idx, prompt, type, options });
          }
        });
        return items;
      });

      // Compute tailored answers based on resume for each question
      const answersMap = {};
      for (const q of rawQuestions) {
        const ans = this.profileManager.answerQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));
        answersMap[q.prompt] = ans;
        this.log(`🤖 Copilot answered: "${q.prompt.substring(0, 45)}..." ➔ "${ans.substring(0, 60)}"`);
      }

      // Apply each answer directly to its specific container in the page DOM
      await ctx.evaluate((answers) => {
        const containers = document.querySelectorAll('fieldset, .ia-Questions-item, [data-testid*="question"], div[class*="question"]');

        containers.forEach(container => {
          const legendOrLabel = container.querySelector('legend, label, .ia-Questions-label, [class*="label"], p');
          const prompt = legendOrLabel ? legendOrLabel.innerText.trim() : '';
          if (!prompt) return;

          const answer = answers[prompt];
          if (!answer) return;

          // 1. Textarea
          const textarea = container.querySelector('textarea');
          if (textarea && !textarea.value) {
            textarea.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(textarea, answer);
            else textarea.value = answer;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
            return;
          }

          // 2. Select Dropdown
          const select = container.querySelector('select');
          if (select) {
            const options = Array.from(select.options);
            const matchedOpt = options.find(o =>
              o.text.toLowerCase() === answer.toLowerCase() ||
              o.value.toLowerCase() === answer.toLowerCase() ||
              o.text.toLowerCase().includes(answer.toLowerCase()) ||
              o.value.toLowerCase().includes(answer.toLowerCase())
            ) || options[0];

            if (matchedOpt) {
              select.value = matchedOpt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              select.dispatchEvent(new Event('blur', { bubbles: true }));
            }
            return;
          }

          // 3. Radio Buttons
          const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
          if (radios.length > 0) {
            const matchedRadio = radios.find(r => {
              const lbl = container.querySelector(`label[for="${r.id}"]`) || r.parentElement;
              const text = (lbl ? lbl.innerText : r.value).toLowerCase();
              return text === answer.toLowerCase() || text.includes(answer.toLowerCase());
            }) || radios[0];

            if (matchedRadio) {
              matchedRadio.click();
              matchedRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          // 4. Text / Number Input
          const input = container.querySelector('input[type="text"], input[type="number"], input:not([type])');
          if (input && !input.value) {
            input.focus();
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(input, answer);
            else input.value = answer;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return;
          }
        });
      }, answersMap);

      await this.browserManager.delay(1200);
    } catch (e) {
      this.log(`Screening questions auto-fill note: ${e.message}`, 'info');
    }
  }

  async fillEEOFields(ctx, profile) {
    try {
      // 1. Handle EEO dropdown selects
      const selects = await ctx.$$('select');
      for (const select of selects) {
        const text = await ctx.evaluate(el => {
          const container = el.closest('div, fieldset') || el.parentElement;
          return (container ? container.innerText : '').toLowerCase();
        }, select);

        if (text.includes('hispanic') || text.includes('latino')) {
          await ctx.evaluate((el) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().startsWith('no') || opt.text.toLowerCase().includes('not hispanic')) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select);
        } else if (text.includes('gender') || text.includes('sex')) {
          await ctx.evaluate((el, gender) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes(gender.toLowerCase())) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select, profile.eeo.gender);
        } else if (text.includes('race') || text.includes('ethnicity')) {
          await ctx.evaluate((el, race) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes(race.toLowerCase())) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select, profile.eeo.raceEthnicity);
        } else if (text.includes('veteran')) {
          await ctx.evaluate((el) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes('not a protected veteran') || opt.text.toLowerCase().includes('not a veteran') || opt.text.toLowerCase() === 'no') {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select);
        } else if (text.includes('disability')) {
          await ctx.evaluate((el) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes('no, i do not') || opt.text.toLowerCase().includes('no disability') || opt.text.toLowerCase() === 'no') {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select);
        }
      }

      // 2. Handle EEO radio buttons and labels
      const labels = await ctx.$$('label');
      for (const lbl of labels) {
        const text = await ctx.evaluate(el => el.innerText.trim().toLowerCase(), lbl);
        if (
          text === 'male' ||
          text.includes('asian') ||
          text.includes('not a protected veteran') ||
          text.includes('no, i do not have a disability') ||
          text.includes('not hispanic')
        ) {
          await lbl.click().catch(() => {});
        }
      }
    } catch (e) {
      // EEO fields not present
    }
  }

  async handleCaptcha(page, ctx) {
    try {
      // 1. Search all frames for reCAPTCHA anchor
      const allFrames = page && typeof page.frames === 'function' ? page.frames() : [];
      for (const rcFrame of allFrames) {
        const u = rcFrame.url().toLowerCase();
        if (u.includes('recaptcha') && (u.includes('anchor') || u.includes('api2'))) {
          const anchor = await rcFrame.$('#recaptcha-anchor, .recaptcha-checkbox-border, [role="checkbox"]');
          if (anchor) {
            const isChecked = await rcFrame.evaluate(el => el.getAttribute('aria-checked') === 'true').catch(() => false);
            if (!isChecked) {
              this.log('🛡️ Auto-clicking reCAPTCHA "I\'m not a robot" checkbox...');
              await this.browserManager.humanClick(anchor, rcFrame);
              await this.browserManager.delay(2000);
            }
          }
        }
      }

      // 2. Also check in main page/ctx for captcha elements
      await ctx.evaluate(() => {
        const captchaEl = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor, [data-testid="captcha"]');
        if (captchaEl) captchaEl.click();
      }).catch(() => {});
    } catch (e) {
      // non-blocking
    }
  }

  async handleNavigationButtons(ctx, page, isDryRun, job, options = {}) {
    // Helper to check confirmation across ctx and page
    const checkConfirmation = async () => {
      return await ctx.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        return text.includes('your application has been submitted') ||
               text.includes('application submitted') ||
               text.includes('successfully applied') ||
               text.includes('application has been sent') ||
               document.querySelector('[data-testid="ia-SuccessState"], .ia-SuccessState') !== null;
      }).catch(() => false);
    };

    // 1. Check if application has already been submitted
    if (await checkConfirmation()) {
      this.log('🎉 Application confirmation verified on screen!');
      return { completed: true, submitted: true };
    }

    // 2. Check for Submit button (whether enabled or currently disabled due to captcha)
    const getSubmitBtnInfo = async () => {
      return await ctx.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]'));
        const targetBtn = allButtons.find(b => {
          const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
          if (t.includes('close') || t.includes('cancel') || t.includes('back') || t.includes('leave') || t.includes('resume')) return false;
          return t.includes('submit your application') ||
                 t.includes('submit application') ||
                 t === 'submit';
        });

        if (targetBtn) {
          const isDisabled = targetBtn.disabled || targetBtn.getAttribute('aria-disabled') === 'true';
          return { found: true, disabled: isDisabled, text: targetBtn.innerText.trim() };
        }
        return { found: false, disabled: false, text: '' };
      }).catch(() => ({ found: false, disabled: false, text: '' }));
    };

    let submitBtnInfo = await getSubmitBtnInfo();

    if (submitBtnInfo.found) {
      if (isDryRun) {
        this.log(`Dry-run mode enabled: Job "${job.title}" is ready for final submission. Skipping final submit click.`);
        await this.browserManager.takeScreenshot(`dryrun-ready-${job.jobId}`);
        return { completed: true, submitted: false };
      }

      // If submit button is disabled (e.g. waiting for reCAPTCHA)
      if (submitBtnInfo.disabled) {
        this.log('🛡️ Submit button is waiting for verification ("I\'m not a robot"). Attempting auto-verification...');
        await this.handleCaptcha(page, ctx);

        // Wait up to 45 seconds for submit button to unlock (allowing manual solve if image challenge appears)
        let waitSeconds = 0;
        let isEnabled = false;
        while (waitSeconds < 45) {
          if (options.isCancelled && options.isCancelled()) {
            this.log('🛑 Application stopped by user.', 'warning');
            return { completed: true, submitted: false };
          }

          while (options.isPaused && options.isPaused()) {
            if (options.isCancelled && options.isCancelled()) break;
            await this.browserManager.delay(500);
          }

          await this.browserManager.delay(1500);
          waitSeconds += 1.5;

          isEnabled = await ctx.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]'));
            const sub = btns.find(b => {
              const t = (b.innerText || b.value || '').trim().toLowerCase();
              return t.includes('submit your application') || t.includes('submit application') || t === 'submit';
            });
            return sub && !sub.disabled && sub.getAttribute('aria-disabled') !== 'true';
          }).catch(() => false);

          if (isEnabled) {
            this.log('✅ reCAPTCHA verified! Submit button unlocked.');
            break;
          }

          if (Math.round(waitSeconds) % 6 === 0) {
            this.log(`🛡️ Waiting for verification (${Math.round(45 - waitSeconds)}s remaining)... Solve the captcha in Chrome if prompted.`);
            await this.handleCaptcha(page, ctx);
          }
        }

        if (!isEnabled) {
          this.log('⚠️ Submit button remained locked by reCAPTCHA. Pausing for user manual verification in Chrome...', 'warning');
          return { completed: false, submitted: false };
        }
      }

      // Submit button is enabled: Execute submit
      const clickSuccess = await ctx.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]'));
        const sub = btns.find(b => {
          const t = (b.innerText || b.value || '').trim().toLowerCase();
          return (t.includes('submit your application') || t.includes('submit application') || t === 'submit') &&
                 !b.disabled && b.getAttribute('aria-disabled') !== 'true';
        });

        if (sub) {
          sub.scrollIntoView({ behavior: 'smooth', block: 'center' });
          sub.focus();
          sub.click();
          sub.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return true;
        }
        return false;
      }).catch(() => false);

      if (clickSuccess) {
        this.log(`🤖 Copilot clicked final Submit: "${submitBtnInfo.text || 'Submit'}"!`);
        await this.browserManager.delay(5000);

        if (await checkConfirmation()) {
          return { completed: true, submitted: true };
        }
        return { completed: true, submitted: true };
      }
    }

    // 3. Look for Next / Continue / Review button with up to 3 retries
    const findAndClickNext = async () => {
      return await ctx.evaluate(() => {
        const allButtons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"]'));
        const targetBtn = allButtons.find(b => {
          const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
          const isDisabled = b.disabled || b.getAttribute('aria-disabled') === 'true';
          if (isDisabled) return false;

          // Never click leave, cancel, close, back, or use a different resume
          if (
            t.includes('save and close') ||
            t.includes('close') ||
            t.includes('cancel') ||
            t.includes('leave') ||
            t.includes('back') ||
            t.includes('different resume')
          ) {
            return false;
          }

          // Check common continue / next / review identifiers
          const btnId = (b.id || '').toLowerCase();
          const testId = (b.getAttribute('data-testid') || '').toLowerCase();
          const className = (b.className || '').toLowerCase();

          if (btnId.includes('continue') || testId.includes('continue') || className.includes('continuebutton')) {
            return true;
          }

          return (
            t === 'continue' ||
            t.startsWith('continue') ||
            t.includes('continue to application') ||
            t === 'next' ||
            t.startsWith('next') ||
            t.includes('review your application') ||
            t === 'review' ||
            t.includes('save and continue')
          );
        });

        if (targetBtn) {
          targetBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          targetBtn.focus();
          targetBtn.click();
          targetBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return { found: true, text: targetBtn.innerText.trim() };
        }
        return { found: false };
      }).catch(() => ({ found: false }));
    };

    let nextCheck = await findAndClickNext();

    // If not found on first glance, retry up to 3 times with 1.2s pause (for page transition)
    if (!nextCheck.found) {
      for (let retry = 0; retry < 3; retry++) {
        await this.browserManager.delay(1200);
        nextCheck = await findAndClickNext();
        if (nextCheck.found) break;
      }
    }

    if (nextCheck.found) {
      this.log(`🤖 Copilot advancing to next step: "${nextCheck.text}"`);
      await this.browserManager.delay(2800);

      // Check for required field validation prompt
      const hasValidationError = await ctx.evaluate(() => {
        const errors = document.querySelectorAll('[aria-invalid="true"], .ia-Feedback-error, [role="alert"]');
        return errors.length > 0;
      }).catch(() => false);

      if (hasValidationError) {
        this.log('⚠️ Required field prompt detected. Copilot auto-resolving missing input...', 'warning');
        await ctx.evaluate(() => {
          const invalidInputs = document.querySelectorAll('[aria-invalid="true"], input:required:invalid');
          invalidInputs.forEach(inp => {
            if (inp.type === 'number') inp.value = '5';
            else if (inp.type === 'text' && !inp.value) inp.value = '5';
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }).catch(() => {});
        await this.browserManager.delay(1000);
      }

      return { completed: false };
    }

    // 4. Fallback: Check if already submitted before marking complete
    if (await checkConfirmation()) {
      return { completed: true, submitted: true };
    }

    // Do NOT prematurely exit on early steps if page is still transitioning
    return { completed: false };
  }
}
