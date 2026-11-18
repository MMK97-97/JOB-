import EventEmitter from 'events';
import { BrowserManager } from './browser.js';
import { ProfileManager } from './profile-manager.js';
import { ApplicationTracker } from './tracker.js';
import { JobMatcher } from './matcher.js';
import { IndeedProvider } from '../providers/indeed-provider.js';
import { LinkedInProvider } from '../providers/linkedin-provider.js';
import { GreenhouseProvider } from '../providers/greenhouse-provider.js';
import { LeverProvider } from '../providers/lever-provider.js';

export class JobAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.profileManager = new ProfileManager();
    this.tracker = new ApplicationTracker();
    this.browserManager = new BrowserManager(this.profileManager.searchCriteria.browser || {});
    this.matcher = new JobMatcher(this.profileManager.profile, this.profileManager.searchCriteria);

    this.providers = {
      indeed: new IndeedProvider(this.browserManager, this.profileManager, this.tracker),
      linkedin: new LinkedInProvider(this.browserManager, this.profileManager, this.tracker),
      greenhouse: new GreenhouseProvider(this.browserManager, this.profileManager, this.tracker),
      lever: new LeverProvider(this.browserManager, this.profileManager, this.tracker)
    };

    // Forward provider logs & events
    Object.values(this.providers).forEach(p => {
      p.on('log', evt => this.emit('log', evt));
      p.on('status', evt => this.emit('job-status', evt));
      p.on('step', evt => this.emit('job-step', evt));
    });

    this.isRunning = false;
    this.isPaused = false;
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, provider: 'AGENT', message, type });
    console.log(`[AGENT ${timestamp}] ${message}`);
  }

  async start(options = {}) {
    if (this.isRunning) {
      this.log('Agent is already running.', 'warning');
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.emit('agent-state', { state: 'RUNNING' });

    const criteria = this.profileManager.searchCriteria;
    const isDryRun = options.dryRun ?? criteria.dryRun ?? false;
    const targetBoard = options.board || 'indeed';
    const maxApps = options.maxApplications || criteria.maxApplicationsPerSession || 20;

    this.log(`🚀 Starting Autonomous Job Agent for ${this.profileManager.profile.personal.fullName}`);
    this.log(`Configuration: Mode=${isDryRun ? 'DRY-RUN (Safe Review)' : 'AUTOPILOT (Live Submit)'}, Board=${targetBoard.toUpperCase()}`);

    try {
      await this.browserManager.launch();

      let appliedCount = 0;
      const provider = this.providers[targetBoard] || this.providers.indeed;

      const titles = criteria.targetTitles || ['Supply Chain Manager'];
      const locations = criteria.locations || ['Sarasota, FL'];

      for (const title of titles) {
        if (!this.isRunning) break;

        for (const loc of locations) {
          if (!this.isRunning) break;
          if (appliedCount >= maxApps) {
            this.log(`Target limit of ${maxApps} applications reached for this session. Completing.`);
            break;
          }

          this.log(`🔍 Searching for "${title}" in "${loc}" on ${provider.name.toUpperCase()}...`);
          const foundJobs = await provider.search(title, loc, criteria);
          this.emit('search-results', { title, location: loc, count: foundJobs.length, jobs: foundJobs });

          for (const job of foundJobs) {
            if (!this.isRunning) break;
            if (appliedCount >= maxApps) break;

            // Wait if paused
            while (this.isPaused && this.isRunning) {
              await this.browserManager.delay(1000);
            }

            // 1. Check if already applied or skipped
            if (this.tracker.isApplied(job.jobId, job.url, job.title, job.company)) {
              this.log(`Skipping "${job.title}" at "${job.company}" - already in tracker.`);
              continue;
            }

            // 2. Evaluate match score
            const match = this.matcher.evaluate(job);
            job.matchScore = match.score;

            if (!match.eligible) {
              this.log(`Skipping "${job.title}" at "${job.company}" (${match.score}% match): ${match.reason}`);
              this.tracker.recordApplication({
                ...job,
                status: 'SKIPPED',
                notes: match.reason
              });
              continue;
            }

            this.log(`🎯 Candidate Match: "${job.title}" at "${job.company}" (${match.score}% match - keywords: ${match.matchedKeywords.join(', ')})`);

            // 3. Apply to job
            const applyResult = await provider.apply(job, { dryRun: isDryRun });

            if (applyResult.status === 'SUBMITTED' || applyResult.status === 'DRY_RUN_COMPLETED') {
              appliedCount++;
              this.log(`✅ [${appliedCount}/${maxApps}] Processed application for "${job.title}" at "${job.company}". Status: ${applyResult.status}`);
            }

            // Pacing delay between jobs (5-10 seconds) to avoid bot detection and behave human
            const waitTime = Math.floor(Math.random() * 5000) + 4000;
            this.log(`Pacing wait of ${(waitTime / 1000).toFixed(1)}s before next job...`);
            await this.browserManager.delay(waitTime);
          }
        }
      }

      this.log(`🎉 Session finished. Total processed applications: ${appliedCount}`);
    } catch (err) {
      this.log(`Fatal agent error: ${err.message}`, 'error');
      console.error(err);
    } finally {
      this.isRunning = false;
      this.emit('agent-state', { state: 'STOPPED' });
    }
  }

  pause() {
    this.isPaused = true;
    this.log('Agent paused by user.', 'info');
    this.emit('agent-state', { state: 'PAUSED' });
  }

  resume() {
    this.isPaused = false;
    this.log('Agent resumed.', 'info');
    this.emit('agent-state', { state: 'RUNNING' });
  }

  async stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.log('Agent stop requested.', 'info');
    this.emit('agent-state', { state: 'STOPPED' });
  }
}
