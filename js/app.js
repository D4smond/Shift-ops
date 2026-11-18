// app.js
// Everything to do with the page: sign in, rendering, buttons, localStorage.
// The algorithms themselves are in scheduling.js (window.Scheduling).

const S = window.Scheduling;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function money(n) {
  return '£' + Number(n || 0).toFixed(2);
}

// Anything a user typed goes through this before it goes into innerHTML.
// Before, a worker called <img src=x onerror=alert(1)> would have run code
// on the coordinator's screen.
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeLabel(s) {
  // adding T00:00 makes it parse as local time; on its own "2026-11-20" is
  // treated as UTC midnight and can show as the day before in some timezones
  const day = new Date(s.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  const overnight = s.end <= s.start ? ' (+1)' : '';
  return `${day} · ${s.start}–${s.end}${overnight}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function $(id) {
  return document.getElementById(id);
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

// ---------------------------------------------------------------------------
// Storage
// Everything lives in localStorage under one prefix. read() never throws, so
// one corrupted value can't stop the whole app from loading.
// ---------------------------------------------------------------------------

const KEY = {
  workers: 'shiftOpsWorkers',
  pool: 'shiftOpsPool',
  allocation: 'shiftOpsAllocation',
  listings: 'shiftOpsListings',
  requests: 'shiftOpsSwapRequests',
  profiles: 'shiftOpsProfiles',
  session: 'shiftOpsSession'
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.warn('Could not read ' + key + ', using default', err);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // usually means storage is full (big profile photos)
    showToast('Could not save — browser storage is full', 'error');
    return false;
  }
}

const loadWorkers = () => read(KEY.workers, []);
const saveWorkers = w => write(KEY.workers, w);
const loadPool = () => read(KEY.pool, []);
const savePool = p => write(KEY.pool, p);
const loadAllocation = () => read(KEY.allocation, null);
const saveAllocation = a => write(KEY.allocation, a);
const loadListings = () => read(KEY.listings, []);
const saveListings = l => write(KEY.listings, l);
const loadRequests = () => read(KEY.requests, []);
const saveRequests = r => write(KEY.requests, r);
const loadProfiles = () => read(KEY.profiles, {});
const saveProfiles = p => write(KEY.profiles, p);
const loadProfile = id => loadProfiles()[id] || { avatar: null, about: '' };

const soloKey = () => 'shiftOpsSolo_' + session.workerId;
const loadSolo = () => read(soloKey(), []);
const saveSolo = s => write(soloKey(), s);

function workerName(id) {
  const w = loadWorkers().find(w => w.id === id);
  return w ? w.name : 'Removed worker';
}

// A cheap fingerprint of the pool so we can tell the coordinator when the
// pool has changed since they last ran the allocation.
function poolSignature(pool) {
  return pool.map(s => s.id).sort().join('|');
}

// When shifts move between people, any listing or pending request that
// mentions them is now out of date. This tidies both up in one go.
function retireShifts(shiftIds) {
  const ids = new Set(shiftIds);
  saveListings(loadListings().filter(l => !ids.has(l.shiftId)));
  saveRequests(loadRequests().map(r =>
    r.status === 'pending' && (ids.has(r.fromShiftId) || ids.has(r.toShiftId))
      ? { ...r, status: 'expired' }
      : r
  ));
}

// ---------------------------------------------------------------------------
// Sign in / session
// ---------------------------------------------------------------------------

// Demo only — real auth would obviously happen on a server.
const CODES = { worker: 'WORKER123', coordinator: 'LEAD123' };

let session = null; // set at the bottom of the file from sessionStorage
let pendingRole = null;

function selectRole(role) {
  pendingRole = role;
  $('chooseWorker').classList.toggle('selected', role === 'worker');
  $('chooseCoordinator').classList.toggle('selected', role === 'coordinator');

  const picker = $('workerPicker');
  if (role === 'worker') {
    const workers = loadWorkers();
    $('workerSelect').innerHTML = workers.length === 0
      ? '<option value="">No workers on the roster yet — sign in as coordinator first</option>'
      : workers.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
    picker.style.display = 'block';
  } else {
    picker.style.display = 'none';
  }
  validateSignIn();
}

function validateSignIn() {
  const code = $('accessCode').value.trim().toUpperCase();
  const workerChosen = pendingRole !== 'worker' || Boolean($('workerSelect').value);
  $('signInBtn').disabled = !(pendingRole && code === CODES[pendingRole] && workerChosen);
}

function signIn() {
  if (pendingRole === 'worker') {
    const workerId = $('workerSelect').value;
    const worker = loadWorkers().find(w => w.id === workerId);
    if (!worker) return;
    session = { role: 'worker', workerId, name: worker.name };
  } else {
    session = { role: 'coordinator', name: 'Coordinator' };
  }
  // sessionStorage so each browser tab can be a different person, handy for
  // demoing worker and coordinator side by side
  sessionStorage.setItem(KEY.session, JSON.stringify(session));
  enterApp();
}

function signOut() {
  sessionStorage.removeItem(KEY.session);
  session = null;
  pendingRole = null;
  $('accessCode').value = '';
  $('workerPicker').style.display = 'none';
  $('chooseWorker').classList.remove('selected');
  $('chooseCoordinator').classList.remove('selected');
  $('signInBtn').disabled = true;
  $('appShell').style.display = 'none';
  $('loginGate').style.display = 'block';
}

function enterApp() {
  // if the coordinator removed this worker while they were signed in, kick
  // them back to the sign-in screen rather than showing a broken page
  if (session.role === 'worker' && !loadWorkers().some(w => w.id === session.workerId)) {
    signOut();
    showToast('That worker is no longer on the roster', 'error');
    return;
  }

  const isWorker = session.role === 'worker';
  $('loginGate').style.display = 'none';
  $('appShell').style.display = 'block';
  $('sessionRoleTag').textContent = isWorker ? 'Worker' : 'Coordinator';
  $('sessionName').textContent = isWorker ? session.name : 'Full team access';
  $('profileTabBtn').style.display = isWorker ? 'inline-block' : 'none';

  $('workerShiftsView').style.display = isWorker ? 'block' : 'none';
  $('coordShiftsView').style.display = isWorker ? 'none' : 'block';
  $('workerSwapView').style.display = isWorker ? 'block' : 'none';
  $('coordSwapView').style.display = isWorker ? 'none' : 'block';

  updateSessionAvatar();
  setTab('shifts'); // always land on Shifts, otherwise a coordinator could end up on the worker-only Profile tab
  renderAll();
}

function updateSessionAvatar() {
  const img = $('sessionAvatar');
  const avatar = session.role === 'worker' ? loadProfile(session.workerId).avatar : null;
  img.style.display = avatar ? 'inline-block' : 'none';
  if (avatar) img.src = avatar;
}

function renderAll() {
  if (!session) return;
  if (session.role === 'worker') {
    renderSolo();
    renderWorkerAssigned();
    renderListShifts();
    renderSwapBoard();
    renderMyRequests();
    renderProfile();
  } else {
    renderWorkers();
    renderPool();
    renderAllocation();
    renderSwapSuggestions();
    renderPendingRequests();
  }
}

// If another tab changes the data (e.g. coordinator approves a swap while the
// worker has their tab open) refresh this one too.
window.addEventListener('storage', () => renderAll());

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function setTab(name) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active', 'in'));
  const panel = $('panel-' + name);
  panel.classList.add('active');
  // two frames so the browser registers display:block before the fade starts
  requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.add('in')));
}

// ---------------------------------------------------------------------------
// Worker: personal shift offers + optimiser
// ---------------------------------------------------------------------------

function myAssignedShifts() {
  const allocation = loadAllocation();
  return allocation ? (allocation.assigned[session.workerId] || []) : [];
}

function renderSolo() {
  const offers = loadSolo();
  const committed = myAssignedShifts();

  // offers that clash with a shift the coordinator already gave me can't be
  // taken, so they're shown greyed out and kept out of the optimiser
  const blocked = new Set(offers.filter(o => S.clashesWithAny(o, committed)).map(o => o.id));
  const usable = offers.filter(o => !blocked.has(o.id));
  const totalOffered = offers.reduce((sum, s) => sum + S.shiftValue(s), 0);
  const { chosen, total } = S.solveSchedule(usable);

  $('soloStats').innerHTML = `
    <div class="stat"><div class="num">${offers.length}</div><div class="label">Shift offers logged</div></div>
    <div class="stat"><div class="num">${money(totalOffered)}</div><div class="label">Total if none of them clashed</div></div>
    <div class="stat"><div class="num">${offers.length ? money(total) : '—'}</div><div class="label">Best you can actually earn</div></div>
  `;

  if (offers.length === 0) {
    $('soloTable').innerHTML = '<p class="empty">No shift offers yet.</p>';
    $('soloResult').innerHTML = '<p class="empty">Nothing to optimise yet.</p>';
    return;
  }

  const sorted = [...offers].sort((a, b) => S.toInterval(a).start - S.toInterval(b).start);
  $('soloTable').innerHTML = `<table><thead><tr><th>Job</th><th>When</th><th>Hours</th><th>Rate</th><th>Value</th><th></th></tr></thead><tbody>
    ${sorted.map(s => `
      <tr class="${blocked.has(s.id) ? 'muted-row' : ''}">
        <td><span class="job-tag">${esc(s.job)}</span>${blocked.has(s.id) ? '<div class="warn-tag">Clashes with a team shift</div>' : ''}</td>
        <td>${timeLabel(s)}</td>
        <td>${S.shiftHours(s).toFixed(2)}h</td>
        <td>${money(s.rate)}</td>
        <td>${money(S.shiftValue(s))}</td>
        <td><button class="del" data-id="${esc(s.id)}">Remove</button></td>
      </tr>`).join('')}
  </tbody></table>`;

  $('soloTable').querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => {
      saveSolo(loadSolo().filter(s => s.id !== btn.dataset.id));
      renderSolo();
    });
  });

  $('soloResult').innerHTML = chosen.length === 0
    ? '<p class="empty">Every offer clashes with something you\'re already doing.</p>'
    : `<table><thead><tr><th>Job</th><th>When</th><th>Hours</th><th>Pay</th></tr></thead><tbody>
        ${chosen.map(s => `<tr><td><span class="job-tag">${esc(s.job)}</span></td><td>${timeLabel(s)}</td><td>${s.hours.toFixed(2)}h</td><td>${money(s.value)}</td></tr>`).join('')}
      </tbody></table>`;
}

// Reads one of the two shift forms (worker offers use s_, pool uses p_).
function readShiftForm(prefix) {
  return {
    id: uid(),
    job: $(prefix + 'job').value.trim(),
    date: $(prefix + 'date').value,
    start: $(prefix + 'start').value,
    end: $(prefix + 'end').value,
    rate: parseFloat($(prefix + 'rate').value)
  };
}

$('soloForm').addEventListener('submit', e => {
  e.preventDefault();
  const shift = readShiftForm('s_');
  const problem = S.validateShift(shift);
  if (problem) return showToast(problem, 'error');

  saveSolo([...loadSolo(), shift]);
  e.target.reset();
  renderSolo();
  showToast('Shift offer added', 'success');
});

const byStartTime = (a, b) => S.toInterval(a).start - S.toInterval(b).start;

function renderWorkerAssigned() {
  const mine = [...myAssignedShifts()].sort(byStartTime);
  $('workerAssignedView').innerHTML = mine.length === 0
    ? '<p class="empty">No team-assigned shifts yet.</p>'
    : `<table><thead><tr><th>Job</th><th>When</th><th>Pay</th></tr></thead><tbody>
        ${mine.map(s => `<tr><td><span class="job-tag">${esc(s.job)}</span></td><td>${timeLabel(s)}</td><td>${money(s.value)}</td></tr>`).join('')}
      </tbody></table>`;
}

// ---------------------------------------------------------------------------
// Coordinator: roster, pool, allocation
// ---------------------------------------------------------------------------

function avatarHtml(workerId, size = '') {
  const profile = loadProfile(workerId);
  const cls = 'avatar' + (size ? ' ' + size : '');
  if (profile.avatar) return `<img class="${cls}" src="${esc(profile.avatar)}" alt="">`;
  const initial = workerName(workerId).trim().charAt(0).toUpperCase() || '?';
  return `<div class="${cls} avatar-placeholder">${esc(initial)}</div>`;
}

function renderWorkers() {
  const workers = loadWorkers();
  const el = $('workerList');
  if (workers.length === 0) {
    el.innerHTML = '<p class="empty">Add at least two workers to split a shift pool between them.</p>';
    return;
  }
  el.innerHTML = workers.map(w => {
    const about = loadProfile(w.id).about;
    return `<div class="roster-row">
      ${avatarHtml(w.id)}
      <div class="roster-info">
        <div class="roster-name">${esc(w.name)}</div>
        ${about ? `<div class="roster-about">${esc(about)}</div>` : ''}
      </div>
      <button class="del" data-id="${esc(w.id)}">Remove</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => removeWorker(btn.dataset.id));
  });
}

