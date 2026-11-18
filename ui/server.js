import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { JobAgent } from '../core/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createServer(port = 3000) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  // Suppress unhandled WebSocketServer error on port collision
  wss.on('error', () => {});

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/screenshots', express.static(path.resolve(__dirname, '../data/screenshots')));
  app.use('/assets', express.static(path.resolve(__dirname, '../assets')));

  const agent = new JobAgent();

  // Broadcast to all connected WebSockets
  function broadcast(event, data) {
    const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }

  // Hook agent events to broadcast
  agent.on('log', evt => broadcast('log', evt));
  agent.on('job-status', evt => broadcast('job-status', evt));
  agent.on('job-step', evt => broadcast('job-step', evt));
  agent.on('agent-state', evt => broadcast('agent-state', evt));
  agent.on('search-results', evt => broadcast('search-results', evt));
  agent.on('question-prompt', evt => broadcast('question-prompt', evt));
  agent.on('question-resolved', evt => broadcast('question-resolved', evt));

  // REST API Routes
  app.get('/api/status', (req, res) => {
    res.json({
      isRunning: agent.isRunning,
      isPaused: agent.isPaused,
      stats: agent.tracker.getStats()
    });
  });

  app.get('/api/custom-answers', (req, res) => {
    res.json(agent.profileManager.profile.customAnswers || {});
  });

  app.delete('/api/custom-answers/:key', (req, res) => {
    const success = agent.profileManager.deleteCustomAnswer(req.params.key);
    res.json({ success, customAnswers: agent.profileManager.profile.customAnswers || {} });
  });

  app.post('/api/test-question', (req, res) => {
    const { prompt, type = 'text', options = [] } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Question prompt required' });
    const savedCustom = agent.profileManager.findSavedCustomAnswer(prompt);
    const isKnown = agent.profileManager.isKnownQuestion(prompt, type, options);
    const answer = agent.profileManager.answerQuestion(prompt, type, options);
    res.json({
      prompt,
      isKnown,
      isCustom: savedCustom !== null,
      answer,
      source: savedCustom !== null ? 'Permanent Memory Bank' : (isKnown ? 'Profile Knowledge Base' : 'Unknown (Requires Candidate Prompt)')
    });
  });

  app.post('/api/custom-answers/import', (req, res) => {
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'Invalid answers object' });
    let count = 0;
    for (const [key, item] of Object.entries(answers)) {
      const ans = typeof item === 'object' ? item.answer : item;
      const t = typeof item === 'object' ? item.type : 'text';
      agent.profileManager.saveCustomAnswer(key, ans, t);
      count++;
    }
    res.json({ success: true, count, customAnswers: agent.profileManager.profile.customAnswers || {} });
  });

  app.post('/api/agent/answer-question', (req, res) => {
    const { questionId, answer, remember = true, prompt, type } = req.body;
    if (!questionId || answer === undefined) {
      return res.status(400).json({ error: 'Missing questionId or answer' });
    }

    const resolved = agent.resolveUserQuestion(questionId, answer, remember);
    if (!resolved && prompt && remember) {
      // Direct save even if not currently pending
      agent.profileManager.saveCustomAnswer(prompt, answer, type || 'text');
    }

    broadcast('question-resolved', { questionId, answer });
    res.json({ success: true, answer });
  });

  app.get('/api/profile', (req, res) => {
    res.json(agent.profileManager.profile);
  });

  app.post('/api/profile', (req, res) => {
    try {
      agent.profileManager.saveProfile(req.body);
      res.json({ success: true, profile: agent.profileManager.profile });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/criteria', (req, res) => {
    res.json(agent.profileManager.searchCriteria);
  });

  app.post('/api/criteria', (req, res) => {
    try {
      agent.profileManager.saveSearchCriteria(req.body);
      res.json({ success: true, criteria: agent.profileManager.searchCriteria });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/applications', (req, res) => {
    res.json({
      applications: agent.tracker.getAll(),
      stats: agent.tracker.getStats()
    });
  });

  app.post('/api/agent/start', async (req, res) => {
    if (agent.isRunning) {
      return res.status(400).json({ error: 'Agent is already running' });
    }
    const { board, dryRun, maxApplications } = req.body;
    // Run async in background
    agent.start({ board, dryRun, maxApplications });
    res.json({ success: true, message: 'Agent started successfully' });
  });

  app.post('/api/agent/stop', async (req, res) => {
    await agent.stop();
    res.json({ success: true, message: 'Agent stop signaled' });
  });

  app.post('/api/agent/pause', (req, res) => {
    agent.pause();
    res.json({ success: true, message: 'Agent paused' });
  });

  app.post('/api/agent/resume', (req, res) => {
    agent.resume();
    res.json({ success: true, message: 'Agent resumed' });
  });

  wss.on('connection', ws => {
    ws.send(JSON.stringify({
      event: 'initial-state',
      data: {
        isRunning: agent.isRunning,
        isPaused: agent.isPaused,
        stats: agent.tracker.getStats(),
        applications: agent.tracker.getAll().slice(0, 50)
      }
    }));
  });

  return { app, server, agent, wss };
}
