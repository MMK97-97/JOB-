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
    this.browserManager.registerAgent(this);
    this.matcher = new JobMatcher(this.profileManager.profile, this.profileManager.searchCriteria);

    this.providers = {
      indeed: new IndeedProvider(this.browserManager, this.profileManager, this.tracker, this),
      linkedin: new LinkedInProvider(this.browserManager, this.profileManager, this.tracker, this),
      greenhouse: new GreenhouseProvider(this.browserManager, this.profileManager, this.tracker, this),
      lever: new LeverProvider(this.browserManager, this.profileManager, this.tracker, this)
    };

    // Forward provider logs & events
    Object.values(this.providers).forEach(p => {
      p.on('log', evt => this.emit('log', evt));
      p.on('status', evt => this.emit('job-status', evt));
      p.on('step', evt => this.emit('job-step', evt));
      p.on('captcha-challenge', evt => this.emit('captcha-challenge', evt));
      p.on('captcha-resolved', evt => this.emit('captcha-resolved', evt));
    });

    this.pendingQuestions = new Map();
    this.isRunning = false;
    this.isPaused = false;
  }

  askUserQuestion({ questionId, prompt, type = 'text', options = [], defaultAnswer = 'Yes', job = {} }) {
    return new Promise((resolve) => {
      const qId = questionId || `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

      this.log(`❓ Copilot asking candidate: "${prompt}" - Waiting for candidate answer on dashboard...`, 'warning');

      this.emit('question-prompt', {
        questionId: qId,
        prompt,
        type,
        options,
        defaultAnswer,
        job: { title: job?.title || 'Active Target', company: job?.company || '' }
      });

      // 60-second grace timer before continuing with smart fallback
      const timer = setTimeout(() => {
        if (this.pendingQuestions.has(qId)) {
          this.log(`⏱️ Response timeout (60s) reached for "${prompt}". Proceeding with resume-grounded default: "${defaultAnswer}".`, 'info');
          this.pendingQuestions.delete(qId);
          resolve(defaultAnswer);
        }
      }, 60000);

      this.pendingQuestions.set(qId, {
        resolve: (ans) => {
          clearTimeout(timer);
          this.pendingQuestions.delete(qId);
          resolve(ans);
        },
        prompt,
        type
      });
    });
  }

  resolveUserQuestion(questionId, answer, remember = true) {
    const pending = this.pendingQuestions.get(questionId);
    if (pending) {
      if (remember) {
        this.profileManager.saveCustomAnswer(pending.prompt, answer, pending.type);
        this.log(`💾 Saved candidate answer permanently for future applications: "${pending.prompt}" ➔ "${answer}"`, 'info');
      }
      pending.resolve(answer);
      this.emit('question-resolved', { questionId, answer });
      return true;
    }
    return false;
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

    // Always reload fresh configurations & tracker from disk
    this.profileManager.load();
    this.tracker.load();
    this.tracker.clearSkipped(); // Purge old skipped jobs so all available positions are re-evaluated!

    const criteria = this.profileManager.searchCriteria;
    // Guarantee match score threshold is sensible (never locked at 95%)
    criteria.minimumMatchScore = Math.min(criteria.minimumMatchScore || 30, 35);

    // Refresh matcher with current criteria
    this.matcher = new JobMatcher(this.profileManager.profile, criteria);

    const isDryRun = options.dryRun ?? criteria.dryRun ?? false;
    const targetBoard = options.board || 'indeed';
    const maxApps = options.maxApplications || criteria.maxApplicationsPerSession || 25;

    this.log(`🚀 Starting Autonomous Job Agent for ${this.profileManager.profile.personal.fullName}`);
    this.log(`Configuration: Mode=${isDryRun ? 'DRY-RUN (Safe Review)' : 'AUTOPILOT (Live Submit)'}, Board=${targetBoard.toUpperCase()}, Threshold=${criteria.minimumMatchScore}%`);

    try {
      await this.browserManager.launch();

      let appliedCount = 0;
      const activeProviders = targetBoard === 'all'
        ? [this.providers.indeed, this.providers.linkedin]
        : [this.providers[targetBoard] || this.providers.indeed];

      const titles = criteria.targetTitles || ['Supply Chain Manager'];
      const locations = criteria.locations || ['Sarasota, FL'];
      const sessionEvaluated = new Set();

      for (const provider of activeProviders) {
        if (!this.isRunning || appliedCount >= maxApps) break;
        this.log(`🌐 Operating on Job Portal: ${provider.name.toUpperCase()}`);

        for (const title of titles) {
          if (!this.isRunning || appliedCount >= maxApps) break;

          for (const loc of locations) {
            if (!this.isRunning || appliedCount >= maxApps) break;

            this.log(`🔍 Searching for "${title}" in "${loc}" on ${provider.name.toUpperCase()}...`);
            const foundJobs = await provider.search(title, loc, {
              ...criteria,
              isCancelled: () => !this.isRunning,
              isPaused: () => this.isPaused
            });
            this.emit('search-results', { title, location: loc, count: foundJobs.length, jobs: foundJobs });

          for (const job of foundJobs) {
            if (!this.isRunning) break;
            if (appliedCount >= maxApps) break;

            const jobKey = job.jobId || `${job.title}_${job.company}`.toLowerCase();
            if (sessionEvaluated.has(jobKey)) continue;
            sessionEvaluated.add(jobKey);

            // Wait if paused
            while (this.isPaused && this.isRunning) {
              await this.browserManager.delay(1000);
            }

            // 1. Check if already applied
            if (this.tracker.isApplied(job.jobId, job.url, job.title, job.company)) {
              this.log(`Skipping "${job.title}" at "${job.company}" - already applied in tracker.`);
              continue;
            }

            // 2. Evaluate match score
            const match = this.matcher.evaluate(job);
            job.matchScore = match.score;

            if (!match.eligible) {
              this.log(`Skipping non-target position "${job.title}" at "${job.company}" (${match.score}% match): ${match.reason}`);
              continue;
            }

            this.log(`🎯 Candidate Match: "${job.title}" at "${job.company}" (${match.score}% match - keywords: ${match.matchedKeywords.join(', ')})`);

            // 3. Apply to job with isolated fault tolerance (single job error never crashes the session)
            let applyResult = null;
            try {
              applyResult = await provider.apply(job, {
                dryRun: isDryRun,
                isCancelled: () => !this.isRunning,
                isPaused: () => this.isPaused
              });
            } catch (jobErr) {
              this.log(`⚠️ Handled non-fatal error applying to "${job.title}": ${jobErr.message}. Advancing to next job.`, 'warning');
              applyResult = { status: 'FAILED', notes: jobErr.message };
            }

            if (applyResult && (applyResult.status === 'SUBMITTED' || applyResult.status === 'DRY_RUN_COMPLETED')) {
              appliedCount++;
              this.log(`✅ [${appliedCount}/${maxApps}] Processed application for "${job.title}" at "${job.company}". Status: ${applyResult.status}`);
            }

            // Natural human pacing between jobs with realistic variance
            let waitTime = Math.floor(Math.random() * 7000) + 7000; // 7 to 14s standard
            // Every 4th application, candidate takes a natural short break (20-30s)
            if (appliedCount > 0 && appliedCount % 4 === 0) {
              waitTime += Math.floor(Math.random() * 12000) + 12000;
              this.log(`☕ Candidate taking a natural human pause (~${(waitTime / 1000).toFixed(0)}s) before next application batch...`);
            } else {
              this.log(`Natural human pacing wait of ${(waitTime / 1000).toFixed(1)}s before reviewing next job...`);
            }

            // During pacing wait, perform subtle natural idle mouse movements
            const fidgetInterval = 2800;
            let elapsed = 0;
            while (elapsed < waitTime && this.isRunning && !this.isPaused) {
              const slice = Math.min(fidgetInterval, waitTime - elapsed);
              await this.browserManager.delay(slice);
              elapsed += slice;
              if (Math.random() < 0.65) {
                await this.browserManager.randomFidget().catch(() => {});
              }
            }
          }
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
    this.log('🛑 Agent stop requested. Immediately cancelling active tasks...', 'info');
    this.emit('agent-state', { state: 'STOPPED' });

    // Close any auxiliary job application popups/tabs
    if (this.browserManager && this.browserManager.browser) {
      try {
        const pages = await this.browserManager.browser.pages().catch(() => []);
        if (pages.length > 1) {
          for (let i = 1; i < pages.length; i++) {
            if (pages[i] && !pages[i].isClosed()) {
              await pages[i].close().catch(() => {});
            }
          }
        }
      } catch (e) {}
    }
  }
}
