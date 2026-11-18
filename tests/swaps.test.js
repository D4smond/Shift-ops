const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../js/swaps.js');

const NOW = 1_800_000_000_000;
const names = { a: 'Amara', b: 'Ben', lead: 'Coordinator' };
const label = s => s.job;
const amaraShift = { id: 's1', job: 'Events' };
const benShift = { id: 's2', job: 'Security' };

function newOffer(existing = []) {
  return W.offer({ id: 'r1', fromWorkerId: 'a', fromShift: amaraShift, toWorkerId: 'b', toShift: benShift }, existing, NOW, names, label);
}

test('an offer tells the colleague, not the coordinator', () => {
  const r = newOffer();
  assert.equal(r.request.status, 'offered');
  assert.deepEqual(r.notifications.map(n => n.to), ['b']);
});

test('the same offer cannot be sent twice while it is open', () => {
  const first = newOffer();
  assert.equal(newOffer([first.request]).ok, false);
});

test('only the colleague asked can answer', () => {
  const { request } = newOffer();
  assert.equal(W.respond(request, 'a', true, '', NOW, names, label, 'lead').ok, false);
});

test('accepting moves it to the coordinator and tells both', () => {
  const { request } = newOffer();
  const r = W.respond(request, 'b', true, '', NOW, names, label, 'lead');
  assert.equal(r.request.status, 'awaiting_coordinator');
  assert.deepEqual(r.notifications.map(n => n.to).sort(), ['a', 'lead']);
});

test('declining tells the requester, with the reason', () => {
  const { request } = newOffer();
  const r = W.respond(request, 'b', false, 'I need the hours', NOW, names, label, 'lead');
  assert.equal(r.request.status, 'declined');
  assert.match(r.notifications[0].text, /I need the hours/);
});

test('a rejection needs a reason and tells both workers', () => {
  const { request } = newOffer();
  const waiting = W.respond(request, 'b', true, '', NOW, names, label, 'lead').request;
  assert.equal(W.decide(waiting, false, '', NOW, names, label, 'lead').ok, false);
  const r = W.decide(waiting, false, 'Ben is not SIA licensed', NOW, names, label, 'lead');
  assert.equal(r.request.status, 'rejected');
  assert.deepEqual(r.notifications.map(n => n.to).sort(), ['a', 'b']);
  assert.match(r.notifications[0].text, /SIA licensed/);
});

test('the coordinator cannot approve before the colleague accepts', () => {
  const { request } = newOffer();
  assert.equal(W.decide(request, true, '', NOW, names, label, 'lead').ok, false);
});

test('approval tells both workers their new shift', () => {
  const waiting = W.respond(newOffer().request, 'b', true, '', NOW, names, label, 'lead').request;
  const r = W.decide(waiting, true, '', NOW, names, label, 'lead');
  assert.equal(r.request.status, 'approved');
  assert.equal(r.notifications.length, 2);
});

test('withdrawing closes it and tells the colleague', () => {
  const r = W.withdraw(newOffer().request, 'a', NOW, names, label);
  assert.equal(r.request.status, 'withdrawn');
  assert.equal(r.notifications[0].to, 'b');
});

test('open requests expire when their shifts move, closed ones are left alone', () => {
  const open = newOffer().request;
  const done = { ...open, id: 'r2', status: 'approved' };
  const r = W.expire([open, done], () => false, NOW, names, label);
  assert.equal(r.requests[0].status, 'expired');
  assert.equal(r.requests[1].status, 'approved');
  assert.equal(r.notifications.length, 1);
});

test('history records every step', () => {
  const waiting = W.respond(newOffer().request, 'b', true, '', NOW, names, label, 'lead').request;
  const done = W.decide(waiting, true, '', NOW, names, label, 'lead').request;
  assert.deepEqual(done.history.map(h => h.status), ['offered', 'awaiting_coordinator', 'approved']);
});