function removeWorker(id) {
  saveWorkers(loadWorkers().filter(w => w.id !== id));
  // their shifts go back to being unallocated, so the old allocation is void
  localStorage.removeItem(KEY.allocation);
  saveListings([]);
  saveRequests(loadRequests().map(r => r.status === 'pending' ? { ...r, status: 'expired' } : r));
  renderAll();
  showToast('Worker removed — run the allocation again', 'info');
}

$('workerForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('w_name').value.trim();
  if (!name) return;
  const workers = loadWorkers();
  if (workers.some(w => w.name.toLowerCase() === name.toLowerCase())) {
    return showToast('There\'s already someone called ' + name, 'error');
  }
  saveWorkers([...workers, { id: uid(), name }]);
  e.target.reset();
  renderWorkers();
  showToast('Worker added', 'success');
});

function renderPool() {
  const pool = loadPool();
  const el = $('poolTable');
  if (pool.length === 0) {
    el.innerHTML = '<p class="empty">No open shifts yet.</p>';
    return;
  }
  const sorted = [...pool].sort((a, b) => S.toInterval(a).start - S.toInterval(b).start);
  el.innerHTML = `<table><thead><tr><th>Job</th><th>When</th><th>Value</th><th></th></tr></thead><tbody>
    ${sorted.map(s => `<tr><td><span class="job-tag">${esc(s.job)}</span></td><td>${timeLabel(s)}</td><td>${money(S.shiftValue(s))}</td><td><button class="del" data-id="${esc(s.id)}">Remove</button></td></tr>`).join('')}
  </tbody></table>`;

  el.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => {
      savePool(loadPool().filter(s => s.id !== btn.dataset.id));
      renderPool();
      renderAllocation(); // shows the "pool has changed" note
    });
  });
}

