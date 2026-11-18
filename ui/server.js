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

  // REST API Routes
  app.get('/api/status', (req, res) => {
    res.json({
      isRunning: agent.isRunning,
      isPaused: agent.isPaused,
      stats: agent.tracker.getStats()
    });
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

  return { app, server, agent };
}
