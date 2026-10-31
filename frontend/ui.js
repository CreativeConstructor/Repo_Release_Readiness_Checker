/**
 * Frontend UI Controller (Vanilla JavaScript)
 *
 * Interacts with:
 *  - /api/auth/login and /api/auth/register
 *  - /api/check (sync) and /api/check/async (BullMQ background queue)
 *  - /api/check/jobs/:jobId (polling async status)
 *  - /api/check/history and /api/check/:id
 */

let authToken = localStorage.getItem('readiness_token') || null;
let currentUsername = localStorage.getItem('readiness_user') || null;
let isRegisterMode = false;
let pollingInterval = null;

// DOM Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const userBadge = document.getElementById('user-badge');
const userDisplay = document.getElementById('user-display');
const logoutBtn = document.getElementById('logout-btn');

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('username');
const emailGroup = document.getElementById('email-group');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authAlert = document.getElementById('auth-alert');

const checkForm = document.getElementById('check-form');
const repoUrlInput = document.getElementById('repo-url');
const forceCheckInput = document.getElementById('force-check');
const asyncModeInput = document.getElementById('async-mode');
const submitCheckBtn = document.getElementById('submit-check-btn');
const btnText = document.getElementById('btn-text');
const btnSpinner = document.getElementById('btn-spinner');
const checkAlert = document.getElementById('check-alert');

const jobStatusCard = document.getElementById('job-status-card');
const jobStatusBadge = document.getElementById('job-status-badge');
const jobInfoText = document.getElementById('job-info-text');

const resultCard = document.getElementById('result-card');
const resultRepoName = document.getElementById('result-repo-name');
const resultHeadSha = document.getElementById('result-head-sha');
const resultDate = document.getElementById('result-date');
const resultCacheBadge = document.getElementById('result-cache-badge');
const resultScoreNumber = document.getElementById('result-score-number');
const resultVerdictBadge = document.getElementById('result-verdict-badge');
const resultSummaryText = document.getElementById('result-summary-text');
const breakdownTbody = document.getElementById('breakdown-tbody');
const risksList = document.getElementById('risks-list');
const recommendationsList = document.getElementById('recommendations-list');

const historyTbody = document.getElementById('history-tbody');
const historyPagination = document.getElementById('history-pagination');
const filterVerdict = document.getElementById('filter-verdict');
const filterRepo = document.getElementById('filter-repo');
const refreshHistoryBtn = document.getElementById('refresh-history-btn');

// --- Helper Functions ---

function showAlert(elem, message, type = 'error') {
  elem.textContent = message;
  elem.className = `alert alert-${type}`;
  elem.classList.remove('hidden');
}

function hideAlert(elem) {
  elem.classList.add('hidden');
}

function createCell(text, tagName = 'td') {
  const cell = document.createElement(tagName);
  cell.textContent = text == null ? '' : String(text);
  return cell;
}

function createBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`;
  badge.textContent = text;
  return badge;
}

function showTableMessage(container, message, columnCount) {
  const row = document.createElement('tr');
  const cell = createCell(message);
  cell.colSpan = columnCount;
  cell.className = 'text-center';
  row.appendChild(cell);
  container.replaceChildren(row);
}

function setCheckLoading(loading) {
  if (loading) {
    submitCheckBtn.disabled = true;
    btnText.textContent = 'Analyzing...';
    btnSpinner.classList.remove('hidden');
  } else {
    submitCheckBtn.disabled = false;
    btnText.textContent = 'Run Readiness Check';
    btnSpinner.classList.add('hidden');
  }
}

function updateAuthState() {
  if (authToken) {
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    userBadge.classList.remove('hidden');
    userDisplay.textContent = `Signed in as ${currentUsername || 'User'}`;
    loadHistory(1);
  } else {
    authSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    userBadge.classList.add('hidden');
  }
}

// --- Auth Handling ---

tabLogin.addEventListener('click', () => {
  isRegisterMode = false;
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  emailGroup.classList.add('hidden');
  authSubmitBtn.textContent = 'Sign In';
  hideAlert(authAlert);
});

tabRegister.addEventListener('click', () => {
  isRegisterMode = true;
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  emailGroup.classList.remove('hidden');
  authSubmitBtn.textContent = 'Create Account';
  hideAlert(authAlert);
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(authAlert);

  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const email = emailInput.value.trim();

  const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';
  const body = isRegisterMode ? { username, password, ...(email ? { email } : {}) } : { username, password };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error?.message || data.message || 'Authentication failed');
    }

    if (isRegisterMode) {
      // Account created, switch to login
      tabLogin.click();
      showAlert(authAlert, 'Account created! Please sign in with your credentials.', 'success');
    } else {
      authToken = data.data.token;
      currentUsername = data.data.user.username;
      localStorage.setItem('readiness_token', authToken);
      localStorage.setItem('readiness_user', currentUsername);
      updateAuthState();
    }
  } catch (err) {
    showAlert(authAlert, err.message, 'error');
  }
});

logoutBtn.addEventListener('click', () => {
  authToken = null;
  currentUsername = null;
  localStorage.removeItem('readiness_token');
  localStorage.removeItem('readiness_user');
  if (pollingInterval) clearInterval(pollingInterval);
  updateAuthState();
});

// --- Report Rendering ---

function renderReport(data) {
  resultCard.classList.remove('hidden');
  jobStatusCard.classList.add('hidden');

  resultRepoName.textContent = data.repoName || data.repo_name || 'Repository';
  resultHeadSha.textContent = (data.headSha || data.head_sha || '').slice(0, 7) || 'N/A';
  resultDate.textContent = new Date(data.createdAt || data.created_at || Date.now()).toLocaleString();

  if (data.cached) {
    resultCacheBadge.classList.remove('hidden');
  } else {
    resultCacheBadge.classList.add('hidden');
  }

  const score = data.ruleScore ?? data.rule_score ?? data.score ?? 0;
  resultScoreNumber.textContent = score;

  const verdict = data.verdict || 'not_ready';
  resultVerdictBadge.textContent = verdict.replace('_', ' ');
  resultVerdictBadge.className = `badge verdict-badge badge-${verdict}`;

  const report = data.report || {};
  resultSummaryText.textContent = report.summary || 'Analysis complete.';

  // Breakdown table
  breakdownTbody.replaceChildren();
  const breakdown = data.checkerBreakdown || data.checker_results || data.checkerResults || [];
  const displayBreakdown = data.checkerBreakdown || breakdown.map((c) => ({
    name: c.name,
    score: c.score,
    weight: '-',
    passed: c.passed,
  }));

  displayBreakdown.forEach((item) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = item.name || item.checkerId || 'Checker';
    name.appendChild(strong);
    tr.append(name, createCell(`${item.score}/100`));
    tr.appendChild(createCell(item.weight ? `${item.weight * 100}%` : '-'));
    const status = document.createElement('td');
    status.appendChild(createBadge(item.passed ? 'PASS' : 'FAIL', item.passed ? 'badge-success' : 'badge-danger'));
    tr.appendChild(status);
    breakdownTbody.appendChild(tr);
  });

  // Risks list
  risksList.replaceChildren();
  const risks = report.risks || [];
  if (risks.length === 0) {
    const li = document.createElement('li');
    const empty = document.createElement('em');
    empty.textContent = 'No critical risks detected.';
    li.appendChild(empty);
    risksList.appendChild(li);
  } else {
    risks.forEach((r) => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.append(document.createTextNode(`${r.title || 'Risk'} `));
      title.appendChild(createBadge(r.severity || 'risk', 'badge-danger'));
      const explanation = document.createElement('p');
      explanation.textContent = r.explanation || r.description || '';
      li.append(title, explanation);
      if (r.evidenceFilePaths?.length) {
        const evidence = document.createElement('span');
        evidence.className = 'evidence-tag';
        evidence.textContent = `Evidence: ${r.evidenceFilePaths.join(', ')}`;
        li.appendChild(evidence);
      }
      risksList.appendChild(li);
    });
  }

  // Recommendations list
  recommendationsList.replaceChildren();
  const recs = report.recommendations || [];
  if (recs.length === 0) {
    const li = document.createElement('li');
    const empty = document.createElement('em');
    empty.textContent = 'No additional recommendations at this time.';
    li.appendChild(empty);
    recommendationsList.appendChild(li);
  } else {
    recs.forEach((rec) => {
      const li = document.createElement('li');
      const title = document.createElement('strong');
      title.append(document.createTextNode(`${rec.title || 'Recommendation'} `));
      title.appendChild(createBadge(rec.priority || 'recommendation', 'badge-info'));
      const action = document.createElement('p');
      action.textContent = rec.action || rec.description || '';
      li.append(title, action);
      recommendationsList.appendChild(li);
    });
  }

  // Scroll to results
  resultCard.scrollIntoView({ behavior: 'smooth' });
}

// --- Check Execution (Sync & Async) ---

checkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert(checkAlert);

  const repoUrl = repoUrlInput.value.trim();
  const force = forceCheckInput.checked;
  const isAsync = asyncModeInput.checked;

  if (!repoUrl) return;

  setCheckLoading(true);

  if (isAsync) {
    // BullMQ Async Pipeline
    try {
      const res = await fetch('/api/check/async', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ repoUrl, force }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Failed to enqueue check');
      }

      setCheckLoading(false);
      startPollingJob(json.data.jobId);
    } catch (err) {
      setCheckLoading(false);
      showAlert(checkAlert, err.message, 'error');
    }
  } else {
    // Synchronous Pipeline
    try {
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ repoUrl, force }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || 'Analysis failed');
      }

      setCheckLoading(false);
      renderReport(json.data);
      loadHistory(1);
    } catch (err) {
      setCheckLoading(false);
      showAlert(checkAlert, err.message, 'error');
    }
  }
});

function startPollingJob(jobId) {
  jobStatusCard.classList.remove('hidden');
  resultCard.classList.add('hidden');
  jobStatusBadge.textContent = 'QUEUED';
  jobStatusBadge.className = 'badge badge-warning';
  jobInfoText.textContent = `Job ID ${jobId} is enqueued in BullMQ. Polling worker status...`;

  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/check/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        clearInterval(pollingInterval);
        jobStatusBadge.textContent = 'FAILED';
        jobStatusBadge.className = 'badge badge-danger';
        jobInfoText.textContent = json.error?.message || 'Failed to poll job status.';
        return;
      }

      const job = json.data;
      jobStatusBadge.textContent = job.status.toUpperCase();

      if (job.status === 'completed') {
        clearInterval(pollingInterval);
        jobStatusBadge.className = 'badge badge-success';
        if (job.result) {
          renderReport(job.result);
          loadHistory(1);
        }
      } else if (job.status === 'failed') {
        clearInterval(pollingInterval);
        jobStatusBadge.className = 'badge badge-danger';
        jobInfoText.textContent = `Job failed: ${job.failedReason || 'Unknown error'}`;
      } else {
        jobStatusBadge.className = 'badge badge-info';
        jobInfoText.textContent = `Job is currently ${job.status}...`;
      }
    } catch (err) {
      clearInterval(pollingInterval);
      jobInfoText.textContent = `Polling error: ${err.message}`;
    }
  }, 2000);
}

// --- History List & Single Report View ---

async function loadHistory(page = 1) {
  if (!authToken) return;

  const verdict = filterVerdict.value;
  const repo = filterRepo.value.trim();

  let url = `/api/check/history?page=${page}&limit=10`;
  if (verdict) url += `&verdict=${encodeURIComponent(verdict)}`;
  if (repo) url += `&repo=${encodeURIComponent(repo)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    const json = await res.json();
    if (!res.ok || !json.success) return;

    const { checks, pagination } = json.data;
    historyTbody.replaceChildren();

    if (!checks || checks.length === 0) {
      showTableMessage(historyTbody, 'No checks found.', 6);
      historyPagination.replaceChildren();
      return;
    }

    checks.forEach((item) => {
      const tr = document.createElement('tr');
      const repository = document.createElement('td');
      const repositoryName = document.createElement('strong');
      repositoryName.textContent = item.repoName || item.repoUrl || 'Repository';
      repository.appendChild(repositoryName);
      tr.appendChild(repository);
      tr.appendChild(createCell(`${item.ruleScore ?? item.score ?? '--'}/100`));
      const verdict = document.createElement('td');
      const verdictText = item.verdict || 'pending';
      const verdictClass = ['ready', 'needs_work', 'not_ready'].includes(verdictText)
        ? `badge-${verdictText}`
        : 'badge-info';
      verdict.appendChild(createBadge(verdictText, verdictClass));
      tr.appendChild(verdict);
      const sha = document.createElement('code');
      sha.textContent = (item.headSha || '').slice(0, 7) || '-';
      const shaCell = document.createElement('td');
      shaCell.appendChild(sha);
      tr.appendChild(shaCell);
      tr.appendChild(createCell(new Date(item.createdAt).toLocaleDateString()));
      const actionCell = document.createElement('td');
      const viewButton = document.createElement('button');
      viewButton.className = 'btn btn-outline btn-sm view-btn';
      viewButton.textContent = 'View Report';
      viewButton.addEventListener('click', () => viewCheckDetails(item.id));
      actionCell.appendChild(viewButton);
      tr.appendChild(actionCell);
      historyTbody.appendChild(tr);
    });

    // Pagination buttons
    historyPagination.replaceChildren();
    if (pagination.totalPages > 1) {
      for (let i = 1; i <= pagination.totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.className = `btn btn-sm ${i === pagination.page ? 'btn-primary' : 'btn-outline'}`;
        btn.addEventListener('click', () => loadHistory(i));
        historyPagination.appendChild(btn);
      }
    }

  } catch {
    showTableMessage(historyTbody, 'Error loading history.', 6);
  }
}

async function viewCheckDetails(checkId) {
  try {
    const res = await fetch(`/api/check/${checkId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      alert(json.error?.message || 'Failed to fetch check details');
      return;
    }

    renderReport(json.data);
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

filterVerdict.addEventListener('change', () => loadHistory(1));
filterRepo.addEventListener('input', () => loadHistory(1));
refreshHistoryBtn.addEventListener('click', () => loadHistory(1));

// Initialize on page load
updateAuthState();