$('poolForm').addEventListener('submit', e => {
  e.preventDefault();
  const shift = readShiftForm('p_');
  const problem = S.validateShift(shift);
  if (problem) return showToast(problem, 'error');

  savePool([...loadPool(), shift]);
  e.target.reset();
  renderPool();
  renderAllocation();
  showToast('Added to pool', 'success');
});

$('allocateBtn').addEventListener('click', () => {
  const workers = loadWorkers();
  const pool = loadPool();
  if (workers.length < 2) return showToast('Add at least two workers first.', 'error');
  if (pool.length === 0) return showToast('Add some shifts to the pool first.', 'error');

  const allocation = S.allocateFairly(workers, pool);
  allocation.poolSignature = poolSignature(pool);
  saveAllocation(allocation);

  // a fresh allocation means everyone's shifts may have changed, so old
  // listings and pending trades no longer make sense
  saveListings([]);
  saveRequests(loadRequests().map(r => r.status === 'pending' ? { ...r, status: 'expired' } : r));

  renderAllocation();
  renderSwapSuggestions();
  renderPendingRequests();
  showToast('Allocation complete', 'success');
});

function renderAllocation() {
  const allocation = loadAllocation();
  if (!allocation) {
    $('fairnessBanner').innerHTML = '';
    $('allocationResult').innerHTML = '';
    return;
  }

  const workers = loadWorkers();
  const totals = allocation.totals;
  const maxTotal = Math.max(...Object.values(totals), 0.01);
  const stale = allocation.poolSignature !== poolSignature(loadPool());

  $('fairnessBanner').innerHTML = `
    <div class="fairness-banner"><span>Spread between highest and lowest earner</span><span class="val">${money(S.spread(totals))}</span></div>
    ${stale ? '<p class="warn-tag">The pool has changed since this allocation — run it again to include the changes.</p>' : ''}`;

  $('allocationResult').innerHTML = workers.map(w => {
    const shifts = [...(allocation.assigned[w.id] || [])].sort(byStartTime);
    const pct = ((totals[w.id] || 0) / maxTotal) * 100;
    return `<div class="worker-card">
      <div class="worker-head"><span class="worker-name">${esc(w.name)}</span><span class="worker-total">${money(totals[w.id])}</span></div>
      <div class="fair-track"><div class="fair-fill" style="width:${pct}%"></div></div>
      ${shifts.length === 0
        ? '<p class="empty">No shifts assigned.</p>'
        : shifts.map(s => `<div class="shift-row"><span>${esc(s.job)} · ${timeLabel(s)}</span><span>${money(s.value)}</span></div>`).join('')}
    </div>`;
  }).join('') + (allocation.unassigned.length > 0
    ? `<p class="unassigned-tag">${allocation.unassigned.length} shift(s) couldn't be given to anyone without a clash.</p>`
    : '');
}

