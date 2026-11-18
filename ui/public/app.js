// Frontend JavaScript for Autonomous Job Agent
let ws = null;
let currentProfile = null;
let currentCriteria = null;
let applications = [];

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  loadData();
  bindEvents();
});

// Tab navigation
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(targetId);
      if (targetContent) targetContent.classList.remove('hidden');
    });
  });
}

// WebSocket connection for real-time events
function initWebSocket() {
  const isCloud = window.location.hostname.includes('github.io');
  if (isCloud) {
    appendLog('Running in Cloud Preview mode (GitHub Pages). Local runner API is inactive.', 'info');
    appendLog('To run live automated applying on Indeed & LinkedIn, launch "start.bat" locally.', 'warning');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendLog('Connected to agent real-time communication stream.', 'info');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleAgentEvent(msg.event, msg.data);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      appendLog('WebSocket disconnected. Reconnecting in 3s...', 'warning');
      setTimeout(initWebSocket, 3000);
    };
  } catch (e) {
    console.warn('WebSocket unavailable:', e);
  }
}

function handleAgentEvent(event, data) {
  switch (event) {
    case 'initial-state':
      updateAgentStatus(data.isRunning, data.isPaused);
      if (data.stats) updateStats(data.stats);
      if (data.applications) {
        applications = data.applications;
        renderApplicationsTable();
      }
      break;

    case 'agent-state':
      updateAgentStatus(data.state === 'RUNNING', data.state === 'PAUSED');
      break;

    case 'log':
      appendLog(`[${data.provider}] ${data.message}`, data.type);
      break;

    case 'job-status':
      updateActiveJob(data.job, data.status);
      refreshApplications();
      break;

    case 'job-step':
      if (data.step) {
        document.getElementById('activeStepNumber').textContent = `Step ${data.step}`;
      }
      if (data.screenshot) {
        const screenshotUrl = `/screenshots/${data.screenshot.split(/[\\/]/).pop()}`;
        const img = document.getElementById('activeScreenshot');
        img.src = screenshotUrl;
        img.classList.remove('hidden');
        document.getElementById('screenshotPlaceholder').classList.add('hidden');
      }
      break;

    case 'search-results':
      appendLog(`Found ${data.count} roles for "${data.title}" in "${data.location}"`, 'info');
      break;
  }
}

function updateAgentStatus(isRunning, isPaused) {
  const statusDot = document.getElementById('statusDot');
  const statusPulse = document.getElementById('statusPulse');
  const statusText = document.getElementById('statusText');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnStop = document.getElementById('btnStop');

  if (isRunning) {
    if (isPaused) {
      statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';
      statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
      statusText.textContent = 'Paused';
      statusText.className = 'text-xs font-medium text-amber-400 uppercase tracking-wider';
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerHTML = '<i class="fa-solid fa-play text-xs"></i><span>Resume</span>';
      btnStop.disabled = false;
    } else {
      statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';
      statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
      statusText.textContent = 'Running';
      statusText.className = 'text-xs font-medium text-emerald-400 uppercase tracking-wider';
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerHTML = '<i class="fa-solid fa-pause text-xs"></i><span>Pause</span>';
      btnStop.disabled = false;
    }
  } else {
    statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-slate-500';
    statusPulse.className = 'absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-0';
    statusText.textContent = 'Ready';
    statusText.className = 'text-xs font-medium text-slate-300 uppercase tracking-wider';
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
  }
}

function updateActiveJob(job, status) {
  if (!job) return;
  document.getElementById('activeJobTitle').textContent = job.title || 'In Progress';
  document.getElementById('activeJobCompany').textContent = job.company || '';
  document.getElementById('activeJobLocation').textContent = job.location || '-';
  document.getElementById('activeJobStatus').textContent = status;
  document.getElementById('activeBoardBadge').textContent = (job.board || 'Indeed').toUpperCase();
}

