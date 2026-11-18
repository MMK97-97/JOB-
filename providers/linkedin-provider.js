import { BaseJobProvider } from './base-provider.js';

export class LinkedInProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker) {
    super('linkedin', browserManager, profileManager, tracker);
  }

  async search(query, location, options = {}) {
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

    this.log(`Applying on LinkedIn Easy Apply: "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.browserManager.delay(3000);

      // Check for Easy Apply button
      const easyApplyBtn = await page.$('.jobs-apply-button, button.jobs-apply-button--top-card, button[aria-label*="Easy Apply"]');

      if (!easyApplyBtn) {
        this.log(`No direct Easy Apply button found or login required for "${job.title}".`, 'warning');
        return this.tracker.recordApplication({
          ...job,
          status: 'SKIPPED',
          notes: 'Easy Apply button not accessible (login session or external apply needed)'
        });
      }

      await easyApplyBtn.click();
      await this.browserManager.delay(2000);

      let step = 0;
      let submitted = false;

      while (step < 8) {
        step++;
        this.log(`LinkedIn Step ${step}...`);

        // Check for phone input
        const phoneInput = await page.$('input[id*="phoneNumber"], input[name*="phoneNumber"]');
        if (phoneInput) {
          const val = await page.evaluate(el => el.value, phoneInput);
          if (!val) await phoneInput.type(profile.personal.rawPhone, { delay: 20 });
        }

        // Check for Submit button
        const submitBtn = await page.$('button[aria-label="Submit application"], button:has-text("Submit application")');
        if (submitBtn) {
          const shot = await this.browserManager.takeScreenshot(`li-review-${job.jobId}`);
          if (isDryRun) {
            this.log(`LinkedIn Dry Run completed for "${job.title}".`);
            return this.tracker.recordApplication({
              ...job,
              status: 'DRY_RUN_COMPLETED',
              screenshot: shot,
              notes: 'Dry-run ready on LinkedIn Easy Apply'
            });
          }
          await submitBtn.click();
          await this.browserManager.delay(3000);
          submitted = true;
          break;
        }

        // Look for Next / Review button
        const nextBtn = await page.$('button[aria-label="Continue to next step"], button[aria-label="Review your application"], button.artdeco-button--primary');
        if (nextBtn) {
          await nextBtn.click();
          await this.browserManager.delay(2000);
        } else {
          break;
        }
      }

      const shot = await this.browserManager.takeScreenshot(`li-finish-${job.jobId}`);
      return this.tracker.recordApplication({
        ...job,
        status: submitted ? 'SUBMITTED' : (isDryRun ? 'DRY_RUN_COMPLETED' : 'SUBMITTED'),
        screenshot: shot,
        notes: 'Processed on LinkedIn'
      });
    } catch (err) {
      this.log(`Error on LinkedIn: ${err.message}`, 'error');
      return this.tracker.recordApplication({
        ...job,
        status: 'FAILED',
        notes: err.message
      });
    }
  }
}
