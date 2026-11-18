// swaps.js
// How a swap request moves between people, and who gets told at each step.
//
// The first version sent every trade straight to the coordinator, which
// skipped the person whose shift was being asked for, and when a swap was
// rejected nobody heard about it. Now it goes:
//
//   offered --colleague accepts--> awaiting_coordinator --approve--> approved
//      |                                   |
//   colleague declines -> declined     reject (with a reason) -> rejected
//   requester withdraws -> withdrawn   shifts moved meanwhile -> expired
//
// Like scheduling.js, nothing here touches the page or storage. Each action
// returns the updated request plus a list of notifications to send, so the
// app just has to save them.

(function (root) {
  const OPEN_STATES = ['offered', 'awaiting_coordinator'];

  function isOpen(request) {
    return OPEN_STATES.includes(request.status);
  }

  function moved(request, status, by, now, extra = {}) {
    return {
      ...request,
      ...extra,
      status,
      history: [...(request.history || []), { status, by, at: now, note: extra.reason || '' }]
    };
  }

  // a notification is just: who it's for, what it says, where it links
  function note(to, text, link, now) {
    return { to, text, link, at: now, read: false };
  }

  // names: id -> display name, so messages read like a person wrote them
  // shiftLabel: a shift -> "Events · Sat 21 Nov 17:00–23:00"
  function describe(request, names, shiftLabel) {
    return {
      from: names[request.fromWorkerId] || 'A colleague',
      to: names[request.toWorkerId] || 'a colleague',
      give: shiftLabel(request.fromShift),
      get: shiftLabel(request.toShift)
    };
  }

  // A worker offers one of their shifts for a colleague's listed shift.
  function offer({ id, fromWorkerId, fromShift, toWorkerId, toShift, message = '' }, existing, now, names, shiftLabel) {
    if (fromWorkerId === toWorkerId) return { ok: false, error: 'You can\'t swap with yourself.' };
    const duplicate = existing.some(r => isOpen(r) && r.fromShift.id === fromShift.id && r.toShift.id === toShift.id);
    if (duplicate) return { ok: false, error: 'You\'ve already offered that swap.' };

    const request = {
      id, fromWorkerId, toWorkerId, fromShift, toShift,
      message: String(message).trim().slice(0, 200),
      status: 'offered', createdAt: now,
      history: [{ status: 'offered', by: fromWorkerId, at: now, note: '' }]
    };
    const d = describe(request, names, shiftLabel);
    return {
      ok: true,
      request,
      notifications: [note(toWorkerId, `${d.from} wants to swap: their ${d.give} for your ${d.get}.`, 'swaps', now)]
    };
  }

  // The colleague whose shift was asked for says yes or no first.
  function respond(request, workerId, accept, reason, now, names, shiftLabel, coordinatorId) {
    if (request.status !== 'offered') return { ok: false, error: 'This request has already been answered.' };
    if (workerId !== request.toWorkerId) return { ok: false, error: 'Only the person being asked can answer.' };
    const d = describe(request, names, shiftLabel);

    if (accept) {
      return {
        ok: true,
        request: moved(request, 'awaiting_coordinator', workerId, now),
        notifications: [
          note(request.fromWorkerId, `${d.to} accepted your swap. It's now with the coordinator for approval.`, 'swaps', now),
          note(coordinatorId, `${d.from} and ${d.to} want to swap shifts. Needs your approval.`, 'swaps', now)
        ]
      };
    }
    const why = String(reason || '').trim();
    return {
      ok: true,
      request: moved(request, 'declined', workerId, now, { reason: why }),
      notifications: [note(request.fromWorkerId, `${d.to} declined your swap for the ${d.get}.${why ? ` They said: "${why}"` : ''}`, 'swaps', now)]
    };
  }

  // The coordinator has the final say. A rejection needs a reason so
  // nobody's left guessing why.
  function decide(request, approve, reason, now, names, shiftLabel, coordinatorId) {
    if (request.status !== 'awaiting_coordinator') return { ok: false, error: 'This request isn\'t waiting for approval.' };
    const d = describe(request, names, shiftLabel);
    const why = String(reason || '').trim();

    if (approve) {
      return {
        ok: true,
        request: moved(request, 'approved', coordinatorId, now),
        notifications: [
          note(request.fromWorkerId, `Swap approved. You're now on the ${d.get} instead of the ${d.give}.`, 'schedule', now),
          note(request.toWorkerId, `Swap approved. You're now on the ${d.give} instead of the ${d.get}.`, 'schedule', now)
        ]
      };
    }
    if (why.length < 5) return { ok: false, error: 'Add a short reason so both people know why.' };
    return {
      ok: true,
      request: moved(request, 'rejected', coordinatorId, now, { reason: why }),
      notifications: [
        note(request.fromWorkerId, `Your swap with ${d.to} was rejected. Reason: "${why}". Your shifts haven't changed.`, 'swaps', now),
        note(request.toWorkerId, `The swap with ${d.from} was rejected. Reason: "${why}". Your shifts haven't changed.`, 'swaps', now)
      ]
    };
  }

  function withdraw(request, workerId, now, names, shiftLabel) {
    if (!isOpen(request)) return { ok: false, error: 'This request is already closed.' };
    if (workerId !== request.fromWorkerId) return { ok: false, error: 'Only the person who offered can withdraw.' };
    const d = describe(request, names, shiftLabel);
    return {
      ok: true,
      request: moved(request, 'withdrawn', workerId, now),
      notifications: [note(request.toWorkerId, `${d.from} withdrew their swap offer for your ${d.get}.`, 'swaps', now)]
    };
  }

  // When shifts move (a new allocation, another swap approved), any open
  // request that mentions them can't happen any more. Close them and say so.
  function expire(requests, stillValid, now, names, shiftLabel) {
    const notifications = [];
    const updated = requests.map(r => {
      if (!isOpen(r) || stillValid(r)) return r;
      const d = describe(r, names, shiftLabel);
      notifications.push(note(r.fromWorkerId, `Your swap request for the ${d.get} was closed because the shifts changed.`, 'swaps', now));
      if (r.status === 'awaiting_coordinator') {
        notifications.push(note(r.toWorkerId, `The swap with ${d.from} was closed because the shifts changed.`, 'swaps', now));
      }
      return moved(r, 'expired', 'system', now);
    });
    return { requests: updated, notifications };
  }

  // plain-English status for the UI
  const STATUS_TEXT = {
    offered: 'Waiting for your colleague',
    awaiting_coordinator: 'Waiting for coordinator',
    approved: 'Approved',
    declined: 'Declined',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
    expired: 'Closed'
  };

  const api = { offer, respond, decide, withdraw, expire, isOpen, STATUS_TEXT };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Swaps = api;
})(typeof window !== 'undefined' ? window : globalThis);
