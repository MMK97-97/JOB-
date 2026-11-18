// Frontend JavaScript for Autonomous Job Agent
let ws = null;
let currentProfile = null;
let currentCriteria = null;
let applications = [];

const SUPPLY_CHAIN_ROLES = [
  "Supply Chain Manager", "Supply Chain Analyst", "Supply Chain Specialist", "Supply Chain Coordinator", "Supply Chain Operations",
  "Demand Planner", "Demand Planning Analyst", "Demand & Inventory Planner", "S&OP Specialist",
  "Inventory Analyst", "Inventory Planner", "Inventory Specialist", "Inventory Control Specialist",
  "Procurement Specialist", "Procurement Manager", "Procurement Analyst", "Strategic Sourcing Specialist", "Sourcing Manager",
  "Purchasing Agent", "Purchasing Manager", "Purchasing Specialist", "Buyer", "Senior Buyer",
  "Materials Planner", "Materials Manager", "Logistics Coordinator", "Logistics Analyst", "Logistics Manager", "Inbound Logistics Specialist", "Operations Analyst"
];

const USA_STATES = [
  "United States", "Remote",
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming", "District of Columbia"
];

let selectedRoles = new Set();
let selectedLocations = new Set();

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initWebSocket();
  initMultiSelectFilters();
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
      if (data.state === 'PAUSED') {
        updateAgentStatus(true, true);
      } else if (data.state === 'RUNNING') {
        updateAgentStatus(true, false);
      } else {
        updateAgentStatus(false, false);
      }
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

    case 'question-prompt':
      appendLog(`❓ Employer question needs your answer: "${data.prompt}"`, 'warning');
      showQuestionPromptModal(data);
      break;

    case 'question-resolved':
      hideQuestionPromptModal();
      loadData();
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

  if (isPaused) {
    statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-amber-500';
    statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
    statusText.textContent = 'Paused';
    statusText.className = 'text-xs font-medium text-amber-400 uppercase tracking-wider';
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnPause.innerHTML = '<i class="fa-solid fa-play text-xs"></i><span>Resume</span>';
    btnStop.disabled = false;
  } else if (isRunning) {
    statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-emerald-500';
    statusPulse.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
    statusText.textContent = 'Running';
    statusText.className = 'text-xs font-medium text-emerald-400 uppercase tracking-wider';
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnPause.innerHTML = '<i class="fa-solid fa-pause text-xs"></i><span>Pause</span>';
    btnStop.disabled = false;
  } else {
    statusDot.className = 'relative inline-flex rounded-full h-3 w-3 bg-slate-500';
    statusPulse.className = 'absolute inline-flex h-full w-full rounded-full bg-slate-400 opacity-0';
    statusText.textContent = 'Ready';
    statusText.className = 'text-xs font-medium text-slate-300 uppercase tracking-wider';
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnPause.innerHTML = '<i class="fa-solid fa-pause text-xs"></i><span>Pause</span>';
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
  const p = profile.personal || {};
  const w = profile.workAuthorization || {};
  const c = profile.compensation || {};
  const e = profile.eeo || {};
  const s = profile.screeningAnswers || {};

  document.getElementById('headerCandidateName').textContent = p.fullName || 'Manoj Kumar Manne';
  document.getElementById('profFullName').value = p.fullName || '';
  document.getElementById('profEmail').value = p.email || '';
  document.getElementById('profPhone').value = p.phone || '';
  document.getElementById('profCity').value = p.location?.city || '';
  document.getElementById('profState').value = p.location?.state || '';
  document.getElementById('profSalary').value = c.expectedSalaryAnnual || 95000;
  if (document.getElementById('profNoticePeriod')) {
    document.getElementById('profNoticePeriod').value = c.noticePeriod || s.notice_period || '2 weeks';
  }
  document.getElementById('profCoverLetter').value = profile.coverLetter || '';

  // Legal & Authorization
  document.getElementById('profAuthUS').value = String(w.legallyAuthorizedInUS ?? true);
  document.getElementById('profSponsorship').value = String(w.requireSponsorship ?? false);
  document.getElementById('profBackground').value = String(w.passBackgroundCheck ?? true);
  document.getElementById('profDrugTest').value = String(w.passDrugScreen ?? true);
  document.getElementById('profDriversLic').value = String(w.hasDriversLicense ?? true);

  // Recruiter Demographics & Voluntary Self-ID (EEO)
  if (document.getElementById('profGender')) document.getElementById('profGender').value = e.gender || 'Male';
  if (document.getElementById('profPronouns')) document.getElementById('profPronouns').value = e.pronouns || 'He/Him';
  if (document.getElementById('profRace')) document.getElementById('profRace').value = e.raceEthnicity || 'Asian';
  if (document.getElementById('profHispanic')) document.getElementById('profHispanic').value = e.hispanicLatino || 'No';
  if (document.getElementById('profVeteran')) document.getElementById('profVeteran').value = e.veteranStatus || 'I am not a protected veteran';
  if (document.getElementById('profDisability')) document.getElementById('profDisability').value = e.disabilityStatus || 'No, I do not have a disability';

  // Role Experience & Work Habit Answers
  if (document.getElementById('profAutoParts')) document.getElementById('profAutoParts').value = s.automotive_parts || 'Yes';
  if (document.getElementById('profOvertime')) document.getElementById('profOvertime').value = s.overtime_daily || 'Yes';
  if (document.getElementById('profRelocate')) document.getElementById('profRelocate').value = s.relocate || (w.willingToRelocate ? 'Yes' : 'No');
  if (document.getElementById('profCommute')) document.getElementById('profCommute').value = s.commute_ok || 'Yes';
  if (document.getElementById('profEducation')) document.getElementById('profEducation').value = s.highest_education || profile.education?.highestLevel || "Master's Degree";
  if (document.getElementById('profExpYears')) document.getElementById('profExpYears').value = s.default_experience_years || 5;

  renderLearnedQuestions(profile.customAnswers || {});
}