// ---------------------------------------------------------------------------
// Coordinator: swaps
// ---------------------------------------------------------------------------

function renderSwapSuggestions() {
  const el = $('swapResult');
  const allocation = loadAllocation();
  if (!allocation) {
    el.innerHTML = '<p class="empty">Run an allocation first.</p>';
    return;
  }

  const suggestions = S.suggestSwaps(allocation);
  if (suggestions.length === 0) {
    el.innerHTML = '<p class="empty">No swap would make it fairer — the split is as balanced as one-for-one trades can get.</p>';
    return;
  }

  el.innerHTML = suggestions.map((sug, i) => `
    <div class="swap-card">
      <div class="swap-title">Swap ${i + 1}</div>
      Give <strong>${esc(sug.hShift.job)}</strong> (${timeLabel(sug.hShift)}) from ${esc(workerName(sug.highId))} to ${esc(workerName(sug.lowId))},<br>
      and <strong>${esc(sug.lShift.job)}</strong> (${timeLabel(sug.lShift)}) from ${esc(workerName(sug.lowId))} to ${esc(workerName(sug.highId))}.<br>
      Narrows the gap from ${money(sug.oldGap)} to ${money(sug.newGap)}.
      <div style="margin-top:10px;"><button class="ghost" data-apply="${i}">Apply this swap</button></div>
    </div>`).join('');

  el.querySelectorAll('[data-apply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sug = suggestions[btn.dataset.apply];
      try {
        const updated = S.applySwap(loadAllocation(), sug.highId, sug.hShift.id, sug.lowId, sug.lShift.id);
        saveAllocation(updated);
        retireShifts([sug.hShift.id, sug.lShift.id]);
        renderAllocation();
        renderSwapSuggestions();
        renderPendingRequests();
        showToast('Swap applied', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
}

function renderPendingRequests() {
  const el = $('pendingRequestsView');
  const allocation = loadAllocation();
  const pending = loadRequests().filter(r => r.status === 'pending');
  if (!allocation || pending.length === 0) {
    el.innerHTML = '<p class="empty">No pending requests.</p>';
    return;
  }

  el.innerHTML = pending.map(r => {
    const offered = S.findShift(allocation, r.fromWorkerId, r.fromShiftId);
    const wanted = S.findShift(allocation, r.toWorkerId, r.toShiftId);
    if (!offered || !wanted) return '';
    // check up front so the coordinator can see a problem before clicking
    const check = S.checkSwap(allocation, r.fromWorkerId, r.fromShiftId, r.toWorkerId, r.toShiftId);
    return `<div class="req-card">
      <strong>${esc(workerName(r.fromWorkerId))}</strong> offers ${esc(offered.job)} (${timeLabel(offered)})<br>
      for <strong>${esc(workerName(r.toWorkerId))}</strong>'s ${esc(wanted.job)} (${timeLabel(wanted)})
      ${check.ok ? '' : `<div class="req-note warn-tag">${esc(check.reason)}</div>`}
      <div class="req-actions">
        <button class="primary" data-approve="${esc(r.id)}" ${check.ok ? '' : 'disabled'}>Approve</button>
        <button class="ghost" data-reject="${esc(r.id)}">Reject</button>
      </div>
    </div>`;
  }).join('') || '<p class="empty">No pending requests.</p>';

  el.querySelectorAll('[data-approve]').forEach(btn => {
    btn.addEventListener('click', () => approveRequest(btn.dataset.approve));
  });
  el.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => {
      saveRequests(loadRequests().map(r => r.id === btn.dataset.reject ? { ...r, status: 'rejected' } : r));
      renderPendingRequests();
      showToast('Request rejected', 'info');
    });
  });
}