function appendLog(message, type = 'info') {
  const consoleEl = document.getElementById('logConsole');
  const line = document.createElement('div');
  line.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="text-slate-600">[${time}]</span> ${escapeHtml(message)}`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function showToast(message, type = 'success') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    document.body.appendChild(toast);
  }

  const bg = type === 'success' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-rose-600 border-rose-500 text-white';
  const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';

  toast.className = `fixed bottom-6 right-6 z-50 flex items-center space-x-3 px-4 py-3 rounded-xl shadow-2xl text-xs font-semibold transition-all transform duration-300 border ${bg} translate-y-0 opacity-100`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i><span>${message}</span>`;

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.add('translate-y-4', 'opacity-0');
  }, 4000);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadData() {
  const isCloud = window.location.hostname.includes('github.io');

  try {
    let profRes, critRes, appRes;

    if (isCloud) {
      const cachedProf = localStorage.getItem('job_agent_profile');
      const cachedCrit = localStorage.getItem('job_agent_criteria');

      [profRes, critRes, appRes] = await Promise.all([
        cachedProf ? Promise.resolve(JSON.parse(cachedProf)) : fetch('config/profile.json').then(r => r.json()).catch(() => null),
        cachedCrit ? Promise.resolve(JSON.parse(cachedCrit)) : fetch('config/search-criteria.json').then(r => r.json()).catch(() => null),
        fetch('data/applications.json').then(r => r.json()).catch(() => [])
      ]);
      appRes = { applications: Array.isArray(appRes) ? appRes : [], stats: { total: 0, submitted: 0, dryRun: 0, skipped: 0 } };
    } else {
      [profRes, critRes, appRes] = await Promise.all([
        fetch('/api/profile').then(r => r.json()),
        fetch('/api/criteria').then(r => r.json()),
        fetch('/api/applications').then(r => r.json())
      ]);
    }

    currentProfile = profRes;
    currentCriteria = critRes;
    applications = appRes.applications || [];

    if (currentProfile) populateProfile(currentProfile);
    if (currentCriteria) populateCriteria(currentCriteria);
    if (appRes.stats) updateStats(appRes.stats);
    renderApplicationsTable();
  } catch (err) {
    console.error('Error loading initial data:', err);
  }
}

function populateProfile(profile) {
  if (!profile) return;
  document.getElementById('headerCandidateName').textContent = profile.personal.fullName;
  document.getElementById('profFullName').value = profile.personal.fullName || '';
  document.getElementById('profEmail').value = profile.personal.email || '';
  document.getElementById('profPhone').value = profile.personal.phone || '';
  document.getElementById('profCity').value = profile.personal.location.city || '';
  document.getElementById('profState').value = profile.personal.location.state || '';
  document.getElementById('profSalary').value = profile.compensation.expectedSalaryAnnual || 95000;
  document.getElementById('profCoverLetter').value = profile.coverLetter || '';

  document.getElementById('profAuthUS').value = String(profile.workAuthorization.legallyAuthorizedInUS);
  document.getElementById('profSponsorship').value = String(profile.workAuthorization.requireSponsorship);
  document.getElementById('profBackground').value = String(profile.workAuthorization.passBackgroundCheck);
  document.getElementById('profDrugTest').value = String(profile.workAuthorization.passDrugScreen);
  document.getElementById('profDriversLic').value = String(profile.workAuthorization.hasDriversLicense);
}

function populateCriteria(criteria) {
  if (!criteria) return;
  document.getElementById('criteriaTitles').value = (criteria.targetTitles || []).join('\n');
  document.getElementById('criteriaLocations').value = (criteria.locations || []).join('\n');
  document.getElementById('criteriaBlacklist').value = (criteria.blacklistCompanies || []).join('\n');
  document.getElementById('criteriaNegative').value = (criteria.negativeKeywords || []).join('\n');
  document.getElementById('criteriaMinScore').value = criteria.minimumMatchScore || 60;
  document.getElementById('criteriaMinScoreVal').textContent = `${criteria.minimumMatchScore || 60}%`;
  document.getElementById('criteriaEasyApplyOnly').checked = criteria.easyApplyOnly ?? true;
  document.getElementById('checkDryRun').checked = criteria.dryRun ?? false;
}

function updateStats(stats) {
  if (!stats) return;
  document.getElementById('statTotal').textContent = stats.total || 0;
  document.getElementById('statSubmitted').textContent = stats.submitted || 0;
  document.getElementById('statDryRun').textContent = stats.dryRun || 0;
  document.getElementById('statSkipped').textContent = stats.skipped || 0;
  document.getElementById('badgeAppCount').textContent = stats.total || 0;
}