let currentPendingQuestion = null;

function showQuestionPromptModal(data) {
  currentPendingQuestion = data;
  const modal = document.getElementById('modalQuestionPrompt');
  if (!modal) return;

  document.getElementById('promptJobSubtitle').textContent = data.job
    ? `Applying for "${data.job.title}" at "${data.job.company}"`
    : 'Active Job Application';
  document.getElementById('promptQuestionText').textContent = data.prompt;

  const container = document.getElementById('promptInputArea');
  container.innerHTML = '';

  const options = data.options || [];
  if (options.length > 0) {
    options.forEach((opt, idx) => {
      const optVal = typeof opt === 'object' ? (opt.text || opt.value) : opt;
      const isChecked = idx === 0 || optVal.toLowerCase() === 'yes';
      const row = document.createElement('label');
      row.className = 'flex items-center space-x-3 p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-blue-500/50 cursor-pointer transition';
      row.innerHTML = `
        <input type="radio" name="userPromptChoice" value="${escapeHtml(optVal)}" ${isChecked ? 'checked' : ''} class="text-blue-600 bg-slate-900 border-slate-700 focus:ring-0">
        <span class="text-xs text-white font-medium">${escapeHtml(optVal)}</span>
      `;
      container.appendChild(row);
    });
  } else if (data.type === 'number') {
    container.innerHTML = `
      <input type="number" id="userPromptInputVal" value="${escapeHtml(data.defaultAnswer || '5')}" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-blue-500">
    `;
  } else if (data.type === 'textarea') {
    container.innerHTML = `
      <textarea id="userPromptInputVal" rows="4" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-blue-500">${escapeHtml(data.defaultAnswer || '')}</textarea>
    `;
  } else {
    container.innerHTML = `
      <input type="text" id="userPromptInputVal" value="${escapeHtml(data.defaultAnswer || 'Yes')}" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-white text-xs focus:outline-none focus:border-blue-500">
    `;
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function hideQuestionPromptModal() {
  currentPendingQuestion = null;
  const modal = document.getElementById('modalQuestionPrompt');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function renderLearnedQuestions(customAnswers = {}) {
  const container = document.getElementById('learnedQuestionsContainer');
  if (!container) return;
  container.innerHTML = '';

  const entries = Object.entries(customAnswers || {});
  if (entries.length === 0) {
    container.innerHTML = `
      <div class="p-3.5 rounded-lg bg-slate-950 border border-slate-800/80 text-xs text-slate-400 italic text-center">
        No custom learned questions yet. Questions asked by employers will appear and save here automatically.
      </div>
    `;
    return;
  }

  entries.forEach(([key, item]) => {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 transition text-xs';
    row.innerHTML = `
      <div class="space-y-1 pr-4">
        <p class="font-medium text-white">${escapeHtml(item.prompt || key)}</p>
        <div class="flex items-center space-x-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Answer: ${escapeHtml(item.answer)}
          </span>
          <span class="text-[10px] text-slate-500">Saved: ${item.savedAt ? new Date(item.savedAt).toLocaleDateString() : 'Active'}</span>
        </div>
      </div>
      <button onclick="removeCustomAnswer('${escapeHtml(key)}')" class="text-slate-500 hover:text-rose-400 text-xs px-2.5 py-1.5 rounded hover:bg-slate-900 transition" title="Delete remembered answer">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;
    container.appendChild(row);
  });
}

window.removeCustomAnswer = async function(key) {
  if (!confirm('Remove this saved question answer from candidate memory?')) return;
  try {
    await fetch(`/api/custom-answers/${encodeURIComponent(key)}`, { method: 'DELETE' });
    showToast('Question removed from candidate memory.');
    loadData();
  } catch (e) {
    console.error(e);
  }
};

function initMultiSelectFilters() {
  const btnRole = document.getElementById('btnRoleDropdown');
  const menuRole = document.getElementById('roleDropdownMenu');
  const btnCloseRole = document.getElementById('btnCloseRoleDropdown');
  const searchRole = document.getElementById('roleSearchInput');
  const btnSelectAllRoles = document.getElementById('btnSelectAllRoles');
  const btnClearAllRoles = document.getElementById('btnClearAllRoles');

  const btnLoc = document.getElementById('btnLocationDropdown');
  const menuLoc = document.getElementById('locationDropdownMenu');
  const btnCloseLoc = document.getElementById('btnCloseLocationDropdown');
  const searchLoc = document.getElementById('locationSearchInput');
  const btnSelectAllStates = document.getElementById('btnSelectAllStates');
  const btnSelectRemote = document.getElementById('btnSelectRemoteOnly');
  const btnClearAllLoc = document.getElementById('btnClearAllLocations');

  // Toggle Role Menu
  btnRole.addEventListener('click', (e) => {
    e.stopPropagation();
    menuRole.classList.toggle('hidden');
    menuLoc.classList.add('hidden');
    if (!menuRole.classList.contains('hidden')) searchRole.focus();
  });

  // Toggle Location Menu
  btnLoc.addEventListener('click', (e) => {
    e.stopPropagation();
    menuLoc.classList.toggle('hidden');
    menuRole.classList.add('hidden');
    if (!menuLoc.classList.contains('hidden')) searchLoc.focus();
  });

  // Close buttons (Done)
  btnCloseRole.addEventListener('click', (e) => {
    e.stopPropagation();
    menuRole.classList.add('hidden');
  });

  btnCloseLoc.addEventListener('click', (e) => {
    e.stopPropagation();
    menuLoc.classList.add('hidden');
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (!menuRole.contains(e.target) && !btnRole.contains(e.target)) {
      menuRole.classList.add('hidden');
    }
    if (!menuLoc.contains(e.target) && !btnLoc.contains(e.target)) {
      menuLoc.classList.add('hidden');
    }
  });

  // Prevent click inside menu from closing
  menuRole.addEventListener('click', (e) => e.stopPropagation());
  menuLoc.addEventListener('click', (e) => e.stopPropagation());

  // Role Search
  searchRole.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.role-check-item').forEach(item => {
      const text = item.getAttribute('data-name').toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  // Location Search
  searchLoc.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.loc-check-item').forEach(item => {
      const text = item.getAttribute('data-name').toLowerCase();
      item.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  // Select All Roles
  btnSelectAllRoles.addEventListener('click', () => {
    SUPPLY_CHAIN_ROLES.forEach(r => selectedRoles.add(r));
    renderRolesCheckboxes();
    updateRoleChips();
  });

  // Clear All Roles
  btnClearAllRoles.addEventListener('click', () => {
    selectedRoles.clear();
    renderRolesCheckboxes();
    updateRoleChips();
  });

  // Select All States
  btnSelectAllStates.addEventListener('click', () => {
    USA_STATES.forEach(s => selectedLocations.add(s));
    renderLocationsCheckboxes();
    updateLocationChips();
  });

  // Select Remote Only
  btnSelectRemote.addEventListener('click', () => {
    selectedLocations.clear();
    selectedLocations.add('Remote');
    selectedLocations.add('United States');
    renderLocationsCheckboxes();
    updateLocationChips();
  });

  // Clear All Locations
  btnClearAllLoc.addEventListener('click', () => {
    selectedLocations.clear();
    renderLocationsCheckboxes();
    updateLocationChips();
  });
}

function renderRolesCheckboxes() {
  const container = document.getElementById('rolesCheckboxContainer');
  if (!container) return;
  container.innerHTML = '';

  SUPPLY_CHAIN_ROLES.forEach(role => {
    const isChecked = selectedRoles.has(role);
    const row = document.createElement('label');
    row.className = 'role-check-item flex items-center space-x-2 p-1.5 rounded hover:bg-slate-800/80 cursor-pointer text-slate-300 text-xs select-none';
    row.setAttribute('data-name', role);
    row.innerHTML = `
      <input type="checkbox" value="${escapeHtml(role)}" ${isChecked ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-blue-600 bg-slate-950 border-slate-700 focus:ring-blue-500">
      <span class="truncate">${escapeHtml(role)}</span>
    `;

    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedRoles.add(role);
      } else {
        selectedRoles.delete(role);
      }
      updateRoleChips();
    });

    container.appendChild(row);
  });
}

function renderLocationsCheckboxes() {
  const container = document.getElementById('locationsCheckboxContainer');
  if (!container) return;
  container.innerHTML = '';

  USA_STATES.forEach(loc => {
    const isChecked = selectedLocations.has(loc);
    const row = document.createElement('label');
    row.className = 'loc-check-item flex items-center space-x-2 p-1.5 rounded hover:bg-slate-800/80 cursor-pointer text-slate-300 text-xs select-none';
    row.setAttribute('data-name', loc);
    row.innerHTML = `
      <input type="checkbox" value="${escapeHtml(loc)}" ${isChecked ? 'checked' : ''} class="w-3.5 h-3.5 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500">
      <span class="truncate">${escapeHtml(loc)}</span>
    `;

    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        selectedLocations.add(loc);
      } else {
        selectedLocations.delete(loc);
      }
      updateLocationChips();
    });

    container.appendChild(row);
  });
}

function updateRoleChips() {
  const chipsContainer = document.getElementById('roleChipsContainer');
  const countBadge = document.getElementById('roleCountBadge');
  const selectedText = document.getElementById('roleSelectedText');
  const hiddenTextarea = document.getElementById('criteriaTitles');

  const count = selectedRoles.size;
  countBadge.textContent = `${count} selected`;
  selectedText.textContent = count === 0 ? 'Select Supply Chain Roles...' : (count === SUPPLY_CHAIN_ROLES.length ? 'All Supply Chain Roles Selected' : `${count} Roles Selected`);
  hiddenTextarea.value = Array.from(selectedRoles).join('\n');

  chipsContainer.innerHTML = '';
  selectedRoles.forEach(role => {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px]';
    chip.innerHTML = `
      <span class="truncate max-w-[130px]">${escapeHtml(role)}</span>
      <button type="button" class="text-blue-400 hover:text-white ml-1">&times;</button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      selectedRoles.delete(role);
      renderRolesCheckboxes();
      updateRoleChips();
    });
    chipsContainer.appendChild(chip);
  });
}

function updateLocationChips() {
  const chipsContainer = document.getElementById('locationChipsContainer');
  const countBadge = document.getElementById('locationCountBadge');
  const selectedText = document.getElementById('locationSelectedText');
  const hiddenTextarea = document.getElementById('criteriaLocations');

  const count = selectedLocations.size;
  countBadge.textContent = `${count} selected`;
  selectedText.textContent = count === 0 ? 'Select USA States / Remote...' : (count === USA_STATES.length ? 'All USA States Selected (Nationwide)' : `${count} Locations Selected`);
  hiddenTextarea.value = Array.from(selectedLocations).join('\n');

  chipsContainer.innerHTML = '';
  selectedLocations.forEach(loc => {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[10px]';
    chip.innerHTML = `
      <span class="truncate max-w-[120px]">${escapeHtml(loc)}</span>
      <button type="button" class="text-indigo-400 hover:text-white ml-1">&times;</button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      selectedLocations.delete(loc);
      renderLocationsCheckboxes();
      updateLocationChips();
    });
    chipsContainer.appendChild(chip);
  });
}

function populateCriteria(criteria) {
  if (!criteria) return;

  selectedRoles = new Set((criteria.targetTitles || []).filter(Boolean));
  if (selectedRoles.size === 0) {
    SUPPLY_CHAIN_ROLES.forEach(r => selectedRoles.add(r));
  }

  selectedLocations = new Set((criteria.locations || []).filter(Boolean));
  if (selectedLocations.size === 0) {
    USA_STATES.forEach(s => selectedLocations.add(s));
  }

  renderRolesCheckboxes();
  renderLocationsCheckboxes();
  updateRoleChips();
  updateLocationChips();

  document.getElementById('criteriaBlacklist').value = (criteria.blacklistCompanies || []).join('\n');
  document.getElementById('criteriaNegative').value = (criteria.negativeKeywords || []).join('\n');
  document.getElementById('criteriaMinScore').value = Math.min(criteria.minimumMatchScore || 30, 40);
  document.getElementById('criteriaMinScoreVal').textContent = `${Math.min(criteria.minimumMatchScore || 30, 40)}%`;
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
    const isCurrentlyPaused = btn.innerText.includes('Resume');
    const endpoint = isCurrentlyPaused ? '/api/agent/resume' : '/api/agent/pause';
    // Immediate visual feedback
    updateAgentStatus(true, !isCurrentlyPaused);
    try {
      await fetch(endpoint, { method: 'POST' });
    } catch (e) {
      console.error('Pause/Resume API error:', e);
    }
  });

  document.getElementById('btnStop').addEventListener('click', async () => {
    // Immediate visual feedback
    updateAgentStatus(false, false);
    appendLog('Stop requested by user. Terminating active tasks...', 'warning');
    try {
      await fetch('/api/agent/stop', { method: 'POST' });
    } catch (e) {
      console.error('Stop API error:', e);
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
      ...(currentProfile || {}),
      personal: {
        ...(currentProfile?.personal || {}),
        fullName: document.getElementById('profFullName').value.trim(),
        email: document.getElementById('profEmail').value.trim(),
        phone: document.getElementById('profPhone').value.trim(),
        location: {
          ...(currentProfile?.personal?.location || {}),
          city: document.getElementById('profCity').value.trim(),
          state: document.getElementById('profState').value.trim()
        }
      },
      workAuthorization: {
        ...(currentProfile?.workAuthorization || {}),
        legallyAuthorizedInUS: document.getElementById('profAuthUS').value === 'true',
        requireSponsorship: document.getElementById('profSponsorship').value === 'true',
        passBackgroundCheck: document.getElementById('profBackground').value === 'true',
        passDrugScreen: document.getElementById('profDrugTest').value === 'true',
        hasDriversLicense: document.getElementById('profDriversLic').value === 'true',
        willingToRelocate: document.getElementById('profRelocate') ? document.getElementById('profRelocate').value === 'Yes' : true
      },
      compensation: {
        ...(currentProfile?.compensation || {}),
        expectedSalaryAnnual: parseInt(document.getElementById('profSalary').value, 10) || 95000,
        noticePeriod: document.getElementById('profNoticePeriod') ? document.getElementById('profNoticePeriod').value : '2 weeks'
      },
      eeo: {
        ...(currentProfile?.eeo || {}),
        gender: document.getElementById('profGender') ? document.getElementById('profGender').value : 'Male',
        pronouns: document.getElementById('profPronouns') ? document.getElementById('profPronouns').value : 'He/Him',
        raceEthnicity: document.getElementById('profRace') ? document.getElementById('profRace').value : 'Asian',
        hispanicLatino: document.getElementById('profHispanic') ? document.getElementById('profHispanic').value : 'No',
        veteranStatus: document.getElementById('profVeteran') ? document.getElementById('profVeteran').value : 'I am not a protected veteran',
        disabilityStatus: document.getElementById('profDisability') ? document.getElementById('profDisability').value : 'No, I do not have a disability',
        lgbtq: currentProfile?.eeo?.lgbtq || 'Decline to specify'
      },
      screeningAnswers: {
        ...(currentProfile?.screeningAnswers || {}),
        automotive_parts: document.getElementById('profAutoParts') ? document.getElementById('profAutoParts').value : 'Yes',
        overtime_daily: document.getElementById('profOvertime') ? document.getElementById('profOvertime').value : 'Yes',
        relocate: document.getElementById('profRelocate') ? document.getElementById('profRelocate').value : 'Yes',
        commute_ok: document.getElementById('profCommute') ? document.getElementById('profCommute').value : 'Yes',
        highest_education: document.getElementById('profEducation') ? document.getElementById('profEducation').value : "Master's Degree",
        default_experience_years: parseInt(document.getElementById('profExpYears')?.value, 10) || 5,
        notice_period: document.getElementById('profNoticePeriod') ? document.getElementById('profNoticePeriod').value : '2 weeks',
        sponsorship: document.getElementById('profSponsorship').value === 'true' ? 'Yes' : 'No',
        authorized: document.getElementById('profAuthUS').value === 'true' ? 'Yes' : 'No',
        background_check: document.getElementById('profBackground').value === 'true' ? 'Yes' : 'No',
        drug_test: document.getElementById('profDrugTest').value === 'true' ? 'Yes' : 'No',
        drivers_license: document.getElementById('profDriversLic').value === 'true' ? 'Yes' : 'No'
      },
      coverLetter: document.getElementById('profCoverLetter').value
    };

    const isCloud = window.location.hostname.includes('github.io');
    localStorage.setItem('job_agent_profile', JSON.stringify(updated));
    currentProfile = updated;

    if (isCloud) {
      btn.className = 'px-5 py-2.5 bg-emerald-600 rounded-lg text-xs font-semibold text-white shadow-lg transition flex items-center space-x-2';
      btn.innerHTML = '<i class="fa-solid fa-check"></i><span>Saved to Browser!</span>';
      showToast('Candidate demographics & ATS screening answers saved to browser storage!');
      setTimeout(() => {
        btn.className = 'px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white shadow-lg shadow-blue-600/25 transition active:scale-95 flex items-center space-x-2';
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
        btn.className = 'px-5 py-2.5 bg-emerald-600 rounded-lg text-xs font-semibold text-white shadow-lg transition flex items-center space-x-2';
        btn.innerHTML = '<i class="fa-solid fa-check"></i><span>All Answers Saved!</span>';
        showToast('Candidate demographics & ATS screening answers saved successfully!');
        loadData();
      } else {
        showToast('Server returned error saving profile', 'error');
      }
    } catch (e) {
      showToast('Error connecting to local server: ' + e.message, 'error');
    } finally {
      setTimeout(() => {
        btn.className = 'px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold text-white shadow-lg shadow-blue-600/25 transition active:scale-95 flex items-center space-x-2';
        btn.innerHTML = originalText;
      }, 2500);
    }
  });

  // Save Criteria
  document.getElementById('btnSaveCriteria').addEventListener('click', async () => {
    // Automatically close open dropdown popups
    document.getElementById('roleDropdownMenu')?.classList.add('hidden');
    document.getElementById('locationDropdownMenu')?.classList.add('hidden');

    const btn = document.getElementById('btnSaveCriteria');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Saving...';

    const titles = Array.from(selectedRoles).length > 0
      ? Array.from(selectedRoles)
      : document.getElementById('criteriaTitles').value.split('\n').map(s => s.trim()).filter(Boolean);

    const locs = Array.from(selectedLocations).length > 0
      ? Array.from(selectedLocations)
      : document.getElementById('criteriaLocations').value.split('\n').map(s => s.trim()).filter(Boolean);

    const updated = {
      ...(currentCriteria || {}),
      targetTitles: titles,
      locations: locs,
      blacklistCompanies: document.getElementById('criteriaBlacklist').value.split('\n').map(s => s.trim()).filter(Boolean),
      negativeKeywords: document.getElementById('criteriaNegative').value.split('\n').map(s => s.trim()).filter(Boolean),
      minimumMatchScore: parseInt(document.getElementById('criteriaMinScore').value, 10) || 40,
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

  // Submit Answer to Interactive Prompt
  document.getElementById('btnSubmitUserAnswer').addEventListener('click', async () => {
    if (!currentPendingQuestion) return;
    let answer = 'Yes';
    const radio = document.querySelector('input[name="userPromptChoice"]:checked');
    if (radio) {
      answer = radio.value;
    } else {
      const valInput = document.getElementById('userPromptInputVal');
      if (valInput) answer = valInput.value.trim();
    }

    const remember = document.getElementById('promptRememberAnswer').checked;

    try {
      await fetch('/api/agent/answer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: currentPendingQuestion.questionId,
          prompt: currentPendingQuestion.prompt,
          answer,
          remember,
          type: currentPendingQuestion.type
        })
      });
      showToast(`Answer "${answer}" submitted! Copilot resuming application...`);
      hideQuestionPromptModal();
      loadData();
    } catch (e) {
      alert('Error sending answer: ' + e.message);
    }
  });

  // Add New Custom Question manually
  document.getElementById('btnAddNewCustomQuestion').addEventListener('click', async () => {
    const questionText = prompt('Enter the Employer Screening Question:');
    if (!questionText || !questionText.trim()) return;
    const answerText = prompt(`Enter your preferred answer for:\n"${questionText.trim()}"`, 'Yes');
    if (answerText === null) return;

    try {
      await fetch('/api/agent/answer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: 'manual_' + Date.now(),
          prompt: questionText.trim(),
          answer: answerText.trim(),
          remember: true,
          type: 'text'
        })
      });
      showToast('Custom question & answer saved to candidate memory!');
      loadData();
    } catch (e) {
      alert('Error saving answer: ' + e.message);
    }
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
