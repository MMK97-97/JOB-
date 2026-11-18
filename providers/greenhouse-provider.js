import { BaseJobProvider } from './base-provider.js';

export class GreenhouseProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker, agent = null) {
    super('greenhouse', browserManager, profileManager, tracker, agent);
  }

  async apply(job, options = {}) {
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`🤖 Copilot applying on Greenhouse: "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.browserManager.delay(2000);
      await this.browserManager.dismissBeforeUnload(page);

      // Contact info
      const firstNameEl = await page.$('#first_name, input[name*="first_name"]');
      if (firstNameEl) await firstNameEl.type(profile.personal.firstName, { delay: 25 });

      const lastNameEl = await page.$('#last_name, input[name*="last_name"]');
      if (lastNameEl) await lastNameEl.type(profile.personal.lastName, { delay: 25 });

      const emailEl = await page.$('#email, input[name*="email"]');
      if (emailEl) await emailEl.type(profile.personal.email, { delay: 25 });

      const phoneEl = await page.$('#phone, input[name*="phone"]');
      if (phoneEl) await phoneEl.type(profile.personal.phone, { delay: 25 });

      // Resume upload
      if (resumePath) {
        const resumeInput = await page.$('input[type="file"]');
        if (resumeInput) {
          await resumeInput.uploadFile(resumePath).catch(() => {});
          this.log(`Attached ATS resume: ${resumePath}`);
          await this.browserManager.delay(1000);
        }
      }

      // Links (LinkedIn, Website)
      const linkedInInput = await page.$('input[autocomplete*="custom-question-linkedin"], input[name*="linkedin" i]');
      if (linkedInInput) await linkedInInput.type(profile.personal.links.linkedin, { delay: 20 });

      const websiteInput = await page.$('input[name*="website" i], input[name*="portfolio" i]');
      if (websiteInput) await websiteInput.type(profile.personal.links.portfolio, { delay: 20 });

      // Answer Custom Screening Questions
      await this.fillCustomQuestions(page, job);

      // Take screenshot of filled Greenhouse form
      const shot = await this.browserManager.takeScreenshot(`greenhouse-${job.jobId}`);

      if (isDryRun) {
        this.log(`Dry-run enabled: Greenhouse form filled for "${job.title}". Stopping before submit.`);
        return this.tracker.recordApplication({
          ...job,
          status: 'DRY_RUN_COMPLETED',
          screenshot: shot,
          notes: 'Dry-run filled successfully on Greenhouse'
        });
      }

      const submitBtn = await page.$('#submit_app, input[type="submit"], button[type="submit"]');
      if (submitBtn) {
        await this.browserManager.humanClick(submitBtn, page);
        await this.browserManager.delay(4000);
      }

      return this.tracker.recordApplication({
        ...job,
        status: 'SUBMITTED',
        screenshot: shot,
        notes: 'Submitted via Greenhouse form'
      });
    } catch (err) {
      this.log(`Error on Greenhouse: ${err.message}`, 'error');
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
        const fields = Array.from(document.querySelectorAll('.field, div[id*="custom_fields"], div.field, fieldset'));

        fields.forEach((f, idx) => {
          const label = f.querySelector('label, legend');
          const prompt = label ? label.innerText.trim() : '';

          if (prompt && !prompt.toLowerCase().includes('first name') && !prompt.toLowerCase().includes('last name') && !prompt.toLowerCase().includes('email') && !prompt.toLowerCase().includes('phone') && !prompt.toLowerCase().includes('resume')) {
            const textarea = f.querySelector('textarea');
            const select = f.querySelector('select');
            const radios = f.querySelectorAll('input[type="radio"]');
            const checkboxes = f.querySelectorAll('input[type="checkbox"]');
            const input = f.querySelector('input[type="text"], input:not([type])');

            let type = 'unknown';
            let options = [];

            if (textarea) type = 'textarea';
            else if (radios.length > 0) {
              type = 'radio';
              radios.forEach(r => {
                const rLbl = f.querySelector(`label[for="${r.id}"]`) || r.closest('label');
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
        const fields = Array.from(document.querySelectorAll('.field, div[id*="custom_fields"], div.field, fieldset'));
        fields.forEach(f => {
          const label = f.querySelector('label, legend');
          const prompt = label ? label.innerText.trim() : '';
          if (!prompt) return;

          const answer = answers[prompt];
          if (!answer) return;

          const textarea = f.querySelector('textarea');
          if (textarea && !textarea.value) {
            textarea.value = answer;
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }

          const select = f.querySelector('select');
          if (select) {
            const opts = Array.from(select.options);
            const matched = opts.find(o => o.text.toLowerCase().includes(answer.toLowerCase()) || o.value.toLowerCase().includes(answer.toLowerCase())) || opts[0];
            if (matched) {
              select.value = matched.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          const radios = Array.from(f.querySelectorAll('input[type="radio"]'));
          if (radios.length > 0) {
            const wantYes = answer.toLowerCase() === 'yes';
            const matchedRadio = radios.find(r => {
              const rLbl = f.querySelector(`label[for="${r.id}"]`) || r.closest('label');
              const t = (rLbl ? rLbl.innerText : '').trim().toLowerCase();
              return wantYes ? (t.includes('yes') || r.value === '1') : t.includes(answer.toLowerCase());
            });
            if (matchedRadio) {
              matchedRadio.click();
              matchedRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return;
          }

          const input = f.querySelector('input[type="text"], input:not([type])');
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
