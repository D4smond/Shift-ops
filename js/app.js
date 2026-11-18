// app.js
// The screens. Rules live in scheduling.js (shifts, allocation, clashes)
// and swaps.js (who agrees to a swap and who gets told); Store remembers
// everything. This file draws tabs and reacts to buttons.

(function () {
  const S = window.Scheduling;
  const W = window.Swaps;
  const DB = window.Store;
  const LEAD = DB.COORDINATOR;
  const CODES = { worker: 'WORKER123', coordinator: 'LEAD123' }; // demo only, shown on the sign-in page

  const root = document.getElementById('root');
  let session = readSession();
  let tab = 'overview';
  const ui = { role: null, decliningId: null };

  // ---------------------------------------------------------------------------
  // small helpers
  // ---------------------------------------------------------------------------

  function esc(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const money = n => '£' + Number(n || 0).toFixed(2);

  function dayLabel(date) {
    return new Date(date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function timeLabel(s) {
    return `${dayLabel(s.date)} · ${s.start}–${s.end}${s.end <= s.start ? ' (+1)' : ''}`;
  }

  // colour a shift by what kind of job it is
  function jobClass(job) {
    const j = String(job).toLowerCase();
    if (/secur|steward|door/.test(j)) return 'job-security';
    if (/event|festival|concert|stadium/.test(j)) return 'job-events';
    if (/hospital|bar|cater|waiter|restaurant|cafe/.test(j)) return 'job-hospitality';
    if (/teach|tutor|class|school|assistant/.test(j)) return 'job-teaching';
    return 'job-other';
  }

  const initials = name => String(name || '?').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();

  function timeAgo(ms) {
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} d ago`;
  }

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    document.getElementById('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 3200);
  }

  function readSession() {
    try { return JSON.parse(sessionStorage.getItem('shiftOps.session') || 'null'); } catch { return null; }
  }

  function names() {
    const map = { [LEAD]: 'the coordinator' };
    DB.data.workers.forEach(w => { map[w.id] = w.name; });
    return map;
  }

  const shiftLabel = s => `${s.job} shift (${timeLabel(s)})`;
  const workerName = id => (DB.data.workers.find(w => w.id === id) || {}).name || 'Removed worker';
  const me = () => session && session.role === 'worker' ? session.workerId : LEAD;

  function avatar(workerId, big) {
    const p = DB.data.profiles[workerId] || {};
    const cls = 'avatar' + (big ? ' avatar-lg' : '');
    return p.avatar
      ? `<img class="${cls}" src="${esc(p.avatar)}" alt="">`
      : `<span class="${cls}" aria-hidden="true">${esc(initials(workerName(workerId)))}</span>`;
  }

  function shiftRow(s, extra = '', muted = false) {
    return `<div class="shift ${muted ? 'muted' : ''}">
      <span class="tag ${jobClass(s.job)}">${esc(s.job)}</span>
      <span class="when"><strong>${esc(timeLabel(s))}</strong>${S.shiftHours(s).toFixed(1)} hours</span>
      <span class="pay">${money(S.shiftValue(s))}</span>
      ${extra}
    </div>`;
  }

  const byStart = (a, b) => S.toInterval(a).start - S.toInterval(b).start;

  function myShifts(id) {
    const a = DB.data.allocation;
    return a ? [...(a.assigned[id] || [])].sort(byStart) : [];
  }

  const poolSignature = pool => pool.map(s => s.id).sort().join('|');

  // shifts moved (new allocation, approved swap): close anything that no
  // longer makes sense and tell the people involved
  function tidyAfterShiftsMoved() {
    const a = DB.data.allocation;
    const owns = (workerId, shiftId) => Boolean(a && S.findShift(a, workerId, shiftId));
    const result = W.expire(DB.data.requests, r => owns(r.fromWorkerId, r.fromShift.id) && owns(r.toWorkerId, r.toShift.id), Date.now(), names(), shiftLabel);
    DB.update(d => {
      d.requests = result.requests;
      d.listings = d.listings.filter(l => owns(l.workerId, l.shiftId));
    });
    DB.notify(result.notifications);
  }

  // ---------------------------------------------------------------------------
  // sign-in
  // ---------------------------------------------------------------------------

  function gate() {
    const workers = DB.data.workers;
    return `
    <div class="gate">
      <section class="gate-brand">
        <div class="logo" style="color: #fff; padding: 0"><span class="logo-mark" style="background: rgba(255,255,255,.16)">${ICON.logo}</span>Shift Ops</div>
        <div style="position: relative; z-index: 1">
          <h1>Fair shifts, fewer clashes.</h1>
          <p>Built for people juggling more than one zero-hours job, and the team leads who share shifts between them.</p>
          <ul class="gate-points">
            <li><span class="dot">${ICON.calendar}</span><span><strong>Workers</strong> log overlapping offers and get the best clash-free set worked out.</span></li>
            <li><span class="dot">${ICON.scale}</span><span><strong>Coordinators</strong> share a pool of shifts so nobody gets all the bad hours.</span></li>
            <li><span class="dot">${ICON.swap}</span><span><strong>Swaps</strong> need your colleague's yes, then the coordinator's, and everyone's told the outcome.</span></li>
          </ul>
        </div>
        <p style="position: relative; z-index: 1; font-size: 13px; color: #9FCDB9">Portfolio project by Desmond Oghenebrume</p>
      </section>
      <section class="gate-form">
        <div class="gate-card">
          <h2>Sign in</h2>
          <p class="sub">Choose how you're using Shift Ops today.</p>
          <div class="roles">
            <button class="role" data-action="role" data-role="worker" aria-pressed="${ui.role === 'worker'}"><strong>Worker</strong><span>My shifts and swaps</span></button>
            <button class="role" data-action="role" data-role="coordinator" aria-pressed="${ui.role === 'coordinator'}"><strong>Coordinator</strong><span>Team, pool, approvals</span></button>
          </div>
          <form data-form="signin" class="grid" style="gap: 14px" novalidate>
            ${ui.role === 'worker' ? `
            <div class="field">
              <label for="who">Which worker are you?</label>
              ${workers.length
                ? `<select class="input" id="who" name="who">${workers.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select>`
                : `<p class="callout attention" style="margin: 0">No workers yet. Load the sample team below, or sign in as coordinator and add some.</p>`}
            </div>` : ''}
            <div class="field">
              <label for="code">Access code</label>
              <input class="input" id="code" name="code" autocomplete="off" placeholder="Enter the code" ${ui.role ? '' : 'disabled'}>
            </div>
            <button class="btn btn-primary" ${ui.role ? '' : 'disabled'}>Sign in</button>
          </form>
          <div class="demo-note">
            Demo sign-in, not real security: worker code <code>WORKER123</code>, coordinator code <code>LEAD123</code>.
            <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap">
              <button class="btn btn-secondary btn-sm" data-action="sample">Load sample team</button>
              <button class="btn btn-quiet btn-sm" data-action="clear">Clear all data</button>
            </div>
          </div>
        </div>
      </section>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // the shell: sidebar + current tab
  // ---------------------------------------------------------------------------

  const ICON = {
    logo: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4M8 14h3"/></svg>',
    home: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
    calendar: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
    spark: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
    swap: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>',
    inbox: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></svg>',
    user: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    team: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 0 1 0 7M18 15c2 .6 3.2 2.2 3.5 5"/></svg>',
    stack: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5"/></svg>',
    scale: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0zM8 21h8"/></svg>',
    help: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01"/></svg>'
  };

  const WORKER_TABS = [
    ['overview', 'Overview', ICON.home, 'What needs your attention and what\'s coming up.'],
    ['schedule', 'My schedule', ICON.calendar, 'Shifts your coordinator has given you, day by day. List any you want to swap.'],
    ['planner', 'Shift planner', ICON.spark, 'Add every shift you\'ve been offered, even ones that overlap. Shift Ops picks the set that pays most without clashes.'],
    ['swaps', 'Swaps', ICON.swap, 'Answer swap requests, offer trades on colleagues\' listed shifts, and follow your own requests.'],
    ['inbox', 'Inbox', ICON.inbox, 'Every update about your shifts and swaps, newest first.'],
    ['profile', 'Profile', ICON.user, 'The photo and line about you that your coordinator sees.'],
    ['guide', 'How it works', ICON.help, 'What each tab does, in plain English.']
  ];

  const LEAD_TABS = [
    ['overview', 'Overview', ICON.home, 'Your team at a glance: what\'s waiting for you and how fair the split is.'],
    ['team', 'Team', ICON.team, 'Who\'s on the roster and what they\'ve been given.'],
    ['pool', 'Shift pool', ICON.stack, 'Open shifts waiting to be shared out.'],
    ['allocation', 'Allocation', ICON.scale, 'Share the pool fairly, then fine-tune with suggested swaps.'],
    ['swaps', 'Swap approvals', ICON.swap, 'Swaps both workers have agreed to. Approve, or reject with a reason they\'ll both see.'],
    ['inbox', 'Inbox', ICON.inbox, 'Updates about your team, newest first.'],
    ['guide', 'How it works', ICON.help, 'What each tab does, in plain English.']
  ];

  function counts() {
    const id = me();
    const reqs = DB.data.requests;
    return {
      inbox: DB.unreadFor(id),
      swaps: session.role === 'worker'
        ? reqs.filter(r => r.status === 'offered' && r.toWorkerId === id).length
        : reqs.filter(r => r.status === 'awaiting_coordinator').length
    };
  }

  function shell(content) {
    const tabs = session.role === 'worker' ? WORKER_TABS : LEAD_TABS;
    const c = counts();
    const current = tabs.find(t => t[0] === tab) || tabs[0];
    return `
    <div class="shell">
      <aside class="sidebar">
        <a class="logo" href="#" data-action="tab" data-tab="overview"><span class="logo-mark">${ICON.logo}</span><span class="logo-text">Shift Ops</span></a>
        <nav class="nav" aria-label="Sections">
          ${tabs.map(([id, label, icon]) => `
            <button data-action="tab" data-tab="${id}" ${id === tab ? 'aria-current="page"' : ''}>${icon}<span>${label}</span>${c[id] ? `<span class="count" aria-label="${c[id]} new">${c[id]}</span>` : ''}</button>`).join('')}
        </nav>
        <div class="sidebar-foot">
          ${session.role === 'worker' ? avatar(session.workerId) : `<span class="avatar" aria-hidden="true">${ICON.team}</span>`}
          <div class="who"><strong>${esc(session.role === 'worker' ? workerName(session.workerId) : 'Coordinator')}</strong><span>${session.role === 'worker' ? 'Worker' : 'Team lead'}</span></div>
          <button class="btn btn-quiet btn-sm" data-action="signout">Switch</button>
        </div>
      </aside>
      <main class="main">
        <div class="page-head"><div><h1>${current[1]}</h1><p>${current[3]}</p></div></div>
        ${content}
      </main>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // worker tabs
  // ---------------------------------------------------------------------------

  function workerOverview() {
    const id = session.workerId;
    const shifts = myShifts(id);
    const total = shifts.reduce((s, x) => s + S.shiftValue(x), 0);
    const upcoming = shifts[0]; // already sorted by start time
    const incoming = DB.data.requests.filter(r => r.status === 'offered' && r.toWorkerId === id);
    const waiting = DB.data.requests.filter(r => W.isOpen(r) && r.fromWorkerId === id);
    const notes = DB.data.notifications.filter(n => n.to === id).slice(0, 3);
    const unread = DB.unreadFor(id);

    const todo = [];
    if (incoming.length) todo.push(`<div class="callout attention">${ICON.swap}<div><strong>${incoming.length} swap request${incoming.length > 1 ? 's need' : ' needs'} your answer.</strong> <a href="#" data-action="tab" data-tab="swaps">Answer now</a></div></div>`);
    if (!shifts.length) todo.push(`<div class="callout">${ICON.calendar}<div>You haven't been given any team shifts yet. Your coordinator shares them out from the <em>Allocation</em> screen.</div></div>`);
    if (!(DB.data.offers[id] || []).length) todo.push(`<div class="callout">${ICON.spark}<div>Got shift offers from other jobs? Add them in the <a href="#" data-action="tab" data-tab="planner">Shift planner</a> and see which combination pays most.</div></div>`);

    return `
    <div class="stats">
      <div class="stat brand"><div class="k">This week's team shifts</div><div class="v">${shifts.length}</div><div class="s">${shifts.reduce((h, s) => h + S.shiftHours(s), 0).toFixed(1)} hours</div></div>
      <div class="stat"><div class="k">Expected pay</div><div class="v">${money(total)}</div><div class="s">from team shifts</div></div>
      <div class="stat ${incoming.length ? 'attention' : ''}"><div class="k">Swaps waiting for you</div><div class="v">${incoming.length}</div><div class="s">${waiting.length} of yours in progress</div></div>
      <div class="stat ${unread ? 'attention' : ''}"><div class="k">Unread updates</div><div class="v">${unread}</div><div class="s">in your inbox</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h2>Next up</h2>
        <p class="lead">Your earliest team shift.</p>
        ${upcoming ? shiftRow(upcoming) : '<div class="empty"><strong>Nothing scheduled</strong>Team shifts appear here once they\'re shared out.</div>'}
        ${todo.length ? `<div style="margin-top: 16px">${todo.join('')}</div>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Latest updates</h2><p class="lead">From swaps and your coordinator.</p></div><button class="btn btn-secondary btn-sm" data-action="tab" data-tab="inbox">Open inbox</button></div>
        ${notes.length ? notes.map(noteRow).join('') : '<div class="empty"><strong>All quiet</strong>Updates about your shifts will show up here.</div>'}
      </div>
    </div>`;
  }

  function schedule() {
    const id = session.workerId;
    const shifts = myShifts(id);
    if (!shifts.length) return `<div class="card"><div class="empty"><strong>No team shifts yet</strong>Once your coordinator runs the allocation, your shifts appear here.</div></div>`;
    const listed = new Set(DB.data.listings.filter(l => l.workerId === id).map(l => l.shiftId));
    const days = {};
    shifts.forEach(s => { (days[s.date] = days[s.date] || []).push(s); });

    return `
    <div class="card">
      <div class="callout" style="margin-bottom: 18px">${ICON.swap}<div>Listing a shift lets colleagues offer you a trade for it. Only listed shifts are visible to them: nobody can see the rest of your schedule or your pay.</div></div>
      ${Object.keys(days).sort().map(date => `
        <div class="day">
          <div class="day-label">${esc(new Date(date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long' }))}<span>${esc(new Date(date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}</span></div>
          <div>${days[date].map(s => shiftRow(s, `<div class="actions">${listed.has(s.id)
            ? `<span class="pill pill-wait">Listed for swap</span><button class="btn btn-quiet btn-sm" data-action="unlist" data-id="${esc(s.id)}">Remove</button>`
            : `<button class="btn btn-secondary btn-sm" data-action="list" data-id="${esc(s.id)}">List for swap</button>`}</div>`)).join('')}</div>
        </div>`).join('')}
    </div>`;
  }

  function planner() {
    const id = session.workerId;
    const offers = [...(DB.data.offers[id] || [])].sort(byStart);
    const committed = myShifts(id);
    const blocked = new Set(offers.filter(o => S.clashesWithAny(o, committed)).map(o => o.id));
    const usable = offers.filter(o => !blocked.has(o.id));
    const best = S.solveSchedule(usable);
    const allValue = offers.reduce((s, o) => s + S.shiftValue(o), 0);

    return `
    <div class="stats">
      <div class="stat"><div class="k">Offers logged</div><div class="v">${offers.length}</div></div>
      <div class="stat"><div class="k">If none clashed</div><div class="v">${money(allValue)}</div></div>
      <div class="stat brand"><div class="k">Best you can actually earn</div><div class="v">${money(best.total)}</div><div class="s">${best.chosen.length} shift${best.chosen.length === 1 ? '' : 's'}, no clashes</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h2>Add a shift offer</h2>
        <p class="lead">Anything you've been offered by any job.</p>
        <form data-form="offer" class="form-grid" novalidate>
          <div class="field" style="grid-column: 1 / -1"><label for="o_job">Job</label><input class="input" id="o_job" name="job" placeholder="Security" required></div>
          <div class="field"><label for="o_date">Date</label><input class="input" id="o_date" name="date" type="date" required></div>
          <div class="field"><label for="o_start">Start</label><input class="input" id="o_start" name="start" type="time" required></div>
          <div class="field"><label for="o_end">End</label><input class="input" id="o_end" name="end" type="time" required></div>
          <div class="field"><label for="o_rate">£ per hour</label><input class="input" id="o_rate" name="rate" type="number" step="0.01" min="0" placeholder="12.50" required></div>
          <button class="btn btn-primary" style="grid-column: 1 / -1">Add offer</button>
        </form>
      </div>
      <div class="card">
        <h2>Take these</h2>
        <p class="lead">The highest-paying set with no overlaps. Offers that clash with your team shifts are left out.</p>
        ${best.chosen.length ? best.chosen.map(s => shiftRow(s)).join('') : '<div class="empty"><strong>Nothing to work out yet</strong>Add two or more offers to see the best combination.</div>'}
      </div>
    </div>
    <div class="card" style="margin-top: 16px">
      <h2>All your offers</h2>
      <p class="lead">Greyed-out offers clash with a team shift you've already been given.</p>
      ${offers.length ? offers.map(o => shiftRow(o, `<div class="actions">${blocked.has(o.id) ? '<span class="pill pill-bad">Clashes</span>' : ''}<button class="btn btn-quiet btn-sm" data-action="remove-offer" data-id="${esc(o.id)}" aria-label="Remove offer">Remove</button></div>`, blocked.has(o.id))).join('') : '<div class="empty">No offers yet.</div>'}
    </div>`;
  }

  const HISTORY_TEXT = {
    offered: 'Offered', awaiting_coordinator: 'Accepted by colleague', approved: 'Approved',
    declined: 'Declined', rejected: 'Rejected', withdrawn: 'Withdrawn', expired: 'Closed (shifts changed)'
  };

  function requestCard(r, viewer, buttons = '') {
    const n = names();
    const statusClass = { offered: 'pill-wait', awaiting_coordinator: 'pill-wait', approved: 'pill-good', declined: 'pill-bad', rejected: 'pill-bad', withdrawn: 'pill-neutral', expired: 'pill-neutral' }[r.status];
    const fromIsMe = r.fromWorkerId === viewer;
    const headline = viewer === LEAD
      ? `${esc(n[r.fromWorkerId])} ⇄ ${esc(n[r.toWorkerId])}`
      : fromIsMe ? `You asked ${esc(n[r.toWorkerId])}` : `${esc(n[r.fromWorkerId])} asked you`;
    const reasonBy = r.status === 'declined' ? n[r.toWorkerId] : 'Coordinator';
    // the same status reads differently depending on who's looking
    let statusText = W.STATUS_TEXT[r.status];
    if (r.status === 'offered' && viewer === r.toWorkerId) statusText = 'Needs your answer';
    if (r.status === 'offered' && viewer === LEAD) statusText = `Waiting for ${n[r.toWorkerId]}`;
    if (r.status === 'awaiting_coordinator' && viewer === LEAD) statusText = 'Needs your decision';
    return `
    <div class="request">
      <div class="card-head"><strong>${headline}</strong><span class="pill ${statusClass}">${esc(statusText)}</span></div>
      <div class="trade">
        <div><div class="meta">${viewer === LEAD ? esc(n[r.fromWorkerId]) + ' gives' : fromIsMe ? 'You give' : 'They give'}</div>${shiftRow(r.fromShift)}</div>
        <span class="arrow" aria-hidden="true">⇄</span>
        <div><div class="meta">${viewer === LEAD ? esc(n[r.toWorkerId]) + ' gives' : fromIsMe ? 'You get' : 'You give'}</div>${shiftRow(r.toShift)}</div>
      </div>
      ${r.message ? `<div class="reason">Message: "${esc(r.message)}"</div>` : ''}
      ${r.reason ? `<div class="reason"><strong>${esc(reasonBy)}'s reason:</strong> ${esc(r.reason)}</div>` : ''}
      <ol class="timeline" aria-label="History">${r.history.map(h => `<li>${esc(HISTORY_TEXT[h.status])} ${timeAgo(h.at)}</li>`).join('')}</ol>
      ${buttons}
    </div>`;
  }

  function workerSwaps() {
    const id = session.workerId;
    const a = DB.data.allocation;
    const reqs = DB.data.requests;
    const incoming = reqs.filter(r => r.status === 'offered' && r.toWorkerId === id);
    const mine = reqs.filter(r => r.fromWorkerId === id).sort((x, y) => y.createdAt - x.createdAt);
    const pastIncoming = reqs.filter(r => r.toWorkerId === id && r.status !== 'offered').sort((x, y) => y.createdAt - x.createdAt).slice(0, 5);
    const mineShifts = myShifts(id);
    const board = DB.data.listings
      .filter(l => l.workerId !== id)
      .map(l => ({ ...l, shift: a && S.findShift(a, l.workerId, l.shiftId) }))
      .filter(l => l.shift);

    const answerButtons = r => ui.decliningId === r.id ? `
      <form data-form="decline" data-id="${esc(r.id)}" class="grid" style="gap: 8px; margin-top: 12px" novalidate>
        <label class="label" for="why-${esc(r.id)}">Reason (optional, they'll see it)</label>
        <input class="input" id="why-${esc(r.id)}" name="reason" maxlength="160" placeholder="I need the hours that week">
        <div class="buttons" style="display: flex; gap: 8px"><button class="btn btn-danger">Decline swap</button><button type="button" class="btn btn-quiet" data-action="cancel-decline">Back</button></div>
      </form>` : `
      <div class="buttons"><button class="btn btn-primary" data-action="accept" data-id="${esc(r.id)}">Accept, send to coordinator</button><button class="btn btn-secondary" data-action="start-decline" data-id="${esc(r.id)}">Decline</button></div>`;

    return `
    <div class="card">
      <h2>Needs your answer</h2>
      <p class="lead">A colleague wants one of your listed shifts. If you accept, it goes to the coordinator for final approval.</p>
      ${incoming.length ? incoming.map(r => requestCard(r, id, answerButtons(r))).join('') : '<div class="empty"><strong>Nothing to answer</strong>When someone offers a trade for a shift you\'ve listed, it shows up here.</div>'}
    </div>

    <div class="card">
      <h2>Swap board</h2>
      <p class="lead">Shifts colleagues have listed. Offer one of yours in return.</p>
      ${board.length ? board.map((l, i) => `
        <div class="request">
          <div class="card-head"><strong>${esc(workerName(l.workerId))} listed</strong></div>
          ${shiftRow(l.shift)}
          ${mineShifts.length ? `
          <form data-form="offer-swap" data-index="${i}" data-owner="${esc(l.workerId)}" data-shift="${esc(l.shiftId)}" class="form-grid" style="margin-top: 12px" novalidate>
            <div class="field"><label for="give-${i}">You give</label><select class="input" id="give-${i}" name="give">${mineShifts.map(s => `<option value="${esc(s.id)}">${esc(s.job)} · ${esc(timeLabel(s))}</option>`).join('')}</select></div>
            <div class="field"><label for="msg-${i}">Message (optional)</label><input class="input" id="msg-${i}" name="message" maxlength="200" placeholder="Happy to swap if it helps"></div>
            <button class="btn btn-primary">Offer swap</button>
          </form>` : '<p class="meta" style="margin-top: 10px">You need a team shift of your own to offer.</p>'}
        </div>`).join('') : '<div class="empty"><strong>Nothing listed right now</strong>Colleagues list shifts from their schedule. You can list yours from <a href="#" data-action="tab" data-tab="schedule">My schedule</a>.</div>'}
    </div>

    <div class="card">
      <h2>Your requests</h2>
      <p class="lead">Where each of your offers is up to, and why if it didn't go ahead.</p>
      ${mine.length ? mine.map(r => requestCard(r, id, W.isOpen(r) ? `<div class="buttons"><button class="btn btn-quiet btn-sm" data-action="withdraw" data-id="${esc(r.id)}">Withdraw offer</button></div>` : '')).join('') : '<div class="empty">You haven\'t offered any swaps yet.</div>'}
    </div>

    ${pastIncoming.length ? `<div class="card"><h2>Requests you've answered</h2><p class="lead">Your last five.</p>${pastIncoming.map(r => requestCard(r, id)).join('')}</div>` : ''}`;
  }

  function noteRow(n) {
    return `<div class="note ${n.read ? 'read' : 'unread'}"><span class="dot" aria-hidden="true"></span><div class="body">${esc(n.text)}<div class="time">${timeAgo(n.at)}${n.read ? '' : ' · new'}</div></div>${n.link ? `<button class="btn btn-secondary btn-sm" data-action="open-note" data-id="${esc(n.id)}">View</button>` : ''}</div>`;
  }

  function inbox() {
    const id = me();
    const notes = DB.data.notifications.filter(n => n.to === id);
    return `
    <div class="card">
      <div class="card-head"><div><h2>Updates</h2><p class="lead">${DB.unreadFor(id)} unread</p></div>${notes.some(n => !n.read) ? '<button class="btn btn-secondary btn-sm" data-action="read-all">Mark all as read</button>' : ''}</div>
      ${notes.length ? notes.map(noteRow).join('') : '<div class="empty"><strong>No updates yet</strong>You\'ll be told here when shifts are assigned or a swap moves forward.</div>'}
    </div>`;
  }

  function profile() {
    const id = session.workerId;
    const p = DB.data.profiles[id] || {};
    return `
    <div class="card" style="max-width: 620px">
      <div style="display: flex; gap: 18px; align-items: center; margin-bottom: 20px">
        ${avatar(id, true)}
        <div><h2 style="margin: 0">${esc(workerName(id))}</h2>
        <label class="btn btn-secondary btn-sm" style="margin-top: 8px">Change photo<input type="file" accept="image/*" data-action="photo" class="sr-only"></label></div>
      </div>
      <form data-form="profile" class="grid" style="gap: 12px" novalidate>
        <div class="field"><label for="about">About you</label><textarea class="input" id="about" name="about" maxlength="200" placeholder="Second-year student, mostly evenings and weekends.">${esc(p.about || '')}</textarea></div>
        <button class="btn btn-primary" style="justify-self: start">Save profile</button>
      </form>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // coordinator tabs
  // ---------------------------------------------------------------------------

  function leadOverview() {
    const d = DB.data;
    const a = d.allocation;
    const waiting = d.requests.filter(r => r.status === 'awaiting_coordinator').length;
    const stale = a && a.poolSignature !== poolSignature(d.pool);
    const alerts = [];
    if (waiting) alerts.push(`<div class="callout attention">${ICON.swap}<div><strong>${waiting} swap${waiting > 1 ? 's' : ''} waiting for your decision.</strong> <a href="#" data-action="tab" data-tab="swaps">Review now</a></div></div>`);
    if (stale) alerts.push(`<div class="callout attention">${ICON.stack}<div>The shift pool has changed since you last ran the allocation. <a href="#" data-action="tab" data-tab="allocation">Run it again</a></div></div>`);
    if (a && a.unassigned.length) alerts.push(`<div class="callout attention">${ICON.calendar}<div>${a.unassigned.length} shift(s) couldn't be given to anyone without a clash.</div></div>`);
    if (!d.workers.length) alerts.push(`<div class="callout">${ICON.team}<div>Start by adding your team on the <a href="#" data-action="tab" data-tab="team">Team</a> tab.</div></div>`);
    if (!a && d.workers.length >= 2 && d.pool.length) alerts.push(`<div class="callout">${ICON.scale}<div>Your team and pool are ready. <a href="#" data-action="tab" data-tab="allocation">Share the shifts out</a></div></div>`);

    const max = a ? Math.max(...Object.values(a.totals), 0.01) : 1;
    return `
    <div class="stats">
      <div class="stat brand"><div class="k">Team</div><div class="v">${d.workers.length}</div><div class="s">people on the roster</div></div>
      <div class="stat"><div class="k">Shifts in the pool</div><div class="v">${d.pool.length}</div><div class="s">${money(d.pool.reduce((s, x) => s + S.shiftValue(x), 0))} in total</div></div>
      <div class="stat"><div class="k">Pay gap</div><div class="v">${a ? money(S.spread(a.totals)) : '—'}</div><div class="s">highest vs lowest earner</div></div>
      <div class="stat ${waiting ? 'attention' : ''}"><div class="k">Waiting for you</div><div class="v">${waiting}</div><div class="s">swap approvals</div></div>
    </div>
    <div class="grid grid-2">
      <div class="card"><h2>Needs attention</h2><p class="lead">Things only you can sort out.</p>${alerts.length ? alerts.join('') : '<div class="empty"><strong>All clear</strong>Nothing needs you right now.</div>'}</div>
      <div class="card"><h2>Who's getting what</h2><p class="lead">Pay from team shifts this week.</p>
        ${a ? d.workers.map(w => `<div class="person-head" style="margin-bottom: 4px">${avatar(w.id)}<strong>${esc(w.name)}</strong><span>${money(a.totals[w.id])}</span></div><div class="bar"><span style="width: ${((a.totals[w.id] || 0) / max) * 100}%"></span></div>`).join('') : '<div class="empty">Run the allocation to see the split.</div>'}
      </div>
    </div>`;
  }

  function team() {
    const d = DB.data;
    const a = d.allocation;
    return `
    <div class="grid grid-2">
      <div class="card">
        <h2>Add someone</h2>
        <p class="lead">They'll be able to sign in as a worker straight away.</p>
        <form data-form="worker" class="form-grid" novalidate>
          <div class="field" style="grid-column: 1 / -1"><label for="w_name">Name</label><input class="input" id="w_name" name="name" placeholder="Sam Taylor" required></div>
          <button class="btn btn-primary">Add to team</button>
        </form>
      </div>
      <div class="card">
        <h2>Roster</h2>
        <p class="lead">${d.workers.length} ${d.workers.length === 1 ? 'person' : 'people'}. Removing someone clears the allocation so their shifts can be shared again.</p>
        ${d.workers.length ? d.workers.map(w => {
          const p = d.profiles[w.id] || {};
          return `<div class="person"><div class="person-head" style="margin: 0">${avatar(w.id)}<div style="flex: 1"><strong>${esc(w.name)}</strong>${p.about ? `<div class="meta" style="font-size: 13px; color: var(--ink-3)">${esc(p.about)}</div>` : ''}</div><span>${a ? `${(a.assigned[w.id] || []).length} shifts · ${money(a.totals[w.id])}` : ''}</span><button class="btn btn-quiet btn-sm" data-action="remove-worker" data-id="${esc(w.id)}">Remove</button></div></div>`;
        }).join('') : '<div class="empty"><strong>No one yet</strong>Add at least two people to share a pool between them.</div>'}
      </div>
    </div>`;
  }

  function pool() {
    const d = DB.data;
    const shifts = [...d.pool].sort(byStart);
    return `
    <div class="grid grid-2">
      <div class="card">
        <h2>Add an open shift</h2>
        <p class="lead">Overnight shifts are fine: an end time earlier than the start rolls into the next day.</p>
        <form data-form="pool" class="form-grid" novalidate>
          <div class="field" style="grid-column: 1 / -1"><label for="p_job">Job</label><input class="input" id="p_job" name="job" placeholder="Events" required></div>
          <div class="field"><label for="p_date">Date</label><input class="input" id="p_date" name="date" type="date" required></div>
          <div class="field"><label for="p_start">Start</label><input class="input" id="p_start" name="start" type="time" required></div>
          <div class="field"><label for="p_end">End</label><input class="input" id="p_end" name="end" type="time" required></div>
          <div class="field"><label for="p_rate">£ per hour</label><input class="input" id="p_rate" name="rate" type="number" step="0.01" min="0" placeholder="12.50" required></div>
          <button class="btn btn-primary" style="grid-column: 1 / -1">Add to pool</button>
        </form>
      </div>
      <div class="card">
        <h2>Open shifts</h2>
        <p class="lead">${shifts.length} shifts worth ${money(shifts.reduce((s, x) => s + S.shiftValue(x), 0))}.</p>
        ${shifts.length ? shifts.map(s => shiftRow(s, `<button class="btn btn-quiet btn-sm" data-action="remove-pool" data-id="${esc(s.id)}">Remove</button>`)).join('') : '<div class="empty"><strong>The pool is empty</strong>Add the shifts you need covering.</div>'}
      </div>
    </div>`;
  }

  function allocation() {
    const d = DB.data;
    const a = d.allocation;
    const stale = a && a.poolSignature !== poolSignature(d.pool);
    const suggestions = a ? S.suggestSwaps(a) : [];
    const max = a ? Math.max(...Object.values(a.totals), 0.01) : 1;
    const n = names();

    return `
    <div class="card">
      <div class="card-head">
        <div><h2>Share the pool</h2><p class="lead">Biggest shifts first, each going to whoever has earned least so far and is free at that time.</p></div>
        <button class="btn btn-primary" data-action="allocate">${a ? 'Run again' : 'Run allocation'}</button>
      </div>
      ${stale ? `<div class="callout attention" style="margin-bottom: 14px">${ICON.stack}<div>The pool has changed since this was run. Run it again to include the changes. Open swap requests will be closed and the people involved told.</div></div>` : ''}
      ${a ? `
        <div class="stats" style="margin-top: 4px">
          <div class="stat"><div class="k">Pay gap</div><div class="v">${money(S.spread(a.totals))}</div><div class="s">highest vs lowest</div></div>
          <div class="stat ${a.unassigned.length ? 'attention' : ''}"><div class="k">Couldn't place</div><div class="v">${a.unassigned.length}</div><div class="s">would clash for everyone</div></div>
        </div>
        ${d.workers.map(w => `
          <div class="person">
            <div class="person-head">${avatar(w.id)}<strong>${esc(w.name)}</strong><span>${money(a.totals[w.id])}</span></div>
            <div class="bar"><span style="width: ${((a.totals[w.id] || 0) / max) * 100}%"></span></div>
            ${(a.assigned[w.id] || []).length ? [...a.assigned[w.id]].sort(byStart).map(s => shiftRow(s)).join('') : '<div class="meta" style="color: var(--ink-3)">No shifts</div>'}
          </div>`).join('')}` : `<div class="empty"><strong>Not run yet</strong>Add at least two people and some open shifts, then run it.</div>`}
    </div>
    ${a ? `<div class="card">
      <h2>Suggested swaps</h2>
      <p class="lead">One-for-one trades between the highest and lowest earner that would narrow the gap. Applying one tells both people.</p>
      ${suggestions.length ? suggestions.map((s, i) => `
        <div class="request">
          <div class="card-head"><strong>${esc(n[s.highId])} ⇄ ${esc(n[s.lowId])}</strong><span class="pill pill-good">Gap ${money(s.oldGap)} → ${money(s.newGap)}</span></div>
          <div class="trade"><div><div class="meta">${esc(n[s.highId])} gives</div>${shiftRow(s.hShift)}</div><span class="arrow" aria-hidden="true">⇄</span><div><div class="meta">${esc(n[s.lowId])} gives</div>${shiftRow(s.lShift)}</div></div>
          <div class="buttons"><button class="btn btn-secondary" data-action="apply-suggestion" data-index="${i}">Apply this swap</button></div>
        </div>`).join('') : '<div class="empty"><strong>Already balanced</strong>No single trade would make the split fairer.</div>'}
    </div>` : ''}`;
  }

  function leadSwaps() {
    const reqs = DB.data.requests;
    const waiting = reqs.filter(r => r.status === 'awaiting_coordinator');
    const history = reqs.filter(r => !W.isOpen(r)).sort((x, y) => y.createdAt - x.createdAt).slice(0, 8);
    const pendingColleague = reqs.filter(r => r.status === 'offered');

    const decideForm = r => {
      const check = S.checkSwap(DB.data.allocation, r.fromWorkerId, r.fromShift.id, r.toWorkerId, r.toShift.id);
      return `
      ${check.ok ? '' : `<div class="callout attention" style="margin-top: 10px">${esc(check.reason)} Approving isn't possible, so reject it with that reason.</div>`}
      <form data-form="decide" data-id="${esc(r.id)}" class="grid" style="gap: 8px; margin-top: 12px" novalidate>
        <label class="label" for="r-${esc(r.id)}">Reason (needed if you reject, both workers see it)</label>
        <input class="input" id="r-${esc(r.id)}" name="reason" maxlength="160" placeholder="Ben isn't SIA licensed for the door shift">
        <div class="buttons" style="display: flex; gap: 8px; flex-wrap: wrap">
          <button class="btn btn-primary" name="decision" value="approve" ${check.ok ? '' : 'disabled'}>Approve swap</button>
          <button class="btn btn-danger" name="decision" value="reject">Reject</button>
        </div>
      </form>`;
    };

    return `
    <div class="card">
      <h2>Waiting for your decision</h2>
      <p class="lead">Both workers have already agreed. Each is re-checked for clashes before you can approve.</p>
      ${waiting.length ? waiting.map(r => requestCard(r, LEAD, decideForm(r))).join('') : '<div class="empty"><strong>Nothing to decide</strong>Swaps appear here once the colleague has accepted.</div>'}
    </div>
    ${pendingColleague.length ? `<div class="card"><h2>Waiting on a colleague</h2><p class="lead">Not with you yet: the worker being asked hasn't answered.</p>${pendingColleague.map(r => requestCard(r, LEAD)).join('')}</div>` : ''}
    <div class="card">
      <h2>Recent decisions</h2>
      <p class="lead">The last eight closed requests.</p>
      ${history.length ? history.map(r => requestCard(r, LEAD)).join('') : '<div class="empty">No closed requests yet.</div>'}
    </div>`;
  }

  function guide() {
    const worker = session.role === 'worker';
    return `
    <div class="grid grid-2">
      <div class="card guide">
        <h3>The tabs</h3>
        ${(worker ? WORKER_TABS : LEAD_TABS).filter(t => t[0] !== 'guide').map(([, label, , text]) => `<p><strong>${label}.</strong> ${text}</p>`).join('')}
      </div>
      <div class="card guide">
        <h3>How a swap works</h3>
        <ol class="steps">
          <li>A worker lists a shift they'd like to swap. Only that shift becomes visible to colleagues.</li>
          <li>A colleague offers one of their own shifts for it, with an optional message.</li>
          <li>The worker who listed it accepts or declines. Either way, the colleague is told.</li>
          <li>If accepted, the coordinator approves, or rejects with a reason. Both workers are told the outcome.</li>
          <li>If anyone's shifts change in the meantime, the request closes automatically and everyone involved is told.</li>
        </ol>
        <h3>How the shift planner picks</h3>
        <p>It sorts your offers by finish time and, for each one, compares taking it with skipping it, keeping whichever leaves you with more money. That's a dynamic-programming method called weighted interval scheduling, and it always finds the best answer, overnight shifts included.</p>
        <h3>How the pool is shared</h3>
        <p>Biggest shifts are handed out first, each to whoever has earned least so far and isn't already working then. A second pass then suggests one-for-one trades that narrow the gap between the top and bottom earner.</p>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  function render() {
    if (session && session.role === 'worker' && !DB.data.workers.some(w => w.id === session.workerId)) {
      session = null; // this worker was removed while signed in
      sessionStorage.removeItem('shiftOps.session');
    }
    if (!session) { root.innerHTML = gate(); return; }

    const views = session.role === 'worker'
      ? { overview: workerOverview, schedule, planner, swaps: workerSwaps, inbox, profile, guide }
      : { overview: leadOverview, team, pool, allocation, swaps: leadSwaps, inbox, guide };
    if (!views[tab]) tab = 'overview';
    root.innerHTML = shell(views[tab]());
    // on a phone the tabs scroll sideways; keep the current one in view
    if (window.innerWidth <= 900) document.querySelector('.nav [aria-current]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function go(next) {
    tab = next;
    ui.decliningId = null;
    render();
    window.scrollTo(0, 0);
  }

  // ---------------------------------------------------------------------------
  // actions
  // ---------------------------------------------------------------------------

  function runAllocation(silent) {
    const d = DB.data;
    if (d.workers.length < 2) return toast('Add at least two people first.', 'error');
    if (!d.pool.length) return toast('Add some shifts to the pool first.', 'error');
    const result = S.allocateFairly(d.workers, d.pool);
    result.poolSignature = poolSignature(d.pool);
    DB.update(x => { x.allocation = result; });
    tidyAfterShiftsMoved();
    // tell everyone what they've got
    DB.notify(d.workers.map(w => {
      const mine = result.assigned[w.id] || [];
      return { to: w.id, text: mine.length ? `You've been given ${mine.length} shift${mine.length > 1 ? 's' : ''} this week, worth ${money(result.totals[w.id])}.` : 'The new allocation didn\'t give you any shifts this week.', link: 'schedule', at: Date.now(), read: false };
    }));
    if (!silent) toast('Shifts shared out. Everyone has been told.');
  }

  // approve or apply a trade on the allocation itself
  function moveShifts(aId, aShiftId, bId, bShiftId) {
    const next = S.applySwap(DB.data.allocation, aId, aShiftId, bId, bShiftId);
    DB.update(d => { d.allocation = { ...next, poolSignature: d.allocation.poolSignature }; });
    tidyAfterShiftsMoved();
  }

  function sampleData() {
    DB.clear();
    const pad = n => String(n).padStart(2, '0');
    const day = k => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const shift = (job, k, start, end, rate) => ({ id: DB.uid(), job, date: day(k), start, end, rate });
    const workers = ['Amara Okafor', 'Ben Hughes', 'Chloe Martin', 'Dami Adeyemi'].map(name => ({ id: DB.uid(), name }));

    DB.update(d => {
      d.workers = workers;
      d.pool = [
        shift('Events', 1, '17:00', '23:00', 12.5), shift('Events', 1, '18:00', '23:30', 12.5),
        shift('Security', 2, '08:00', '16:00', 13.2), shift('Security', 2, '22:00', '06:00', 14),
        shift('Hospitality', 3, '10:00', '18:00', 11.9), shift('Hospitality', 3, '12:00', '20:00', 11.9),
        shift('Teaching assistant', 4, '08:30', '15:30', 12), shift('Events', 5, '16:00', '23:00', 13),
        shift('Security', 6, '18:00', '02:00', 14), shift('Hospitality', 6, '09:00', '15:00', 11.9)
      ];
      d.offers[workers[0].id] = [
        shift('Security', 8, '09:00', '17:00', 13.2), shift('Hospitality', 8, '12:00', '20:00', 11.9),
        shift('Events', 8, '18:00', '23:00', 14.5), shift('Security', 9, '22:00', '06:00', 14),
        shift('Teaching assistant', 10, '05:00', '12:00', 12)
      ];
      d.profiles[workers[0].id] = { about: 'Final-year student. Evenings and weekends.' };
      d.profiles[workers[1].id] = { about: 'SIA licensed. Happy to do nights.' };
    });
    runAllocation(true);

    // set up a couple of swaps so every screen has something on it
    const a = DB.data.allocation;
    const n = names();
    const findPair = (x, y) => {
      for (const sx of a.assigned[x.id]) for (const sy of a.assigned[y.id]) {
        if (S.checkSwap(a, x.id, sx.id, y.id, sy.id).ok) return [sx, sy];
      }
      return null;
    };
    const [amara, ben, chloe, dami] = workers;
    const p1 = findPair(amara, ben);
    if (p1) {
      DB.update(d => { d.listings.push({ workerId: ben.id, shiftId: p1[1].id }); });
      const r = W.offer({ id: DB.uid(), fromWorkerId: amara.id, fromShift: p1[0], toWorkerId: ben.id, toShift: p1[1], message: 'I have a seminar that morning, would really help' }, [], Date.now() - 3600e3, n, shiftLabel);
      DB.update(d => { d.requests.push(r.request); });
      DB.notify(r.notifications);
    }
    const p2 = findPair(chloe, dami);
    if (p2) {
      DB.update(d => { d.listings.push({ workerId: dami.id, shiftId: p2[1].id }); });
      let r = W.offer({ id: DB.uid(), fromWorkerId: chloe.id, fromShift: p2[0], toWorkerId: dami.id, toShift: p2[1] }, [], Date.now() - 7200e3, n, shiftLabel);
      DB.notify(r.notifications);
      const accepted = W.respond(r.request, dami.id, true, '', Date.now() - 3000e3, n, shiftLabel, LEAD);
      DB.update(d => { d.requests.push(accepted.request); });
      DB.notify(accepted.notifications);
    }
  }

  // photos from phones are huge; shrink to a 160px square before saving
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 160;
        const side = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  function readShift(form) {
    const f = new FormData(form);
    return { id: DB.uid(), job: String(f.get('job') || '').trim(), date: f.get('date'), start: f.get('start'), end: f.get('end'), rate: parseFloat(f.get('rate')) };
  }

  // ---------------------------------------------------------------------------
  // events: one listener per type for the whole app
  // ---------------------------------------------------------------------------

  root.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const act = el.dataset.action;
    const id = el.dataset.id;
    const now = Date.now();
    const n = names();
    if (el.tagName === 'A') e.preventDefault();

    if (act === 'role') { ui.role = el.dataset.role; render(); document.getElementById('code')?.focus(); return; }
    if (act === 'sample') { sampleData(); toast('Sample team loaded. Sign in as a worker or the coordinator.'); render(); return; }
    if (act === 'clear') { DB.clear(); toast('All data cleared.'); render(); return; }
    if (act === 'tab') { go(el.dataset.tab); return; }
    if (act === 'signout') { session = null; ui.role = null; sessionStorage.removeItem('shiftOps.session'); tab = 'overview'; render(); return; }

    // worker actions
    if (act === 'list' || act === 'unlist') {
      DB.update(d => {
        d.listings = d.listings.filter(l => !(l.workerId === session.workerId && l.shiftId === id));
        if (act === 'list') d.listings.push({ workerId: session.workerId, shiftId: id });
      });
      if (act === 'unlist') {
        // anyone who'd offered for it is told it's off the board
        const affected = DB.data.requests.filter(r => r.status === 'offered' && r.toShift.id === id);
        affected.forEach(r => {
          const res = W.respond(r, session.workerId, false, 'I took this shift off the swap board', now, n, shiftLabel, LEAD);
          DB.update(d => { d.requests = d.requests.map(x => x.id === r.id ? res.request : x); });
          DB.notify(res.notifications);
        });
      }
      toast(act === 'list' ? 'Listed. Colleagues can now offer you a swap for it.' : 'Taken off the swap board.');
      render(); return;
    }
    if (act === 'remove-offer') {
      DB.update(d => { d.offers[session.workerId] = (d.offers[session.workerId] || []).filter(o => o.id !== id); });
      render(); return;
    }
    if (act === 'accept') {
      const r = DB.data.requests.find(x => x.id === id);
      const check = S.checkSwap(DB.data.allocation, r.fromWorkerId, r.fromShift.id, r.toWorkerId, r.toShift.id);
      if (!check.ok) return toast(check.reason, 'error');
      const res = W.respond(r, session.workerId, true, '', now, n, shiftLabel, LEAD);
      if (!res.ok) return toast(res.error, 'error');
      DB.update(d => { d.requests = d.requests.map(x => x.id === id ? res.request : x); });
      DB.notify(res.notifications);
      toast('Accepted. It\'s with the coordinator now, and you\'ll be told the outcome.');
      render(); return;
    }
    if (act === 'start-decline') { ui.decliningId = id; render(); document.getElementById('why-' + id)?.focus(); return; }
    if (act === 'cancel-decline') { ui.decliningId = null; render(); return; }
    if (act === 'withdraw') {
      const r = DB.data.requests.find(x => x.id === id);
      const res = W.withdraw(r, session.workerId, now, n, shiftLabel);
      if (!res.ok) return toast(res.error, 'error');
      DB.update(d => { d.requests = d.requests.map(x => x.id === id ? res.request : x); });
      DB.notify(res.notifications);
      toast('Offer withdrawn.');
      render(); return;
    }
    if (act === 'read-all') { DB.update(d => { d.notifications.forEach(x => { if (x.to === me()) x.read = true; }); }); render(); return; }
    if (act === 'open-note') {
      const note = DB.data.notifications.find(x => x.id === id);
      DB.update(() => { note.read = true; });
      go(note.link || 'overview'); return;
    }

    // coordinator actions
    if (act === 'remove-worker') {
      const name = workerName(id);
      DB.update(d => { d.workers = d.workers.filter(w => w.id !== id); d.allocation = null; });
      tidyAfterShiftsMoved();
      toast(`${name} removed. Run the allocation again to reshare their shifts.`);
      render(); return;
    }
    if (act === 'remove-pool') { DB.update(d => { d.pool = d.pool.filter(s => s.id !== id); }); render(); return; }
    if (act === 'allocate') { runAllocation(); render(); return; }
    if (act === 'apply-suggestion') {
      const s = S.suggestSwaps(DB.data.allocation)[Number(el.dataset.index)];
      if (!s) return;
      moveShifts(s.highId, s.hShift.id, s.lowId, s.lShift.id);
      DB.notify([
        { to: s.highId, text: `Your coordinator moved you from the ${shiftLabel(s.hShift)} to the ${shiftLabel(s.lShift)} to even out hours.`, link: 'schedule', at: now, read: false },
        { to: s.lowId, text: `Your coordinator moved you from the ${shiftLabel(s.lShift)} to the ${shiftLabel(s.hShift)} to even out hours.`, link: 'schedule', at: now, read: false }
      ]);
      toast('Swap applied. Both workers have been told.');
      render();
    }
  });

  root.addEventListener('submit', e => {
    e.preventDefault();
    const form = e.target;
    const f = new FormData(form);
    const now = Date.now();
    const n = names();

    if (form.dataset.form === 'signin') {
      const code = String(f.get('code') || '').trim().toUpperCase();
      if (code !== CODES[ui.role]) return toast('That code isn\'t right. The demo codes are shown below.', 'error');
      if (ui.role === 'worker') {
        const workerId = f.get('who');
        if (!workerId) return toast('Pick who you are first.', 'error');
        session = { role: 'worker', workerId };
      } else {
        session = { role: 'coordinator' };
      }
      sessionStorage.setItem('shiftOps.session', JSON.stringify(session));
      tab = 'overview';
      render();
      window.scrollTo(0, 0);
      return;
    }

    if (form.dataset.form === 'offer' || form.dataset.form === 'pool') {
      const s = readShift(form);
      const problem = S.validateShift(s);
      if (problem) return toast(problem, 'error');
      DB.update(d => {
        if (form.dataset.form === 'offer') d.offers[session.workerId] = [...(d.offers[session.workerId] || []), s];
        else d.pool.push(s);
      });
      toast(form.dataset.form === 'offer' ? 'Offer added.' : 'Added to the pool.');
      render(); return;
    }

    if (form.dataset.form === 'worker') {
      const name = String(f.get('name') || '').trim();
      if (name.length < 2) return toast('Add a name.', 'error');
      if (DB.data.workers.some(w => w.name.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on the team.`, 'error');
      DB.update(d => { d.workers.push({ id: DB.uid(), name }); });
      toast(`${name} added.`);
      render(); return;
    }

    if (form.dataset.form === 'offer-swap') {
      const a = DB.data.allocation;
      const giveId = f.get('give');
      const owner = form.dataset.owner;
      const wantId = form.dataset.shift;
      const check = S.checkSwap(a, session.workerId, giveId, owner, wantId);
      if (!check.ok) return toast(check.reason, 'error');
      const res = W.offer({ id: DB.uid(), fromWorkerId: session.workerId, fromShift: check.aShift, toWorkerId: owner, toShift: check.bShift, message: f.get('message') || '' }, DB.data.requests, now, n, shiftLabel);
      if (!res.ok) return toast(res.error, 'error');
      DB.update(d => { d.requests.push(res.request); });
      DB.notify(res.notifications);
      toast(`Offer sent. ${workerName(owner)} has been told.`);
      render(); return;
    }

    if (form.dataset.form === 'decline') {
      const r = DB.data.requests.find(x => x.id === form.dataset.id);
      const res = W.respond(r, session.workerId, false, f.get('reason'), now, n, shiftLabel, LEAD);
      if (!res.ok) return toast(res.error, 'error');
      DB.update(d => { d.requests = d.requests.map(x => x.id === r.id ? res.request : x); });
      DB.notify(res.notifications);
      ui.decliningId = null;
      toast('Declined. They\'ve been told.');
      render(); return;
    }

    if (form.dataset.form === 'decide') {
      const r = DB.data.requests.find(x => x.id === form.dataset.id);
      const approve = e.submitter && e.submitter.value === 'approve';
      if (approve) {
        const check = S.checkSwap(DB.data.allocation, r.fromWorkerId, r.fromShift.id, r.toWorkerId, r.toShift.id);
        if (!check.ok) return toast(check.reason, 'error');
      }
      const res = W.decide(r, approve, f.get('reason'), now, n, shiftLabel, LEAD);
      if (!res.ok) return toast(res.error, 'error');
      DB.update(d => { d.requests = d.requests.map(x => x.id === r.id ? res.request : x); });
      DB.notify(res.notifications);
      if (approve) moveShifts(r.fromWorkerId, r.fromShift.id, r.toWorkerId, r.toShift.id);
      toast(approve ? 'Approved. Both workers have been told.' : 'Rejected. Both workers have been told why.');
      render(); return;
    }

    if (form.dataset.form === 'profile') {
      DB.update(d => { d.profiles[session.workerId] = { ...(d.profiles[session.workerId] || {}), about: String(f.get('about') || '').trim().slice(0, 200) }; });
      toast('Profile saved.');
      render();
    }
  });

  root.addEventListener('change', async e => {
    if (e.target.dataset.action !== 'photo') return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const avatarData = await shrinkImage(file);
      const saved = DB.update(d => { d.profiles[session.workerId] = { ...(d.profiles[session.workerId] || {}), avatar: avatarData }; });
      toast(saved ? 'Photo updated.' : 'Couldn\'t save: browser storage is full.', saved ? '' : 'error');
      render();
    } catch {
      toast('That image couldn\'t be read.', 'error');
    }
  });

  // another tab changed something (e.g. coordinator approved a swap): refresh
  window.addEventListener('storage', () => { DB.reload(); render(); });

  render();
})();