function renderApplicationsTable() {
  const tbody = document.getElementById('applicationsTableBody');
  tbody.innerHTML = '';

  if (applications.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-slate-500">No applications recorded yet. Start the agent to apply!</td></tr>`;
    return;
  }

  applications.forEach(app => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-900/60 transition';

    let badgeClass = 'badge-submitted';
    if (app.status === 'DRY_RUN_COMPLETED') badgeClass = 'badge-dryrun';
    if (app.status === 'FAILED') badgeClass = 'badge-failed';
    if (app.status === 'SKIPPED') badgeClass = 'badge-skipped';

    const formattedDate = app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() + ' ' + new Date(app.appliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';

    tr.innerHTML = `
      <td class="px-6 py-3 font-semibold text-white">
        <a href="${app.url}" target="_blank" class="hover:text-blue-400 hover:underline flex items-center space-x-1">
          <span>${escapeHtml(app.title)}</span>
          <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-500"></i>
        </a>
      </td>
      <td class="px-6 py-3 text-slate-300">${escapeHtml(app.company)}</td>
      <td class="px-6 py-3 text-slate-400">${escapeHtml(app.location)}</td>
      <td class="px-6 py-3 uppercase text-[11px] font-bold text-slate-400">${escapeHtml(app.board || 'indeed')}</td>
      <td class="px-6 py-3">
        <span class="font-mono font-bold text-blue-400">${app.matchScore || 0}%</span>
      </td>
      <td class="px-6 py-3">
        <span class="px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${badgeClass}">${app.status}</span>
      </td>
      <td class="px-6 py-3 text-slate-400 text-[11px]">${formattedDate}</td>
      <td class="px-6 py-3">
        ${app.screenshot ? `<button onclick="viewScreenshot('${app.screenshot}')" class="text-blue-400 hover:text-blue-300 text-xs flex items-center space-x-1"><i class="fa-solid fa-image"></i><span>Proof</span></button>` : `<span class="text-slate-600">-</span>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function refreshApplications() {
  try {
    const res = await fetch('/api/applications');
    const data = await res.json();
    applications = data.applications || [];
    updateStats(data.stats);
    renderApplicationsTable();
  } catch (e) {}
}

function bindEvents() {
  document.getElementById('btnStart').addEventListener('click', async () => {
    const isCloud = window.location.hostname.includes('github.io');
    if (isCloud) {
      alert('You are viewing the dashboard on GitHub Pages (Preview Mode).\n\nTo run autonomous browser applications with your authenticated Chrome profile:\n1. Open the project on your PC.\n2. Double-click "start.bat" or run "npm start".\n3. Click "Start Applying" in the local dashboard at http://localhost:3000.');
      return;
    }

    const board = document.getElementById('selectBoard').value;
    const dryRun = document.getElementById('checkDryRun').checked;
    const maxApplications = parseInt(document.getElementById('inputMaxApps').value, 10) || 20;

    appendLog(`Initiating agent run (Board: ${board.toUpperCase()}, Dry-Run: ${dryRun}, Max: ${maxApplications})...`, 'info');

    try {
      const res = await fetch('/api/agent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, dryRun, maxApplications })
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Failed to start agent');
    } catch (err) {
      alert('Error triggering start: ' + err.message);
    }
  });

  document.getElementById('btnPause').addEventListener('click', async () => {
    const btn = document.getElementById('btnPause');
    const isPaused = btn.innerText.includes('Resume');
    const endpoint = isPaused ? '/api/agent/resume' : '/api/agent/pause';
    await fetch(endpoint, { method: 'POST' });
  });

  document.getElementById('btnStop').addEventListener('click', async () => {
    if (confirm('Are you sure you want to stop the autonomous agent?')) {
      await fetch('/api/agent/stop', { method: 'POST' });
    }
  });

  document.getElementById('btnClearLogs').addEventListener('click', () => {
    document.getElementById('logConsole').innerHTML = '';
  });

  document.getElementById('btnRefreshApps').addEventListener('click', refreshApplications);

  document.getElementById('criteriaMinScore').addEventListener('input', (e) => {
    document.getElementById('criteriaMinScoreVal').textContent = `${e.target.value}%`;
  });

  // Save Profile
  document.getElementById('btnSaveProfile').addEventListener('click', async () => {
    const btn = document.getElementById('btnSaveProfile');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';

    const updated = {
      personal: {
        ...(currentProfile?.personal || {}),
        fullName: document.getElementById('profFullName').value,
        email: document.getElementById('profEmail').value,
        phone: document.getElementById('profPhone').value,
        location: {
          ...(currentProfile?.personal?.location || {}),
          city: document.getElementById('profCity').value,
          state: document.getElementById('profState').value
        }
      },
      workAuthorization: {
        ...(currentProfile?.workAuthorization || {}),
        legallyAuthorizedInUS: document.getElementById('profAuthUS').value === 'true',
        requireSponsorship: document.getElementById('profSponsorship').value === 'true',
        passBackgroundCheck: document.getElementById('profBackground').value === 'true',
        passDrugScreen: document.getElementById('profDrugTest').value === 'true',
        hasDriversLicense: document.getElementById('profDriversLic').value === 'true'
      },
      compensation: {
        ...(currentProfile?.compensation || {}),
        expectedSalaryAnnual: parseInt(document.getElementById('profSalary').value, 10) || 95000
      },
      coverLetter: document.getElementById('profCoverLetter').value
    };

    const isCloud = window.location.hostname.includes('github.io');
    localStorage.setItem('job_agent_profile', JSON.stringify(updated));
    currentProfile = updated;

    if (isCloud) {
      btn.className = 'px-3 py-1 bg-emerald-600 rounded text-xs text-white font-medium transition';
      btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Saved!';
      showToast('Candidate profile saved to browser storage!');
      setTimeout(() => {
        btn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-medium transition';
        btn.innerHTML = originalText;
      }, 2500);
      return;
    }

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        btn.className = 'px-3 py-1 bg-emerald-600 rounded text-xs text-white font-medium transition';
        btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Saved!';
        showToast('Profile and ATS answers saved to local config!');
        loadData();
      } else {
        showToast('Server returned error saving profile', 'error');
      }
    } catch (e) {
      showToast('Error connecting to local server: ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        btn.className = 'px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs text-white font-medium transition';
        btn.innerHTML = originalText;
      }, 2500);
    }
  });

  // Save Criteria
  document.getElementById('btnSaveCriteria').addEventListener('click', async () => {
    const btn = document.getElementById('btnSaveCriteria');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';

    const updated = {
      ...(currentCriteria || {}),
      targetTitles: document.getElementById('criteriaTitles').value.split('\n').map(s => s.trim()).filter(Boolean),
      locations: document.getElementById('criteriaLocations').value.split('\n').map(s => s.trim()).filter(Boolean),
      blacklistCompanies: document.getElementById('criteriaBlacklist').value.split('\n').map(s => s.trim()).filter(Boolean),
      negativeKeywords: document.getElementById('criteriaNegative').value.split('\n').map(s => s.trim()).filter(Boolean),
      minimumMatchScore: parseInt(document.getElementById('criteriaMinScore').value, 10) || 60,
      easyApplyOnly: document.getElementById('criteriaEasyApplyOnly').checked
    };

    const isCloud = window.location.hostname.includes('github.io');
    localStorage.setItem('job_agent_criteria', JSON.stringify(updated));
    currentCriteria = updated;

    if (isCloud) {
      btn.className = 'px-4 py-2 bg-emerald-600 rounded-lg text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 transition';
      btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Saved!';
      showToast('Search criteria saved to browser storage!');
      setTimeout(() => {
        btn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white shadow-lg shadow-blue-600/20 transition';
        btn.innerHTML = originalText;
      }, 2500);
      return;
    }

    try {
      const res = await fetch('/api/criteria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        btn.className = 'px-4 py-2 bg-emerald-600 rounded-lg text-xs font-semibold text-white shadow-lg shadow-emerald-600/20 transition';
        btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Saved!';
        showToast('Search criteria saved to local disk!');
        loadData();
      } else {
        showToast('Server error while saving criteria', 'error');
      }
    } catch (e) {
      showToast('Error connecting to local server: ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        btn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white shadow-lg shadow-blue-600/20 transition';
        btn.innerHTML = originalText;
      }, 2500);
    }
  });

  // Modal close
  document.getElementById('modalScreenshotClose').addEventListener('click', () => {
    document.getElementById('modalScreenshot').classList.add('hidden');
    document.getElementById('modalScreenshot').classList.remove('flex');
  });
}

window.viewScreenshot = function(filePath) {
  const filename = filePath.split(/[\\/]/).pop();
  const url = `/screenshots/${filename}`;
  document.getElementById('modalScreenshotImg').src = url;
  const modal = document.getElementById('modalScreenshot');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
};
