import EventEmitter from 'events';

export class BaseJobProvider extends EventEmitter {
  constructor(name, browserManager, profileManager, tracker, agent = null) {
    super();
    this.name = name;
    this.browserManager = browserManager;
    this.profileManager = profileManager;
    this.tracker = tracker;
    this.agent = agent;
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    this.emit('log', { timestamp, provider: this.name, message: msg, type });
    console.log(`[${this.name.toUpperCase()} ${timestamp}] ${msg}`);
  }

  async search(query, location, options = {}) {
    throw new Error('search() method must be implemented by subclass');
  }

  async apply(job, options = {}) {
    throw new Error('apply() method must be implemented by subclass');
  }
}
