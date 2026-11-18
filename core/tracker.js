import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ApplicationTracker {
  constructor(filePath = path.resolve(__dirname, '../data/applications.json')) {
    this.filePath = filePath;
    this.applications = [];
    this.load();
  }

  load() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(this.filePath)) {
      try {
        this.applications = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      } catch (e) {
        console.error('Error reading applications file, resetting list:', e.message);
        this.applications = [];
      }
    } else {
      this.applications = [];
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.applications, null, 2), 'utf8');
  }

  clearSkipped() {
    this.applications = this.applications.filter(a => a.status === 'SUBMITTED' || a.status === 'DRY_RUN_COMPLETED');
    this.save();
  }

  isApplied(jobId, jobUrl, title, company) {
    return this.applications.some(app => {
      // Only consider as already applied if it was actually SUBMITTED or DRY_RUN_COMPLETED
      if (app.status === 'SUBMITTED' || app.status === 'DRY_RUN_COMPLETED') {
        if (jobId && app.jobId === jobId) return true;
        if (jobUrl && app.url === jobUrl) return true;
        if (title && company && app.title.toLowerCase() === title.toLowerCase() && app.company.toLowerCase() === company.toLowerCase()) {
          return true;
        }
      }
      return false;
    });
  }

  recordApplication(data) {
    const entry = {
      id: data.id || `app_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      jobId: data.jobId || null,
      title: data.title || 'Unknown Title',
      company: data.company || 'Unknown Company',
      location: data.location || 'Unknown Location',
      url: data.url || '',
      board: data.board || 'indeed',
      matchScore: data.matchScore || 0,
      salary: data.salary || 'Not specified',
      status: data.status || 'SUBMITTED', // 'SUBMITTED', 'DRY_RUN_COMPLETED', 'FAILED', 'SKIPPED'
      screenshot: data.screenshot || null,
      appliedAt: new Date().toISOString(),
      notes: data.notes || ''
    };

    // Replace if exists, or push new
    const existingIndex = this.applications.findIndex(a => a.id === entry.id || (a.jobId && a.jobId === entry.jobId));
    if (existingIndex >= 0) {
      this.applications[existingIndex] = { ...this.applications[existingIndex], ...entry };
    } else {
      this.applications.unshift(entry);
    }

    this.save();
    return entry;
  }

  getAll() {
    return this.applications;
  }

  getStats() {
    const total = this.applications.length;
    const submitted = this.applications.filter(a => a.status === 'SUBMITTED').length;
    const dryRun = this.applications.filter(a => a.status === 'DRY_RUN_COMPLETED').length;
    const failed = this.applications.filter(a => a.status === 'FAILED').length;
    const skipped = this.applications.filter(a => a.status === 'SKIPPED').length;

    return {
      total,
      submitted,
      dryRun,
      failed,
      skipped,
      boards: {
        indeed: this.applications.filter(a => a.board === 'indeed').length,
        linkedin: this.applications.filter(a => a.board === 'linkedin').length,
        greenhouse: this.applications.filter(a => a.board === 'greenhouse').length,
        lever: this.applications.filter(a => a.board === 'lever').length
      }
    };
  }
}
