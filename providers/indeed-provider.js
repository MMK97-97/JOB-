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
          const cardText = card.innerText || '';
          const hasEasyApplyBadge = cardText.includes('Easily apply') ||
                                   cardText.includes('Apply now') ||
                                   card.querySelector('[data-testid="indeedApply"], .iaIcon, svg.ia-icon') !== null;

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
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`Starting application for: "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
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

      // Look for Indeed Apply button
      const applyBtnSelector = '#indeedApplyButton, button[id*="indeedApply"], button.jobsearch-IndeedApplyButton, button:has-text("Apply now")';
      let applyButton = await page.$(applyBtnSelector);

      if (!applyButton) {
        // Fallback search by text
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = await page.evaluate(el => el.innerText.trim().toLowerCase(), btn);
          if (text.includes('apply now') || text.includes('easily apply')) {
            applyButton = btn;
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

      // Click Apply
      this.log('Clicking "Apply now" button...');
      await applyButton.click();
      await this.browserManager.delay(3000);

      // Multi-step modal navigator (typically up to 10 steps max)
      let maxSteps = 12;
      let step = 0;
      let submitted = false;

      while (step < maxSteps) {
        step++;
        this.log(`Processing application step ${step}...`);

        // Check active application context: could be main page or iframe
        let frame = null;
        for (const f of page.frames()) {
          const fUrl = f.url().toLowerCase();
          if (fUrl.includes('smartapply') || fUrl.includes('indeedapply') || fUrl.includes('apply')) {
            frame = f;
            break;
          }
        }
        const ctx = frame || page;

        // Take step screenshot
        const stepScreenshot = await this.browserManager.takeScreenshot(`step-${step}`);
        this.emit('step', { step, screenshot: stepScreenshot, job });

        // 1. Fill Contact details if present
        await this.fillContactFields(ctx, profile);

        // 2. Handle Resume upload if file input exists
        await this.handleResumeUpload(ctx, resumePath);

        // 3. Fill Screening Questions
        await this.fillScreeningQuestions(ctx);

        // 4. Fill Voluntary Self-ID / EEO if present
        await this.fillEEOFields(ctx, profile);

        // 5. Look for Next / Continue / Review / Submit button
        const actionResult = await this.handleNavigationButtons(ctx, page, isDryRun, job);

        if (actionResult.completed) {
          submitted = actionResult.submitted;
          break;
        }

        await this.browserManager.delay(2000);
      }

      const finalScreenshot = await this.browserManager.takeScreenshot(`finish-${job.jobId}`);

      const result = this.tracker.recordApplication({
        ...job,
        status: submitted ? 'SUBMITTED' : (isDryRun ? 'DRY_RUN_COMPLETED' : 'SUBMITTED'),
        screenshot: finalScreenshot,
        notes: isDryRun ? 'Completed in dry-run mode (ready for submission)' : 'Successfully submitted'
      });

      this.log(`Application completed for "${job.title}" at "${job.company}" with status: ${result.status}`);
      this.emit('status', { jobId: job.jobId, status: result.status, result });
      return result;

    } catch (err) {
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

  async handleResumeUpload(ctx, resumePath) {
    if (!resumePath) return;
    try {
      const fileInputs = await ctx.$$('input[type="file"]');
      for (const input of fileInputs) {
        await input.uploadFile(resumePath);
        this.log(`Attached resume: ${resumePath}`);
        await this.browserManager.delay(1000);
      }
    } catch (e) {
      // upload failed or resume already selected
    }
  }

  async fillScreeningQuestions(ctx) {
    try {
      // Find all form fieldsets or question containers
      const questions = await ctx.evaluate(() => {
        const items = [];
        const containers = document.querySelectorAll('fieldset, .ia-Questions-item, [data-testid*="question"], div[class*="question"]');

        containers.forEach((container, idx) => {
          const legendOrLabel = container.querySelector('legend, label, .ia-Questions-label, [class*="label"], p');
          const prompt = legendOrLabel ? legendOrLabel.innerText.trim() : '';

          if (prompt) {
            // Determine type
            const textInput = container.querySelector('input[type="text"], input:not([type])');
            const numInput = container.querySelector('input[type="number"]');
            const radios = container.querySelectorAll('input[type="radio"]');
            const select = container.querySelector('select');
            const textarea = container.querySelector('textarea');

            let type = 'unknown';
            let options = [];

            if (radios.length > 0) {
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
            } else if (textarea) {
              type = 'textarea';
            } else if (textInput) {
              type = 'text';
            }

            items.push({ index: idx, prompt, type, options });
          }
        });
        return items;
      });

      for (const q of questions) {
        const answer = this.profileManager.answerQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));

        if (q.type === 'radio' && q.options.length > 0) {
          // Find matching radio
          const matchedOpt = q.options.find(o =>
            o.text.toLowerCase().includes(answer.toLowerCase()) ||
            o.value.toLowerCase().includes(answer.toLowerCase())
          ) || q.options[0];

          if (matchedOpt && matchedOpt.id) {
            const radioEl = await ctx.$(`#${matchedOpt.id}`);
            if (radioEl) await radioEl.click();
          }
        } else if (q.type === 'select' && q.options.length > 0) {
          const matchedOpt = q.options.find(o =>
            o.text.toLowerCase().includes(answer.toLowerCase()) ||
            o.value.toLowerCase().includes(answer.toLowerCase())
          );
          if (matchedOpt) {
            const selects = await ctx.$$('select');
            if (selects[q.index]) await selects[q.index].select(matchedOpt.value);
          }
        } else if (q.type === 'number' || q.type === 'text') {
          const inputs = await ctx.$$('input[type="text"], input[type="number"], input:not([type])');
          if (inputs[q.index]) {
            const currentVal = await ctx.evaluate(el => el.value, inputs[q.index]);
            if (!currentVal) await inputs[q.index].type(answer, { delay: 20 });
          }
        } else if (q.type === 'textarea') {
          const textareas = await ctx.$$('textarea');
          if (textareas[q.index]) {
            const currentVal = await ctx.evaluate(el => el.value, textareas[q.index]);
            if (!currentVal) await textareas[q.index].type(this.profileManager.profile.coverLetter, { delay: 10 });
          }
        }
      }
    } catch (e) {
      this.log(`Screening questions auto-fill note: ${e.message}`, 'info');
    }
  }

  async fillEEOFields(ctx, profile) {
    try {
      // Look for select or radio options for gender, race, veteran, disability
      const selects = await ctx.$$('select');
      for (const select of selects) {
        const text = await ctx.evaluate(el => {
          const label = el.closest('div')?.innerText || '';
          return label.toLowerCase();
        }, select);

        if (text.includes('gender')) {
          await ctx.evaluate((el, gender) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes(gender.toLowerCase())) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select, profile.eeo.gender);
        } else if (text.includes('veteran')) {
          await ctx.evaluate((el) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes('not a protected veteran') || opt.text.toLowerCase().includes('not a veteran')) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select);
        } else if (text.includes('disability')) {
          await ctx.evaluate((el) => {
            for (const opt of el.options) {
              if (opt.text.toLowerCase().includes('no, i do not') || opt.text.toLowerCase().includes('no')) {
                el.value = opt.value;
                el.dispatchEvent(new Event('change', { bubbles: true }));
                break;
              }
            }
          }, select);
        }
      }
    } catch (e) {
      // EEO not present
    }
  }

  async handleNavigationButtons(ctx, page, isDryRun, job) {
    // Check buttons available
    const buttonData = await ctx.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map((b, idx) => ({
        index: idx,
        text: b.innerText.trim(),
        type: b.getAttribute('type') || '',
        disabled: b.disabled || b.getAttribute('aria-disabled') === 'true'
      }));
    });

    const activeButtons = buttonData.filter(b => !b.disabled && b.text.length > 0);

    // Look for submit button
    const submitBtn = activeButtons.find(b =>
      b.text.toLowerCase().includes('submit your application') ||
      b.text.toLowerCase().includes('submit application') ||
      b.text.toLowerCase() === 'submit' ||
      b.text.toLowerCase() === 'apply'
    );

    if (submitBtn) {
      if (isDryRun) {
        this.log(`Dry-run mode enabled: Job "${job.title}" is ready for final submission. Skipping click on submit button.`);
        await this.browserManager.takeScreenshot(`dryrun-ready-${job.jobId}`);
        return { completed: true, submitted: false };
      }

      this.log(`Clicking final Submit button: "${submitBtn.text}"!`);
      const buttons = await ctx.$$('button');
      await buttons[submitBtn.index].click();
      await this.browserManager.delay(4000);
      return { completed: true, submitted: true };
    }

    // Look for Next / Continue / Review
    const nextBtn = activeButtons.find(b =>
      b.text.toLowerCase().includes('continue') ||
      b.text.toLowerCase().includes('next') ||
      b.text.toLowerCase().includes('review your application') ||
      b.text.toLowerCase().includes('review')
    );

    if (nextBtn) {
      this.log(`Clicking button: "${nextBtn.text}"`);
      const buttons = await ctx.$$('button');
      await buttons[nextBtn.index].click();
      await this.browserManager.delay(2500);
      return { completed: false };
    }

    // Check if application has already been submitted (e.g. confirmation page visible)
    const isSubmitted = await ctx.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('your application has been submitted') ||
             text.includes('application submitted') ||
             text.includes('successfully applied');
    });

    if (isSubmitted) {
      return { completed: true, submitted: true };
    }

    // If no navigation buttons are found, finish loop
    return { completed: true, submitted: false };
  }
}
