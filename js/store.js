// store.js
// Everything Shift Ops remembers, kept in one localStorage entry.
// One object instead of a dozen keys means a save is all-or-nothing, and
// "clear all data" is a single line.

(function (root) {
  const KEY = 'shiftOps.v2';
  const COORDINATOR = 'lead'; // there's one coordinator in the demo

  function empty() {
    return {
      workers: [],        // { id, name }
      pool: [],           // open shifts the coordinator adds
      allocation: null,   // { assigned: {workerId: [shift]}, totals, unassigned, poolSignature }
      listings: [],       // { workerId, shiftId } shifts a worker has put up for swap
      requests: [],       // swap requests, see swaps.js
      notifications: [],  // { id, to, text, link, at, read }
      offers: {},         // workerId -> personal shift offers for the planner
      profiles: {}        // workerId -> { avatar, about }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
    } catch (err) {
      console.warn('Saved data could not be read, starting fresh', err);
      return empty();
    }
  }

  let data = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      // nearly always a full storage quota from profile photos
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const Store = {
    COORDINATOR,
    uid,
    get data() { return data; },

    // change something and save it in one go:  Store.update(d => { d.pool.push(x) })
    update(fn) {
      fn(data);
      return save();
    },

    notify(list) {
      if (!list || !list.length) return;
      data.notifications = [...list.map(n => ({ id: uid(), ...n })), ...data.notifications].slice(0, 200);
      save();
    },

    unreadFor(id) {
      return data.notifications.filter(n => n.to === id && !n.read).length;
    },

    // another browser tab saved something: pick it up
    reload() {
      data = load();
    },

    replaceAll(next) {
      data = { ...empty(), ...next };
      save();
    },

    clear() {
      data = empty();
      localStorage.removeItem(KEY);
    }
  };

  root.Store = Store;
})(window);
