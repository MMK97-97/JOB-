import { BaseJobProvider } from './base-provider.js';

export class GreenhouseProvider extends BaseJobProvider {
  constructor(browserManager, profileManager, tracker) {
    super('greenhouse', browserManager, profileManager, tracker);
  }

  async apply(job, options = {}) {
    const page = await this.browserManager.getPage();
    const isDryRun = options.dryRun ?? false;
    const resumePath = this.profileManager.getResumePath();
    const profile = this.profileManager.profile;

    this.log(`Applying on Greenhouse for "${job.title}" at "${job.company}"`);
    this.emit('status', { jobId: job.jobId, status: 'STARTING', job });

    try {
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await this.browserManager.delay(2000);

      // Contact info
      const firstNameEl = await page.$('#first_name');
      if (firstNameEl) await firstNameEl.type(profile.personal.firstName, { delay: 20 });

      const lastNameEl = await page.$('#last_name');
      if (lastNameEl) await lastNameEl.type(profile.personal.lastName, { delay: 20 });

      const emailEl = await page.$('#email');
      if (emailEl) await emailEl.type(profile.personal.email, { delay: 20 });

      const phoneEl = await page.$('#phone');
      if (phoneEl) await phoneEl.type(profile.personal.phone, { delay: 20 });

      // Resume upload
      if (resumePath) {
        const resumeInput = await page.$('input[type="file"]');
        if (resumeInput) {
          await resumeInput.uploadFile(resumePath);
          this.log(`Attached resume: ${resumePath}`);
        }
      }

      // Links (LinkedIn, Website)
      const linkedInInput = await page.$('input[autocomplete*="custom-question-linkedin"], input[name*="linkedin" i]');
      if (linkedInInput) await linkedInInput.type(profile.personal.links.linkedin, { delay: 20 });

      const websiteInput = await page.$('input[name*="website" i], input[name*="portfolio" i]');
      if (websiteInput) await websiteInput.type(profile.personal.links.portfolio, { delay: 20 });

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

      const submitBtn = await page.$('#submit_app, input[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
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
}
