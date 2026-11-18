import { BaseJobProvider } from './base-provider.js';

export class LinkedInProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker, agent = null) {
    super('linkedin', browserManager, profileManager, tracker, agent);
  }

  async search(query, location, options = {}) {
    if (options.isCancelled && options.isCancelled()) return [];
    const page = await this.browserManager.getPage();
    const encodedQ = encodeURIComponent(query);
    const encodedL = encodeURIComponent(location);
    // f_AL=true filters for Easy Apply only on LinkedIn
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodedQ}&location=${encodedL}&f_AL=true`;

    this.log(`Searching LinkedIn Easy Apply jobs: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.browserManager.delay(3000);

    const jobs = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('.job-search-card, .base-card, .jobs-search__results-list li');

      cards.forEach(card => {
        try {
          const titleEl = card.querySelector('.base-search-card__title, h3.base-search-card__title');
          const title = titleEl ? titleEl.innerText.trim() : '';

          const companyEl = card.querySelector('.base-search-card__subtitle, h4.base-search-card__subtitle');
          const company = companyEl ? companyEl.innerText.trim() : '';

          const locEl = card.querySelector('.job-search-card__location');
          const location = locEl ? locEl.innerText.trim() : '';

          const linkEl = card.querySelector('a.base-card__full-link, a[href*="/jobs/view/"]');
          let url = linkEl ? linkEl.getAttribute('href') : '';
          if (url && url.includes('?')) url = url.split('?')[0];

          if (title && url) {
            results.push({
              jobId: `li_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
              title,
              company,
              location,
              url,
              salary: 'Not specified',
              isEasyApply: true,
              board: 'linkedin'
            });
          }
        } catch (e) {}
      });

      return results;
    });

    this.log(`Found ${jobs.length} Easy Apply jobs on LinkedIn`);
    return jobs;
  }

  async apply(job, options = {}) {
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const profile = this.profileManager.profile;
    const resumePath = this.profileManager.getResumePath();

    this.log(`🤖 Copilot starting application for "${job.title}" at "${job.company}" on LinkedIn Easy Apply...`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.browserManager.delay(2500);

      // Human reading scroll
      await this.browserManager.humanScroll(300, page);
      await this.browserManager.humanPause(1000, 1800);

      // Extract job description if present
      const jobDescription = await page.evaluate(() => {
        const descEl = document.querySelector('.description__text, .show-more-less-html__markup, .jobs-box__html-content');
        return descEl ? descEl.innerText.trim() : '';
      }).catch(() => '');

      if (jobDescription) {
        job.description = jobDescription;
        const words = jobDescription.split(/\s+/).length;
        this.log(`🤖 Read LinkedIn job posting (${words} words).`);
      }

      // Check for Easy Apply button
      const easyApplyBtn = await page.$('.jobs-apply-button, button.jobs-apply-button--top-card, button[aria-label*="Easy Apply" i], button.jobs-apply-button');

      if (!easyApplyBtn) {
        this.log(`No direct Easy Apply button found or sign-in required for "${job.title}". Skipping.`, 'warning');
        return this.tracker.recordApplication({
          ...job,
          status: 'SKIPPED',
          notes: 'Easy Apply button not accessible (login session or external apply needed)'
        });
      }

      await this.browserManager.humanClick(easyApplyBtn, page);
      await this.browserManager.delay(2500);

      let step = 0;
      const maxSteps = 12;
      let submitted = false;

      while (step < maxSteps) {
        // Immediate check for Stop signal
        if (options.isCancelled && options.isCancelled()) {
          this.log('🛑 Application stopped by user.', 'warning');
          return { status: 'CANCELLED', notes: 'Stopped by user' };
        }

        // Active pause loop
        while (options.isPaused && options.isPaused()) {
          if (options.isCancelled && options.isCancelled()) break;
          await this.browserManager.delay(500);
        }

        step++;
        this.log(`🤖 LinkedIn processing step ${step}...`);

        const stepScreenshot = await this.browserManager.takeScreenshot(`li-step-${step}`);
        this.emit('step', { step, screenshot: stepScreenshot, job });
        await this.browserManager.humanPause(500, 1200);

        // 1. Fill Contact details (Phone, Email, City)
        await this.fillContactFields(page, profile);

        // 2. Handle Resume selection / upload
        await this.handleResume(page, resumePath);

        // 3. Answer Screening Questions (radios, selects, inputs, checkboxes)
        await this.fillScreeningQuestions(page, job);

        // 4. Check for Review / Submit buttons
        const submitBtn = await page.$('button[aria-label="Submit application"], button[data-control-name="submit_unify"]');
        if (submitBtn) {
          const shot = await this.browserManager.takeScreenshot(`li-review-${job.jobId}`);
          if (isDryRun) {
            this.log(`Dry-run enabled: LinkedIn application ready for submission for "${job.title}". Skipping final submit.`);
            return this.tracker.recordApplication({
              ...job,
              status: 'DRY_RUN_COMPLETED',
              screenshot: shot,
              notes: 'Dry-run ready on LinkedIn Easy Apply'
            });
          }

          this.log('🤖 Clicking "Submit application" on LinkedIn...');
          await this.browserManager.humanClick(submitBtn, page);
          await this.browserManager.delay(4000);
          submitted = true;
          break;
        }

        // 5. Look for Next / Review button
        const nextBtn = await page.$('button[aria-label="Continue to next step"], button[aria-label="Review your application"], button.artdeco-button--primary');
        if (nextBtn) {
          const btnText = await page.evaluate(el => el.innerText.trim(), nextBtn);
          this.log(`Advancing to next step: "${btnText}"`);
          await this.browserManager.humanClick(nextBtn, page);
          await this.browserManager.delay(2200);
        } else {
          // If no next button and no submit button, check if completed modal appeared
          const isDone = await page.evaluate(() => {
            const body = document.body.innerText.toLowerCase();
            return body.includes('your application was sent') || body.includes('application submitted');
          }).catch(() => false);

          if (isDone) {
            submitted = true;
          }
          break;
        }
      }

      const finalShot = await this.browserManager.takeScreenshot(`li-finish-${job.jobId}`);
      const result = this.tracker.recordApplication({
        ...job,
        status: submitted ? 'SUBMITTED' : (isDryRun ? 'DRY_RUN_COMPLETED' : 'REQUIRES_VERIFICATION'),
        screenshot: finalShot,
        notes: submitted ? 'Successfully submitted via LinkedIn Easy Apply' : 'Pending final review'
      });

      this.log(`LinkedIn application completed for "${job.title}" with status: ${result.status}`);
      this.emit('status', { jobId: job.jobId, status: result.status, result });
      return result;

    } catch (err) {
      this.log(`Error on LinkedIn: ${err.message}`, 'error');
      let errShot = null;
      try {
        errShot = await this.browserManager.takeScreenshot(`li-error-${job.jobId}`);
      } catch (e) {}
      return this.tracker.recordApplication({
        ...job,
        status: 'FAILED',
        screenshot: errShot,
        notes: err.message
      });
    }
  }

  async fillContactFields(page, profile) {
    try {
      const phoneInput = await page.$('input[id*="phoneNumber"], input[name*="phoneNumber"], input[id*="phone"]');
      if (phoneInput) {
        const val = await page.evaluate(el => el.value, phoneInput);
        if (!val) await phoneInput.type(profile.personal.rawPhone || profile.personal.phone, { delay: 25 });
      }

      const emailInput = await page.$('input[id*="email"], input[name*="email"]');
      if (emailInput) {
        const val = await page.evaluate(el => el.value, emailInput);
        if (!val) await emailInput.type(profile.personal.email, { delay: 25 });
      }
    } catch (e) {}
  }

  async handleResume(page, resumePath) {
    try {
      // Check if resume is already selected
      const hasSelectedResume = await page.evaluate(() => {
        const selected = document.querySelector('.jobs-document-upload__file-details, [data-test-modal-id*="resume"]');
        return !!selected;
      }).catch(() => false);

      if (hasSelectedResume) {
        return;
      }

      if (resumePath) {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.uploadFile(resumePath).catch(() => {});
          await this.browserManager.delay(1000);
        }
      }
    } catch (e) {}
  }

  async fillScreeningQuestions(page, job) {
    try {
      // Extract form questions from LinkedIn form groupings
      const rawQuestions = await page.evaluate(() => {
        const items = [];
        const sections = Array.from(document.querySelectorAll('.jobs-easy-apply-form-section__grouping, fieldset, .fb-dash-form-element'));

        sections.forEach((sec, idx) => {
          const labelEl = sec.querySelector('label, legend, .fb-dash-form-element__label, .jobs-easy-apply-form-element__label');
          const prompt = labelEl ? labelEl.innerText.trim() : '';

          if (prompt) {
            const textarea = sec.querySelector('textarea');
            const numInput = sec.querySelector('input[type="number"]');
            const textInput = sec.querySelector('input[type="text"], input:not([type])');
            const radios = sec.querySelectorAll('input[type="radio"]');
            const select = sec.querySelector('select');
            const checkboxes = sec.querySelectorAll('input[type="checkbox"]');

            let type = 'unknown';
            let options = [];

            const pLower = prompt.toLowerCase();
            const isNumericPrompt =
              pLower.includes('how many years') ||
              pLower.includes('years of experience') ||
              pLower.includes('number of years') ||
              pLower.includes('years experience') ||
              pLower.includes('how many');

            if (textarea) type = 'textarea';
            else if (radios.length > 0) {
              type = 'radio';
              radios.forEach(r => {
                const rLbl = sec.querySelector(`label[for="${r.id}"]`) || r.closest('label');
                const text = rLbl ? rLbl.innerText.trim() : r.value;
                if (text) options.push({ id: r.id, value: r.value, text });
              });
            } else if (checkboxes.length > 0) {
              type = 'checkbox';
              checkboxes.forEach(c => {
                const cLbl = sec.querySelector(`label[for="${c.id}"]`) || c.closest('label');
                const text = cLbl ? cLbl.innerText.trim() : c.value;
                if (text) options.push({ id: c.id, value: c.value, text });
              });
            } else if (select) {
              type = 'select';
              select.querySelectorAll('option').forEach(o => {
                if (o.value) options.push({ value: o.value, text: o.innerText.trim() });
              });
            } else if (numInput || isNumericPrompt) type = 'number';
            else if (textInput) type = 'text';

            items.push({ index: idx, prompt, type, options });
          }
        });
        return items;
      });

      const answersMap = {};
      for (const q of rawQuestions) {
        // 1. Saved custom answers
        const savedCustom = this.profileManager.findSavedCustomAnswer(q.prompt);
        if (savedCustom !== null) {
          answersMap[q.prompt] = savedCustom;
          this.log(`🧠 Copilot using remembered answer: "${q.prompt.substring(0, 45)}..." ➔ "${savedCustom}"`);
          continue;
        }

        // 2. Known questions
        const isKnown = this.profileManager.isKnownQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));
        const defaultAns = this.profileManager.answerQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));

        if (isKnown) {
          answersMap[q.prompt] = defaultAns;
          this.log(`🤖 Copilot answered: "${q.prompt.substring(0, 45)}..." ➔ "${defaultAns.substring(0, 60)}"`);
          continue;
        }

        // 3. Unknown question: Ask user via dashboard modal
        this.log(`❓ Unknown question on LinkedIn: "${q.prompt}". Asking candidate before continuing...`, 'warning');
        if (this.agent && typeof this.agent.askUserQuestion === 'function') {
          const userAnswer = await this.agent.askUserQuestion({
            prompt: q.prompt,
            type: q.type,
            options: q.options.map(o => o.text || o.value),
            defaultAnswer: defaultAns,
            job
          });
          answersMap[q.prompt] = userAnswer;
        } else {
          answersMap[q.prompt] = defaultAns;
        }
      }

      // Apply answers in DOM
      await page.evaluate((answers) => {
        const sections = Array.from(document.querySelectorAll('.jobs-easy-apply-form-section__grouping, fieldset, .fb-dash-form-element'));
        sections.forEach(sec => {
          const labelEl = sec.querySelector('label, legend, .fb-dash-form-element__label, .jobs-easy-apply-form-element__label');
          const prompt = labelEl ? labelEl.innerText.trim() : '';
          if (!prompt) return;

          const answer = answers[prompt];
          if (!answer) return;

          // Textarea
          const textarea = sec.querySelector('textarea');
          if (textarea && !textarea.value) {
            textarea.value = answer;
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }

          // Select dropdown
          const select = sec.querySelector('select');
          if (select) {
            const opts = Array.from(select.options);
            const matched = opts.find(o =>
              o.text.toLowerCase().includes(answer.toLowerCase()) ||
              o.value.toLowerCase().includes(answer.toLowerCase())
            ) || opts[0];
            if (matched) {
              select.value = matched.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          // Radios
          const radios = Array.from(sec.querySelectorAll('input[type="radio"]'));
          if (radios.length > 0) {
            const wantYes = answer.toLowerCase() === 'yes';
            const wantNo = answer.toLowerCase() === 'no';
            let targetRadio = null;

            for (const r of radios) {
              const rLbl = sec.querySelector(`label[for="${r.id}"]`) || r.closest('label');
              const text = (rLbl ? rLbl.innerText : '').trim().toLowerCase();
              const val = (r.value || '').trim().toLowerCase();

              if (wantYes && (text === 'yes' || text.startsWith('yes') || val === 'yes' || val === '1')) {
                targetRadio = r;
                break;
              } else if (wantNo && (text === 'no' || text.startsWith('no') || val === 'no' || val === '0')) {
                targetRadio = r;
                break;
              } else if (text.includes(answer.toLowerCase()) || val.includes(answer.toLowerCase())) {
                targetRadio = r;
                break;
              }
            }

            if (targetRadio && !targetRadio.checked) {
              targetRadio.click();
              targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          // Checkboxes
          const checkboxes = Array.from(sec.querySelectorAll('input[type="checkbox"]'));
          if (checkboxes.length > 0) {
            checkboxes.forEach(cb => {
              const cLbl = sec.querySelector(`label[for="${cb.id}"]`) || cb.closest('label');
              const text = (cLbl ? cLbl.innerText : '').trim().toLowerCase();
              if ((answer.toLowerCase() === 'yes' || text.includes('agree') || text.includes('certif') || text.includes(answer.toLowerCase())) && !cb.checked) {
                cb.click();
                cb.dispatchEvent(new Event('change', { bubbles: true }));
              }
            });
            return;
          }

          // Text / Number
          const input = sec.querySelector('input[type="text"], input[type="number"], input:not([type])');
          if (input) {
            const pText = prompt.toLowerCase();
            const isNumeric =
              pText.includes('how many years') ||
              pText.includes('years of experience') ||
              pText.includes('number of years') ||
              pText.includes('years experience') ||
              pText.includes('how many') ||
              input.type === 'number';

            let finalVal = answer;
            if (isNumeric) {
              const numMatch = (answer || '').match(/\d+/);
              finalVal = numMatch ? numMatch[0] : '5';
            }

            const hasInvalidText = isNumeric && (!/^\d+$/.test((input.value || '').trim()));
            if (!input.value || hasInvalidText) {
              input.focus();
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(input, finalVal);
              else input.value = finalVal;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
            }
          }
        });
      }, answersMap);

    } catch (e) {}
  }
}
