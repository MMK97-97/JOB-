import { BaseJobProvider } from './base-provider.js';

export class LeverProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker, agent = null) {
    super('lever', browserManager, profileManager, tracker, agent);
  }

  async apply(job, options = {}) {
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`🤖 Copilot applying on Lever for "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      // Ensure apply page URL
      const applyUrl = job.url.endsWith('/apply') ? job.url : `${job.url.replace(/\/$/, '')}/apply`;
      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 35000, referer: 'https://jobs.lever.co/' });
      await this.browserManager.delay(2000);
      await this.browserManager.dismissBeforeUnload(page);

      // Full Name
      const nameEl = await page.$('input[name="name"]');
      if (nameEl) await this.browserManager.humanType(nameEl, profile.personal.fullName, page);

      // Email
      const emailEl = await page.$('input[name="email"]');
      if (emailEl) await this.browserManager.humanType(emailEl, profile.personal.email, page);

      // Phone
      const phoneEl = await page.$('input[name="phone"]');
      if (phoneEl) await this.browserManager.humanType(phoneEl, profile.personal.phone, page);

      // Current Company
      const orgEl = await page.$('input[name="org"]');
      if (orgEl) await this.browserManager.humanType(orgEl, 'Stark Premium', page);

      // Links
      const linkedInEl = await page.$('input[name="urls[LinkedIn]"], input[name*="linkedin" i]');
      if (linkedInEl) await this.browserManager.humanType(linkedInEl, profile.personal.links.linkedin, page);

      const portfolioEl = await page.$('input[name="urls[Portfolio]"], input[name*="portfolio" i]');
      if (portfolioEl) await this.browserManager.humanType(portfolioEl, profile.personal.links.portfolio, page);

      // Upload Resume
      if (resumePath) {
        const resumeInput = await page.$('input[type="file"]');
        if (resumeInput) {
          await resumeInput.uploadFile(resumePath).catch(() => {});
          this.log(`Attached ATS resume: ${resumePath}`);
          await this.browserManager.delay(1000);
        }
      }

      // Additional information / Cover letter
      const commentsEl = await page.$('textarea[name="comments"]');
      if (commentsEl) await this.browserManager.humanType(commentsEl, profile.coverLetter, page);

      // Custom Lever screening questions
      await this.fillCustomQuestions(page, job);

      const shot = await this.browserManager.takeScreenshot(`lever-${job.jobId}`);

      if (isDryRun) {
        this.log(`Dry-run enabled: Lever form completed for "${job.title}". Stopping before submission.`);
        return this.tracker.recordApplication({
          ...job,
          status: 'DRY_RUN_COMPLETED',
          screenshot: shot,
          notes: 'Dry-run filled successfully on Lever'
        });
      }

      const submitBtn = await page.$('#btn-submit, button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        await this.browserManager.humanClick(submitBtn, page);
        await this.browserManager.delay(4000);
      }

      return this.tracker.recordApplication({
        ...job,
        status: 'SUBMITTED',
        screenshot: shot,
        notes: 'Submitted via Lever form'
      });
    } catch (err) {
      this.log(`Error on Lever: ${err.message}`, 'error');
      return this.tracker.recordApplication({
        ...job,
        status: 'FAILED',
        notes: err.message
      });
    }
  }

  async fillCustomQuestions(page, job) {
    try {
      const rawQuestions = await page.evaluate(() => {
        const items = [];
        const cards = Array.from(document.querySelectorAll('.application-question, .custom-question, .application-additional'));

        cards.forEach((card, idx) => {
          const textEl = card.querySelector('.text, label, .application-label');
          const prompt = textEl ? textEl.innerText.trim() : '';

          if (prompt) {
            const textarea = card.querySelector('textarea');
            const select = card.querySelector('select');
            const radios = card.querySelectorAll('input[type="radio"]');
            const checkboxes = card.querySelectorAll('input[type="checkbox"]');
            const input = card.querySelector('input[type="text"], input:not([type])');

            let type = 'unknown';
            let options = [];

            if (textarea) type = 'textarea';
            else if (radios.length > 0) {
              type = 'radio';
              radios.forEach(r => {
                const rLbl = card.querySelector(`label[for="${r.id}"]`) || r.closest('label');
                options.push({ id: r.id, value: r.value, text: rLbl ? rLbl.innerText.trim() : r.value });
              });
            } else if (checkboxes.length > 0) {
              type = 'checkbox';
            } else if (select) {
              type = 'select';
              select.querySelectorAll('option').forEach(o => {
                if (o.value) options.push({ value: o.value, text: o.innerText.trim() });
              });
            } else if (input) type = 'text';

            items.push({ index: idx, prompt, type, options });
          }
        });
        return items;
      });

      const answersMap = {};
      for (const q of rawQuestions) {
        const savedCustom = this.profileManager.findSavedCustomAnswer(q.prompt);
        if (savedCustom !== null) {
          answersMap[q.prompt] = savedCustom;
          continue;
        }

        const isKnown = this.profileManager.isKnownQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));
        const defaultAns = this.profileManager.answerQuestion(q.prompt, q.type, q.options.map(o => o.text || o.value));

        if (isKnown) {
          answersMap[q.prompt] = defaultAns;
          continue;
        }

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

      await page.evaluate((answers) => {
        const cards = Array.from(document.querySelectorAll('.application-question, .custom-question, .application-additional'));
        cards.forEach(card => {
          const textEl = card.querySelector('.text, label, .application-label');
          const prompt = textEl ? textEl.innerText.trim() : '';
          if (!prompt) return;

          const answer = answers[prompt];
          if (!answer) return;

          const textarea = card.querySelector('textarea');
          if (textarea && !textarea.value) {
            textarea.value = answer;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }

          const select = card.querySelector('select');
          if (select) {
            const opts = Array.from(select.options);
            const matched = opts.find(o => o.text.toLowerCase().includes(answer.toLowerCase()) || o.value.toLowerCase().includes(answer.toLowerCase())) || opts[0];
            if (matched) {
              select.value = matched.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          const radios = Array.from(card.querySelectorAll('input[type="radio"]'));
          if (radios.length > 0) {
            const wantYes = answer.toLowerCase() === 'yes';
            const matchedRadio = radios.find(r => {
              const rLbl = card.querySelector(`label[for="${r.id}"]`) || r.closest('label');
              const t = (rLbl ? rLbl.innerText : '').trim().toLowerCase();
              return wantYes ? (t.includes('yes') || r.value === '1') : t.includes(answer.toLowerCase());
            });
            if (matchedRadio) {
              matchedRadio.click();
              matchedRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          const input = card.querySelector('input[type="text"], input:not([type])');
          if (input && !input.value) {
            input.value = answer;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }, answersMap);
    } catch (e) {}
  }
}
