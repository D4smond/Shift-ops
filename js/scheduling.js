// scheduling.js
// All the actual algorithm work lives in here, kept separate from the UI so
// I can test it on its own with Node (see tests/scheduling.test.js).
// Nothing in this file touches the DOM or localStorage.

(function (root) {
  const MINS_PER_DAY = 24 * 60;

  // "09:30" -> 570
  function toMinutes(time) {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  // Turns a date string into a whole day number so shifts on different days
  // can be compared on one timeline. Using UTC on purpose so the clocks
  // changing in March/October doesn't shift anything by an hour.
  function dayNumber(dateStr) {
    const [y, mo, d] = dateStr.split('-').map(Number);
    return Math.round(Date.UTC(y, mo - 1, d) / 86400000);
  }

  // Converts a shift into absolute start/end minutes.
  // If the end time is earlier than the start (e.g. 22:00 - 06:00) it's an
  // overnight shift, so the end rolls into the next day. The old version only
  // compared shifts on the same date, which meant a night shift could quietly
  // clash with an early shift the next morning.
  function toInterval(shift) {
    const start = dayNumber(shift.date) * MINS_PER_DAY + toMinutes(shift.start);
    let length = toMinutes(shift.end) - toMinutes(shift.start);
    if (length <= 0) length += MINS_PER_DAY;
    return { start, end: start + length };
  }

  function shiftHours(shift) {
    const { start, end } = toInterval(shift);
    return (end - start) / 60;
  }

  // Pay for the whole shift. Rounded to pennies so totals don't end up as
  // 49.999999999.
  function shiftValue(shift) {
    return Math.round(shiftHours(shift) * shift.rate * 100) / 100;
  }

  // Back-to-back shifts (one ends 17:00, next starts 17:00) are allowed,
  // hence < rather than <=.
  function overlaps(a, b) {
    const x = toInterval(a);
    const y = toInterval(b);
    return x.start < y.end && y.start < x.end;
  }

  function clashesWithAny(shift, others) {
    return others.some(other => other.id !== shift.id && overlaps(shift, other));
  }

  // Basic sanity checks before a shift gets saved. Returns an error message,
  // or null if it's fine.
  function validateShift(shift) {
    if (!shift.job || !shift.job.trim()) return 'Give the shift a job name.';
    if (!shift.date) return 'Pick a date.';
    if (!shift.start || !shift.end) return 'Add a start and end time.';
    if (shift.start === shift.end) return 'Start and end time are the same.';
    if (!(shift.rate >= 0)) return 'Pay rate needs to be a number.';
    if (shiftHours(shift) > 16) return 'That shift is over 16 hours, check the times.';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Weighted interval scheduling
  // Given a pile of shift offers that might overlap, pick the set with the
  // highest total pay where nothing clashes.
  //
  // 1. sort by end time
  // 2. for each shift i, find p(i) = the last shift that finishes before i starts
  // 3. best(i) = max(skip i -> best(i-1), take i -> value(i) + best(p(i)))
  // 4. walk back through the table to recover which shifts were picked
  //
  // O(n log n) because p(i) is found with a binary search instead of a scan.
  // ---------------------------------------------------------------------------
  function solveSchedule(shifts) {
    if (!shifts || shifts.length === 0) return { chosen: [], total: 0 };

    // startMin/endMin rather than start/end so the original "09:00" strings
    // are still there for displaying the result
    const items = shifts
      .map(s => {
        const { start, end } = toInterval(s);
        return { ...s, startMin: start, endMin: end, hours: shiftHours(s), value: shiftValue(s) };
      })
      .sort((a, b) => a.endMin - b.endMin);
    const n = items.length;

    // p[i] = index of the latest shift ending at or before items[i] starts, or -1
    const p = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      let lo = 0;
      let hi = i - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (items[mid].endMin <= items[i].startMin) {
          p[i] = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }

    // best[k] = best total using only the first k shifts (so best[0] = 0).
    // Shifting by one avoids a load of "if index >= 0" checks.
    const best = new Array(n + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const take = items[i].value + best[p[i] + 1];
      const skip = best[i];
      best[i + 1] = Math.max(take, skip);
    }

    // Backtrack: if taking shift i is what produced best[i+1], it's in.
    const chosen = [];
    let i = n - 1;
    while (i >= 0) {
      const take = items[i].value + best[p[i] + 1];
      if (take === best[i + 1]) {
        chosen.push(items[i]);
        i = p[i];
      } else {
        i--;
      }
    }

    return { chosen: chosen.reverse(), total: Math.round(best[n] * 100) / 100 };
  }

  // ---------------------------------------------------------------------------
  // Fair allocation of a shared pool
  // Greedy: biggest shifts first, each one goes to whoever has earned the
  // least so far *and* is free at that time. Same idea as the LPT rule for
  // balancing jobs across machines.
  // ---------------------------------------------------------------------------
  function allocateFairly(workers, pool) {
    const assigned = {};
    const totals = {};
    workers.forEach(w => { assigned[w.id] = []; totals[w.id] = 0; });

    const items = pool
      .map(s => ({ ...s, hours: shiftHours(s), value: shiftValue(s) }))
      .sort((a, b) => b.value - a.value);

    const unassigned = [];
    for (const shift of items) {
      const free = workers.filter(w => !clashesWithAny(shift, assigned[w.id]));
      if (free.length === 0) {
        unassigned.push(shift);
        continue;
      }
      // lowest earner wins; ties go to whoever has fewer shifts, then by name
      // so running it twice always gives the same answer
      free.sort((a, b) =>
        totals[a.id] - totals[b.id] ||
        assigned[a.id].length - assigned[b.id].length ||
        a.name.localeCompare(b.name)
      );
      const winner = free[0].id;
      assigned[winner].push(shift);
      totals[winner] = round2(totals[winner] + shift.value);
    }

    return { assigned, totals, unassigned };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function spread(totals) {
    const values = Object.values(totals);
    if (values.length === 0) return 0;
    return round2(Math.max(...values) - Math.min(...values));
  }

  // Recalculating from scratch after every change rather than adding and
  // subtracting, so the totals can't drift out of sync with the actual shifts.
  function recalcTotals(allocation) {
    const totals = {};
    for (const [workerId, shifts] of Object.entries(allocation.assigned)) {
      totals[workerId] = round2(shifts.reduce((sum, s) => sum + shiftValue(s), 0));
    }
    return { ...allocation, totals };
  }

  function findShift(allocation, workerId, shiftId) {
    return (allocation.assigned[workerId] || []).find(s => s.id === shiftId) || null;
  }

  // Can worker A give shift aShiftId to worker B in exchange for bShiftId?
  // Used for the algorithm's own suggestions *and* for approving requests, so
  // there's only one place the clash rule lives.
  function checkSwap(allocation, aId, aShiftId, bId, bShiftId) {
    if (aId === bId) return { ok: false, reason: 'Both shifts belong to the same person.' };
    const aShift = findShift(allocation, aId, aShiftId);
    const bShift = findShift(allocation, bId, bShiftId);
    if (!aShift || !bShift) return { ok: false, reason: 'One of these shifts has already moved.' };

    const aRest = allocation.assigned[aId].filter(s => s.id !== aShiftId);
    const bRest = allocation.assigned[bId].filter(s => s.id !== bShiftId);
    if (clashesWithAny(bShift, aRest)) return { ok: false, reason: 'The swap would double-book the first worker.' };
    if (clashesWithAny(aShift, bRest)) return { ok: false, reason: 'The swap would double-book the second worker.' };

    return { ok: true, aShift, bShift };
  }

  // Returns a new allocation with the two shifts swapped (doesn't mutate the
  // one passed in).
  function applySwap(allocation, aId, aShiftId, bId, bShiftId) {
    const check = checkSwap(allocation, aId, aShiftId, bId, bShiftId);
    if (!check.ok) throw new Error(check.reason);

    const assigned = { ...allocation.assigned };
    assigned[aId] = assigned[aId].filter(s => s.id !== aShiftId).concat(check.bShift);
    assigned[bId] = assigned[bId].filter(s => s.id !== bShiftId).concat(check.aShift);
    return recalcTotals({ ...allocation, assigned });
  }

  // ---------------------------------------------------------------------------
  // Swap suggestions (local search)
  // Look at the highest and lowest earner and try every one-for-one trade
  // between them. Keep the ones that make the gap between those two smaller
  // without creating a clash. Top 3 by smallest resulting gap.
  // ---------------------------------------------------------------------------
  function suggestSwaps(allocation, limit = 3) {
    const ids = Object.keys(allocation.totals);
    if (ids.length < 2) return [];

    const byTotal = [...ids].sort((a, b) => allocation.totals[b] - allocation.totals[a]);
    const highId = byTotal[0];
    const lowId = byTotal[byTotal.length - 1];
    const gap = round2(allocation.totals[highId] - allocation.totals[lowId]);
    if (gap < 0.01) return [];

    const suggestions = [];
    for (const hShift of allocation.assigned[highId]) {
      for (const lShift of allocation.assigned[lowId]) {
        // only worth it if the high earner is giving away the bigger shift
        const hValue = shiftValue(hShift);
        const lValue = shiftValue(lShift);
        if (hValue <= lValue) continue;
        if (!checkSwap(allocation, highId, hShift.id, lowId, lShift.id).ok) continue;

        const newHigh = allocation.totals[highId] - hValue + lValue;
        const newLow = allocation.totals[lowId] - lValue + hValue;
        const newGap = round2(Math.abs(newHigh - newLow));
        if (newGap < gap) {
          suggestions.push({ highId, lowId, hShift, lShift, oldGap: gap, newGap });
        }
      }
    }

    return suggestions.sort((a, b) => a.newGap - b.newGap).slice(0, limit);
  }

  const api = {
    toInterval, shiftHours, shiftValue, overlaps, clashesWithAny, validateShift,
    solveSchedule, allocateFairly, spread, recalcTotals, findShift,
    checkSwap, applySwap, suggestSwaps
  };

  // works in the browser (window.Scheduling) and in Node (require)
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduling = api;
})(typeof window !== 'undefined' ? window : globalThis);
