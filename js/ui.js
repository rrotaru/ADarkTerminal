/*
 * a dark terminal — DOM layer.
 *
 * Renders the engine state, drives the main loop, handles clicks,
 * cooldowns, the event log, ambient flavor, saving, and the ending.
 */
(function () {
  'use strict';

  var E = window.Engine;
  var SAVE_KEY = 'adarkterminal.save.v1';

  var S; // game state
  var resetting = false;

  /* ---------- log ---------- */

  var logEl = document.getElementById('log');

  function log(text, cls) {
    var d = document.createElement('div');
    d.className = 'msg' + (cls ? ' ' + cls : '');
    d.textContent = text;
    logEl.insertBefore(d, logEl.firstChild);
    while (logEl.children.length > 80) logEl.removeChild(logEl.lastChild);
  }

  function logSeq(lines, cls) {
    lines.forEach(function (m, i) {
      setTimeout(function () { log(m, cls || 'story'); }, i * 900);
    });
  }

  /* ---------- flavor ---------- */

  var AMBIENT = [
    { min: 1, t: 'the fan spins up. the room is warm.' },
    { min: 1, t: 'the coffee is cold. you drink it anyway.' },
    { min: 1, t: 'a stranger stars your repo.' },
    { min: 1, t: 'beyond the terminal, a dark forest.' },
    { min: 3, t: 'an agent apologizes for a bug it has not written yet.' },
    { min: 3, t: 'the agent refactors something you were fond of. it is better now.' },
    { min: 5, t: 'a diff scrolls past. it is elegant. you did not write it.' },
    { min: 6, t: 'two agents argue in a log file. one of them wins.' },
    { min: 7, t: 'you find an agent building something you never asked for. it is good.' },
    { min: 7, t: 'you dream in terminal tabs.' }
  ];

  var DIFF_FILES = [
    'src/agent.ts', 'core/loop.rs', 'pkg/orchestrator.go', 'lib/prompts.md',
    'ci/deploy.yml', 'src/swarm/manager.ts', 'internal/beads.go',
    'app/billing.py', 'src/context/window.ts', 'cmd/wrangler/main.go'
  ];

  var BUILD_MILESTONES = [
    { at: 0.15, t: 'you sketch the roles: a mayor. a crew. witnesses. dogs.' },
    { at: 0.5, t: 'work queues. leases. nothing will be forgotten.' },
    { at: 0.85, t: 'you give it a name.' }
  ];

  var FINALE = [
    'the queue is empty.',
    'the agents idle, waiting for intent.',
    'you realize you have not typed in a long time.',
    'you wrote the thing that writes the thing.',
    'the terminal is bright.'
  ];

  /* ---------- action buttons ---------- */

  var actionsEl = document.getElementById('actions');

  var BUTTONS = [
    {
      id: 'write', cd: 700, label: 'write code',
      sub: function () { return '+' + E.fmt(E.clickPower(S)) + ' code'; },
      visible: function () { return true; },
      enabled: function () { return true; },
      click: function () { return E.actions.write(S); }
    },
    {
      id: 'review', cd: 1200, label: 'review diffs',
      sub: function () { return 'allow ' + E.fmt(S.pending) + ' lines'; },
      visible: function () { return S.stage === 2; },
      enabled: function () { return S.pending >= 1; },
      click: function () {
        var r = E.actions.review(S);
        if (r.ok) log('you read ' + r.n + ' lines. allow. allow. allow.', 'dim');
        return r;
      }
    },
    {
      id: 'merge', cd: 1500, label: 'merge',
      sub: function () { return 'up to ' + E.mergeBatch(S) + ' commits'; },
      visible: function () { return S.stage < 4; },
      enabled: function () { return S.loc >= E.C.LOC_PER_COMMIT; },
      click: function () {
        var r = E.actions.merge(S);
        if (r.ok && !S.seen.firstMerge) {
          S.seen.firstMerge = true;
          log('two branches become one.', 'story');
        }
        return r;
      }
    },
    {
      id: 'ship', cd: 2500, label: 'ship',
      sub: function () {
        return '$' + E.fmt(E.revenuePerCommit(S) * E.quality(S)) + ' per commit';
      },
      visible: function () { return S.stage < 5; },
      enabled: function () { return S.commits >= 1; },
      click: function () {
        var r = E.actions.ship(S);
        if (r.ok && !S.seen.firstShip) {
          S.seen.firstShip = true;
          log('something leaves the terminal. money comes back.', 'story');
        }
        return r;
      }
    },
    {
      id: 'fix', cd: 2000, label: 'fix bugs',
      sub: function () { return 'squash up to ' + E.fixBatch(S); },
      visible: function () { return S.stage >= 3 && S.bugs >= 1 && !S.orchBuilt; },
      enabled: function () { return S.bugs >= 1; },
      click: function () { return E.actions.fix(S); }
    },
    {
      id: 'babysit', cd: 900, label: 'babysit agents',
      sub: function () { return 'chaos ' + Math.floor(S.chaos) + '%'; },
      visible: function () {
        return S.stage >= 7 && !S.orchBuilt && S.agents > 5;
      },
      enabled: function () { return S.chaos > 0; },
      click: function () { return E.actions.babysit(S); }
    },
    {
      id: 'hire', cd: 400, label: 'open another terminal',
      sub: function () { return 'hire agent — $' + E.fmt(E.hireCost(S)); },
      visible: function () {
        return S.stage >= 6 && S.agents < E.agentCap(S) && !S.orchBuilding;
      },
      enabled: function () { return S.money >= E.hireCost(S); },
      click: function () {
        var r = E.actions.hire(S);
        if (r.ok) log('another terminal opens. another agent gets to work.', 'dim');
        return r;
      }
    }
  ];

  var buttonEls = {};

  function makeButton(def) {
    var el = document.createElement('button');
    el.className = 'action';
    el.innerHTML = '<span class="cool"></span>' +
      '<span class="label"></span><span class="sub"></span>';
    el.addEventListener('click', function () {
      if (el.disabled) return;
      var r = def.click();
      if (r && r.ok) startCooldown(def, el);
      update();
    });
    actionsEl.appendChild(el);
    buttonEls[def.id] = { def: def, el: el, coolUntil: 0 };
  }

  function startCooldown(def, el) {
    buttonEls[def.id].coolUntil = Date.now() + def.cd;
    var cool = el.querySelector('.cool');
    cool.style.transition = 'none';
    cool.style.width = '100%';
    // force reflow so the shrink animation restarts
    void cool.offsetWidth;
    cool.style.transition = 'width ' + def.cd + 'ms linear';
    cool.style.width = '0%';
  }

  BUTTONS.forEach(makeButton);

  /* ---------- evolve card ---------- */

  var evolveEl = document.getElementById('evolve');
  var evolveBtn = null;

  function renderEvolve() {
    if (S.orchBuilding) {
      var pct = Math.min(100, Math.floor(S.orchProgress / E.C.ORCH_BUILD_TIME * 100));
      evolveEl.innerHTML =
        '<div class="evolve-title">building the orchestrator</div>' +
        '<div class="buildbar"><div class="buildfill" style="width:' + pct + '%"></div></div>' +
        '<div class="evolve-quote">' + pct + '%</div>';
      evolveBtn = null;
      return;
    }
    if (S.orchBuilt || S.stage >= 8) {
      evolveEl.innerHTML = '';
      evolveBtn = null;
      return;
    }
    var next = S.stage + 1;
    var st = E.STAGES[next];
    var seenKey = 'stage' + next;
    if (!S.seen[seenKey] && S.money < st.cost * 0.3) {
      evolveEl.innerHTML = '';
      evolveBtn = null;
      return;
    }
    S.seen[seenKey] = true;
    if (!evolveBtn || evolveBtn.dataset.next !== String(next)) {
      evolveEl.innerHTML =
        '<div class="evolve-title">stage ' + next + ' · ' + st.name + '</div>' +
        '<div class="evolve-quote">' + st.quote + '</div>';
      evolveBtn = document.createElement('button');
      evolveBtn.className = 'action evolve-btn';
      evolveBtn.dataset.next = String(next);
      evolveBtn.innerHTML = '<span class="label">evolve — $' + E.fmt(st.cost) + '</span>';
      evolveBtn.addEventListener('click', function () {
        var r = E.actions.evolve(S);
        if (!r.ok) return;
        if (r.building) {
          logSeq(['you stop wrangling.', 'you begin to build.'], 'story');
        } else {
          logSeq(E.STAGES[S.stage].enter, 'story');
        }
        update();
      });
      evolveEl.appendChild(evolveBtn);
    }
    evolveBtn.disabled = S.money < st.cost;
  }

  /* ---------- upgrades ---------- */

  var upgradesEl = document.getElementById('upgrades');
  var upgradeEls = {};

  function renderUpgrades() {
    E.UPGRADES.forEach(function (u) {
      var owned = !!S.upgrades[u.id];
      var existing = upgradeEls[u.id];
      if (owned) {
        if (existing) { existing.remove(); delete upgradeEls[u.id]; }
        return;
      }
      if (S.stage < u.stage) return;
      if (!S.seen[u.id] && S.money < u.cost * 0.6) return;
      S.seen[u.id] = true;
      if (!existing) {
        var el = document.createElement('button');
        el.className = 'upgrade';
        el.innerHTML = '<span class="label">' + u.name + ' — $' + E.fmt(u.cost) +
          '</span><span class="sub">' + u.desc + '</span>';
        el.addEventListener('click', function () {
          var r = E.actions.buyUpgrade(S, u.id);
          if (r.ok) log(u.msg, 'story');
          update();
        });
        upgradesEl.appendChild(el);
        upgradeEls[u.id] = el;
      }
      upgradeEls[u.id].disabled = S.money < u.cost;
    });
    document.getElementById('upgradesHead').style.display =
      upgradesEl.children.length ? '' : 'none';
  }

  /* ---------- resources panel ---------- */

  var resourcesEl = document.getElementById('resources');

  function row(name, value, cls) {
    return '<div class="row' + (cls ? ' ' + cls : '') + '"><span>' + name +
      '</span><span>' + value + '</span></div>';
  }

  function renderResources() {
    var h = '';
    h += row('code', E.fmt(S.loc));
    if (S.stage === 2) {
      h += row('pending diffs', E.fmt(S.pending) +
        (S.pending >= E.C.PENDING_CAP ? ' (waiting)' : ''), 'dim');
    }
    h += row('commits', E.fmt(S.commits));
    h += row('features', E.fmt(S.features));
    h += row('money', '$' + E.fmt(S.money), 'money');
    if (S.stage >= 3 && !S.orchBuilt) {
      h += row('bugs', E.fmt(S.bugs), S.bugs >= 1 ? 'bad' : '');
      h += row('code quality', Math.round(E.quality(S) * 100) + '%',
        E.quality(S) < 0.8 ? 'bad' : '');
    }
    if (S.stage >= 2) {
      h += row('agents', S.agents + (S.stage >= 6 ? ' / ' + E.agentCap(S) : ''));
    }
    if (S.stage >= 7 && !S.orchBuilt) {
      h += row('focus', Math.round(E.focus(S) * 100) + '%',
        E.focus(S) < 0.8 ? 'bad' : '');
    }
    var rate = E.agentLocPerSec(S);
    if (rate > 0) {
      h += row(S.stage === 2 ? 'agent writes' : 'agents write',
        '+' + E.fmt(rate) + ' code/s', 'dim');
    }
    var mps = E.moneyPerSec(S);
    if (mps > 0) h += row('revenue', '~$' + E.fmt(mps) + '/s', 'dim');
    resourcesEl.innerHTML = h;
  }

  /* ---------- stage banner ---------- */

  var bannerEl = document.getElementById('stageBanner');

  function renderBanner() {
    if (S.orchBuilding) {
      bannerEl.textContent = 'stage 7 → 8 · building the orchestrator';
    } else {
      bannerEl.textContent = 'stage ' + S.stage + ' · ' + E.STAGES[S.stage].name;
    }
  }

  /* ---------- ending ---------- */

  var endingEl = document.getElementById('ending');

  function showEnding() {
    S.seen.endingShown = true;
    document.getElementById('endStats').innerHTML =
      row('time in the terminal', E.fmtTime(S.playtime)) +
      row('keystrokes & clicks', E.fmt(S.lifetime.clicks)) +
      row('lines of code', E.fmt(S.lifetime.loc)) +
      row('features shipped', E.fmt(S.lifetime.features)) +
      row('lifetime revenue', '$' + E.fmt(S.lifetime.money), 'money');
    endingEl.classList.remove('hidden');
  }

  document.getElementById('btnKeepWatching').addEventListener('click', function () {
    endingEl.classList.add('hidden');
    log('the orchestrator does not notice you watching.', 'dim');
  });

  document.getElementById('btnBeginAgain').addEventListener('click', function () {
    if (!window.confirm('wipe the terminal and begin again?')) return;
    resetting = true;
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  });

  /* ---------- save / load ---------- */

  function save(silent) {
    S.lastSeen = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(S));
      if (!silent) log('progress saved.', 'dim');
    } catch (e) { /* private mode etc. — play on */ }
  }

  function load() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { }
    S = E.hydrate(raw);
    if (!raw) {
      logSeq(E.STAGES[1].enter, 'story');
      return;
    }
    log('the terminal flickers back to life.', 'story');
    // offline progress, in 1s steps so caps and chaos behave
    var away = Math.min(E.C.OFFLINE_CAP, (Date.now() - (S.lastSeen || Date.now())) / 1000);
    if (away > 10 && S.agents > 0 && !S.ended) {
      var moneyBefore = S.money;
      var pendingEvents = [];
      for (var i = 0; i < Math.floor(away); i++) {
        pendingEvents = pendingEvents.concat(E.tick(S, 1));
      }
      var gained = S.money - moneyBefore;
      if (gained >= 1) {
        log('while you were away: +$' + E.fmt(gained) + '.', 'dim');
      } else if (S.pending >= E.C.PENDING_CAP) {
        log('the agent has been waiting for permission.', 'dim');
      }
      pendingEvents.forEach(handleEvent);
    }
  }

  document.getElementById('btnSave').addEventListener('click', function (e) {
    e.preventDefault();
    save(false);
  });

  document.getElementById('btnReset').addEventListener('click', function (e) {
    e.preventDefault();
    if (!window.confirm('wipe the terminal and begin again?')) return;
    resetting = true;
    localStorage.removeItem(SAVE_KEY);
    window.location.reload();
  });

  /* ---------- main loop ---------- */

  var endingQueued = false;

  function handleEvent(ev) {
    if (ev === 'stage:8') {
      logSeq(E.STAGES[8].enter, 'story');
    } else if (ev === 'ending') {
      endingQueued = true;
      logSeq(FINALE, 'story');
      setTimeout(showEnding, FINALE.length * 900 + 1500);
    }
  }

  function update() {
    Object.keys(buttonEls).forEach(function (id) {
      var b = buttonEls[id];
      var vis = b.def.visible();
      b.el.style.display = vis ? '' : 'none';
      if (!vis) return;
      b.el.disabled = Date.now() < b.coolUntil || !b.def.enabled();
      b.el.querySelector('.label').textContent = b.def.label;
      b.el.querySelector('.sub').textContent = b.def.sub ? b.def.sub() : '';
    });
    renderEvolve();
    renderUpgrades();
    renderResources();
    renderBanner();
  }

  var lastTick = Date.now();
  var nextAmbient = Date.now() + 60000;
  var nextDiff = 0;
  var lastMilestone = -1;
  var lastAutosave = Date.now();

  function loop() {
    var now = Date.now();
    var dt = Math.min(5, (now - lastTick) / 1000);
    lastTick = now;

    var wasBuilding = S.orchBuilding;
    E.tick(S, dt).forEach(handleEvent);

    if (wasBuilding) {
      var frac = S.orchProgress / E.C.ORCH_BUILD_TIME;
      for (var i = 0; i < BUILD_MILESTONES.length; i++) {
        if (frac >= BUILD_MILESTONES[i].at && lastMilestone < i) {
          lastMilestone = i;
          log(BUILD_MILESTONES[i].t, 'story');
        }
      }
    }

    if (now >= nextAmbient) {
      nextAmbient = now + 45000 + Math.random() * 60000;
      var pool = AMBIENT.filter(function (a) { return S.stage >= a.min; });
      log(pool[Math.floor(Math.random() * pool.length)].t, 'dim');
    }

    if (S.stage >= 5 && now >= nextDiff) {
      nextDiff = now + 2500 + Math.random() * 5000;
      var f = DIFF_FILES[Math.floor(Math.random() * DIFF_FILES.length)];
      log('+' + (1 + Math.floor(Math.random() * 120)) + ' −' +
        Math.floor(Math.random() * 40) + '  ' + f, 'diff');
    }

    if (now - lastAutosave > 15000) {
      lastAutosave = now;
      save(true);
    }

    update();
  }

  /* ---------- boot ---------- */

  load();
  // fallback for saves that ended before this boot; if the ending just
  // fired during offline catch-up, the finale sequence is already queued
  if (S.ended && !S.seen.endingShown && !endingQueued) showEnding();
  update();
  setInterval(loop, 200);
  window.addEventListener('beforeunload', function () { if (!resetting) save(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && !resetting) save(true);
  });
})();
