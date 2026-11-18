import { BaseJobProvider } from './base-provider.js';

export class LeverProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker) {
    super('lever', browserManager, profileManager, tracker);
  }

  async apply(job, options = {}) {
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`Applying on Lever for "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      // Ensure apply page URL
      const applyUrl = job.url.endsWith('/apply') ? job.url : `${job.url.replace(/\/$/, '')}/apply`;
      await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.browserManager.delay(2000);

      // Full Name
      const nameEl = await page.$('input[name="name"]');
      if (nameEl) await nameEl.type(profile.personal.fullName, { delay: 20 });

      // Email
      const emailEl = await page.$('input[name="email"]');
      if (emailEl) await emailEl.type(profile.personal.email, { delay: 20 });

      // Phone
      const phoneEl = await page.$('input[name="phone"]');
      if (phoneEl) await phoneEl.type(profile.personal.phone, { delay: 20 });

      // Current Company
      const orgEl = await page.$('input[name="org"]');
      if (orgEl) await orgEl.type('Stark Premium', { delay: 20 });

      // Links
      const linkedInEl = await page.$('input[name="urls[LinkedIn]"], input[name*="linkedin" i]');
      if (linkedInEl) await linkedInEl.type(profile.personal.links.linkedin, { delay: 20 });

      const portfolioEl = await page.$('input[name="urls[Portfolio]"], input[name*="portfolio" i]');
      if (portfolioEl) await portfolioEl.type(profile.personal.links.portfolio, { delay: 20 });

      // Upload Resume
      if (resumePath) {
        const resumeInput = await page.$('input[type="file"]');
        if (resumeInput) {
          await resumeInput.uploadFile(resumePath);
          this.log(`Attached resume: ${resumePath}`);
        }
      }

      // Additional information / Cover letter
      const commentsEl = await page.$('textarea[name="comments"]');
      if (commentsEl) await commentsEl.type(profile.coverLetter, { delay: 10 });

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

      const submitBtn = await page.$('#btn-submit, button.postings-btn-submit');
      if (submitBtn) {
        await submitBtn.click();
        await this.browserManager.delay(4000);
      }

      return this.tracker.recordApplication({
        ...job,
        status: 'SUBMITTED',
        screenshot: shot,
        notes: 'Submitted via Lever portal'
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
}
