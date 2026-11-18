// Run with:  node --test   (from the project folder)
// Uses Node's built-in test runner so there's nothing to install.

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scheduling.js');

// small helper so the tests read nicely
let next = 0;
const shift = (date, start, end, rate = 10, job = 'Test') =>
  ({ id: 's' + (next++), job, date, start, end, rate });

test('overnight shift clashes with an early shift the next morning', () => {
  const night = shift('2026-11-20', '22:00', '06:00');
  const early = shift('2026-11-21', '05:00', '09:00');
  assert.equal(S.overlaps(night, early), true);
});

test('back-to-back shifts do not count as a clash', () => {
  const a = shift('2026-11-20', '09:00', '13:00');
  const b = shift('2026-11-20', '13:00', '17:00');
  assert.equal(S.overlaps(a, b), false);
});

test('shift value handles overnight hours', () => {
  assert.equal(S.shiftHours(shift('2026-11-20', '22:00', '06:00')), 8);
  assert.equal(S.shiftValue(shift('2026-11-20', '22:00', '06:00', 12.5)), 100);
});

test('validation catches zero-length and silly shifts', () => {
  assert.ok(S.validateShift(shift('2026-11-20', '09:00', '09:00')));
  assert.ok(S.validateShift({ ...shift('2026-11-20', '09:00', '17:00'), job: '  ' }));
  assert.equal(S.validateShift(shift('2026-11-20', '09:00', '17:00')), null);
});

test('scheduler picks the higher paying shift when two overlap', () => {
  const low = shift('2026-11-20', '09:00', '17:00', 10);   // £80
  const high = shift('2026-11-20', '12:00', '20:00', 15);  // £120
  const { chosen, total } = S.solveSchedule([low, high]);
  assert.deepEqual(chosen.map(s => s.id), [high.id]);
  assert.equal(total, 120);
});

test('scheduler prefers two smaller shifts over one long one if they pay more', () => {
  const long = shift('2026-11-20', '08:00', '20:00', 10);    // £120
  const morning = shift('2026-11-20', '08:00', '13:00', 14); // £70
  const evening = shift('2026-11-20', '14:00', '20:00', 12); // £72
  const { chosen, total } = S.solveSchedule([long, morning, evening]);
  assert.equal(total, 142);
  assert.equal(chosen.length, 2);
});

test('scheduler matches brute force on random inputs', () => {
  // Try every subset for small random sets and make sure the DP always matches
  // the true best answer. Mixing in overnight shifts across two days is what
  // exposed the old version: it only compared shifts on the same date, so it
  // sometimes picked a night shift and an early shift that actually clashed.
  for (let round = 0; round < 200; round++) {
    const shifts = [];
    const count = 2 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i++) {
      const day = 20 + Math.floor(Math.random() * 2);
      const startH = Math.floor(Math.random() * 24);
      const len = 1 + Math.floor(Math.random() * 10);
      const endH = (startH + len) % 24;
      const pad = n => String(n).padStart(2, '0');
      shifts.push(shift(`2026-11-${day}`, `${pad(startH)}:00`, `${pad(endH)}:00`, 8 + Math.floor(Math.random() * 10)));
    }

    let bestBrute = 0;
    for (let mask = 0; mask < (1 << shifts.length); mask++) {
      const picked = shifts.filter((_, i) => mask & (1 << i));
      const ok = picked.every((a, i) => picked.every((b, j) => i === j || !S.overlaps(a, b)));
      if (ok) bestBrute = Math.max(bestBrute, picked.reduce((sum, s) => sum + S.shiftValue(s), 0));
    }

    const result = S.solveSchedule(shifts);
    assert.equal(result.total, Math.round(bestBrute * 100) / 100);
    // and the shifts it actually chose must not clash with each other
    for (const a of result.chosen) assert.equal(S.clashesWithAny(a, result.chosen), false);
  }
});

test('fair allocation never double-books anyone', () => {
  const workers = [{ id: 'a', name: 'Amy' }, { id: 'b', name: 'Ben' }];
  const pool = [
    shift('2026-11-20', '09:00', '17:00', 12),
    shift('2026-11-20', '10:00', '18:00', 12),
    shift('2026-11-20', '11:00', '19:00', 12) // three overlapping, only two people
  ];
  const result = S.allocateFairly(workers, pool);
  assert.equal(result.unassigned.length, 1);
  for (const id of ['a', 'b']) {
    for (const s of result.assigned[id]) assert.equal(S.clashesWithAny(s, result.assigned[id]), false);
  }
});

test('fair allocation spreads the money out', () => {
  const workers = [{ id: 'a', name: 'Amy' }, { id: 'b', name: 'Ben' }];
  const pool = [
    shift('2026-11-20', '09:00', '17:00', 12),
    shift('2026-11-21', '09:00', '17:00', 12),
    shift('2026-11-22', '09:00', '17:00', 12),
    shift('2026-11-23', '09:00', '17:00', 12)
  ];
  const result = S.allocateFairly(workers, pool);
  assert.equal(S.spread(result.totals), 0);
});

test('swap is refused if it would double-book someone', () => {
  const amyMorning = shift('2026-11-20', '09:00', '13:00');
  const amyEvening = shift('2026-11-20', '18:00', '22:00');
  const benLate = shift('2026-11-20', '12:00', '19:00');
  const allocation = S.recalcTotals({
    assigned: { a: [amyMorning, amyEvening], b: [benLate] },
    unassigned: []
  });
  // Amy giving her morning for Ben's 12-19 would clash with her 18:00 shift
  const check = S.checkSwap(allocation, 'a', amyMorning.id, 'b', benLate.id);
  assert.equal(check.ok, false);
});

test('applying a swap moves the shifts and recalculates totals', () => {
  const big = shift('2026-11-20', '09:00', '17:00', 15);   // £120
  const small = shift('2026-11-21', '09:00', '12:00', 10); // £30
  const allocation = S.recalcTotals({ assigned: { a: [big], b: [small] }, unassigned: [] });
  const after = S.applySwap(allocation, 'a', big.id, 'b', small.id);
  assert.equal(after.totals.a, 30);
  assert.equal(after.totals.b, 120);
  // original left alone
  assert.equal(allocation.totals.a, 120);
});

test('swap suggestions only ever narrow the gap', () => {
  const allocation = S.recalcTotals({
    assigned: {
      a: [shift('2026-11-20', '09:00', '17:00', 15), shift('2026-11-21', '09:00', '17:00', 15)],
      b: [shift('2026-11-22', '09:00', '11:00', 10), shift('2026-11-23', '09:00', '11:00', 10)]
    },
    unassigned: []
  });
  const suggestions = S.suggestSwaps(allocation);
  assert.ok(suggestions.length > 0);
  for (const s of suggestions) assert.ok(s.newGap < s.oldGap);
});