function approveRequest(requestId) {
  const req = loadRequests().find(r => r.id === requestId);
  const allocation = loadAllocation();
  if (!req || !allocation) return;

  // re-check at the moment of approval, things may have moved since it was sent
  const check = S.checkSwap(allocation, req.fromWorkerId, req.fromShiftId, req.toWorkerId, req.toShiftId);
  if (!check.ok) return showToast('Can\'t approve: ' + check.reason, 'error');

  saveAllocation(S.applySwap(allocation, req.fromWorkerId, req.fromShiftId, req.toWorkerId, req.toShiftId));
  saveRequests(loadRequests().map(r => r.id === requestId ? { ...r, status: 'approved' } : r));
  retireShifts([req.fromShiftId, req.toShiftId]); // expires any other offers on the same shifts

  renderAllocation();
  renderSwapSuggestions();
  renderPendingRequests();
  showToast('Swap approved', 'success');
}

// ---------------------------------------------------------------------------
// Worker: listing shifts and offering trades
// ---------------------------------------------------------------------------

function isListed(shiftId) {
  return loadListings().some(l => l.workerId === session.workerId && l.shiftId === shiftId);
}

function renderListShifts() {
  const el = $('listShiftsView');
  const mine = myAssignedShifts();
  if (mine.length === 0) {
    el.innerHTML = '<p class="empty">You have no team-assigned shifts to list yet.</p>';
    return;
  }

  el.innerHTML = mine.map(s => {
    const listed = isListed(s.id);
    return `<div class="swap-toggle-row">
      <span><strong>${esc(s.job)}</strong> · ${timeLabel(s)} · ${money(s.value)}</span>
      <button class="swap-offer-btn" style="${listed ? 'background:var(--line); color:var(--ink);' : ''}" data-toggle="${esc(s.id)}">${listed ? 'Remove listing' : 'List for swap'}</button>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const shiftId = btn.dataset.toggle;
      const nowListed = !isListed(shiftId);
      const others = loadListings().filter(l => !(l.workerId === session.workerId && l.shiftId === shiftId));
      saveListings(nowListed ? [...others, { workerId: session.workerId, shiftId }] : others);
      renderListShifts();
      renderSwapBoard();
      showToast(nowListed ? 'Listed for swap' : 'Listing removed', 'info');
    });
  });
}

function renderSwapBoard() {
  const el = $('swapBoardView');
  const allocation = loadAllocation();
  if (!allocation) {
    el.innerHTML = '<p class="empty">No shifts listed for swap right now.</p>';
    return;
  }

  // only other people's listings, and only ones that still exist
  const board = loadListings()
    .filter(l => l.workerId !== session.workerId)
    .map(l => ({ ...l, shift: S.findShift(allocation, l.workerId, l.shiftId) }))
    .filter(l => l.shift);

  if (board.length === 0) {
    el.innerHTML = '<p class="empty">No shifts listed for swap right now.</p>';
    return;
  }

  const mine = myAssignedShifts();
  el.innerHTML = board.map((l, i) => `
    <div class="swap-listing-row">
      <div class="swap-item-title">${esc(l.shift.job)} · ${timeLabel(l.shift)}</div>
      <div class="swap-item-meta">${money(l.shift.value)} · listed by ${esc(workerName(l.workerId))}</div>
      ${mine.length === 0
        ? '<span class="empty">You need an assigned shift of your own to offer in trade.</span>'
        : `<div style="display:flex; gap:10px; align-items:center;">
            <select data-offer-select="${i}" style="flex:1;">
              ${mine.map(s => `<option value="${esc(s.id)}">${esc(s.job)} · ${timeLabel(s)}</option>`).join('')}
            </select>
            <button class="swap-offer-btn" data-offer-btn="${i}">Offer trade</button>
          </div>`}
    </div>`).join('');

  el.querySelectorAll('[data-offer-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const listing = board[btn.dataset.offerBtn];
      const myShiftId = el.querySelector(`[data-offer-select="${btn.dataset.offerBtn}"]`).value;
      offerTrade(myShiftId, listing);
    });
  });
}

function offerTrade(myShiftId, listing) {
  const requests = loadRequests();
  const duplicate = requests.some(r =>
    r.status === 'pending' && r.fromShiftId === myShiftId && r.toShiftId === listing.shiftId);
  if (duplicate) return showToast('You\'ve already offered that trade', 'info');

  // tell the worker straight away if it can't work, instead of letting the
  // coordinator find out later
  const check = S.checkSwap(loadAllocation(), session.workerId, myShiftId, listing.workerId, listing.shiftId);
  if (!check.ok) return showToast(check.reason, 'error');

  saveRequests([...requests, {
    id: uid(),
    status: 'pending',
    createdAt: new Date().toISOString(),
    fromWorkerId: session.workerId,
    fromShiftId: myShiftId,
    toWorkerId: listing.workerId,
    toShiftId: listing.shiftId
  }]);
  renderMyRequests();
  showToast('Trade offer sent for approval', 'success');
}

function renderMyRequests() {
  const el = $('myRequestsView');
  const allocation = loadAllocation();
  const mine = loadRequests().filter(r => r.fromWorkerId === session.workerId).reverse();
  if (mine.length === 0) {
    el.innerHTML = '<p class="empty">No requests submitted yet.</p>';
    return;
  }

  // after an approved swap the shifts have moved owner, so look them up by id
  // across everyone rather than assuming who has them now
  const anyShift = id => allocation
    ? Object.values(allocation.assigned).flat().find(s => s.id === id)
    : null;

  el.innerHTML = mine.map(r => {
    const give = anyShift(r.fromShiftId);
    const get = anyShift(r.toShiftId);
    const label = give && get
      ? `${esc(give.job)} ↔ ${esc(get.job)} with ${esc(workerName(r.toWorkerId))}`
      : 'Trade with ' + esc(workerName(r.toWorkerId));
    return `<div class="shift-row">
      <span>${label}</span>
      <span class="status-pill status-${esc(r.status)}">${esc(r.status)}</span>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function renderProfile() {
  if (session.role !== 'worker') return;
  $('profileNameDisplay').textContent = session.name;
  $('aboutInput').value = loadProfile(session.workerId).about || '';
  $('avatarPreviewWrap').innerHTML = avatarHtml(session.workerId, 'avatar-lg');
}

function updateProfile(changes) {
  const profiles = loadProfiles();
  profiles[session.workerId] = { ...loadProfile(session.workerId), ...changes };
  return saveProfiles(profiles);
}

// Photos straight off a phone can be several MB, which blows through the
// ~5MB localStorage limit fast. Shrink to 160px square first.
function shrinkImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const side = Math.min(img.width, img.height); // crop to a centred square
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

$('avatarInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const avatar = await shrinkImage(file);
    if (updateProfile({ avatar })) {
      renderProfile();
      updateSessionAvatar();
      showToast('Photo updated', 'success');
    }
  } catch {
    showToast('Couldn\'t read that image', 'error');
  }
  e.target.value = ''; // so picking the same file again still fires change
});

$('saveProfileBtn').addEventListener('click', () => {
  if (updateProfile({ about: $('aboutInput').value.trim().slice(0, 200) })) {
    showToast('Profile saved', 'success');
  }
});

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

function loadDemoData() {
  const pad = n => String(n).padStart(2, '0');
  const day = offset => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const make = (job, offset, start, end, rate) => ({ id: uid(), job, date: day(offset), start, end, rate });

  const workers = ['Amara', 'Ben', 'Chloe'].map(name => ({ id: uid(), name }));
  const pool = [
    make('Events', 1, '17:00', '23:00', 12.5),
    make('Events', 1, '18:00', '23:30', 12.5),
    make('Security', 2, '08:00', '16:00', 13.2),
    make('Security', 2, '22:00', '06:00', 14.0),
    make('Hospitality', 3, '10:00', '18:00', 11.9),
    make('Hospitality', 3, '12:00', '20:00', 11.9),
    make('Teaching Assistant', 4, '08:30', '15:30', 12.0),
    make('Events', 5, '16:00', '23:00', 13.0)
  ];

  saveWorkers(workers);
  savePool(pool);
  localStorage.removeItem(KEY.allocation);
  saveListings([]);
  saveRequests([]);

  // give the first worker some overlapping personal offers to optimise
  write('shiftOpsSolo_' + workers[0].id, [
    // later in the week than the pool, so they don't all clash with team shifts.
    // the 22:00-06:00 night shift deliberately overlaps the 05:00 start the
    // next morning to show overnight clashes being caught
    make('Security', 6, '09:00', '17:00', 13.2),
    make('Hospitality', 6, '12:00', '20:00', 11.9),
    make('Events', 6, '18:00', '23:00', 14.5),
    make('Security', 7, '22:00', '06:00', 14.0),
    make('Teaching Assistant', 8, '05:00', '12:00', 12.0)
  ]);

  showToast('Sample data loaded — sign in as coordinator and run the allocation', 'success');
  if (pendingRole) selectRole(pendingRole);
}

$('loadDemoBtn').addEventListener('click', loadDemoData);

$('resetBtn').addEventListener('click', () => {
  Object.keys(localStorage)
    .filter(k => k.startsWith('shiftOps'))
    .forEach(k => localStorage.removeItem(k));
  showToast('All data cleared', 'info');
  if (pendingRole) selectRole(pendingRole);
});

// ---------------------------------------------------------------------------
// Wire up the sign-in screen and start
// ---------------------------------------------------------------------------

$('chooseWorker').addEventListener('click', () => selectRole('worker'));
$('chooseCoordinator').addEventListener('click', () => selectRole('coordinator'));
$('accessCode').addEventListener('input', validateSignIn);
$('accessCode').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !$('signInBtn').disabled) signIn();
});
$('workerSelect').addEventListener('change', validateSignIn);
$('signInBtn').addEventListener('click', signIn);
$('signOutBtn').addEventListener('click', signOut);

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    setTab(btn.dataset.tab);
    if (btn.dataset.tab === 'profile') renderProfile();
  });
});

// session lives in sessionStorage, not localStorage
session = JSON.parse(sessionStorage.getItem(KEY.session) || 'null');
if (session) enterApp();
else setTab('shifts');
