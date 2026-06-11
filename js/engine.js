/*
 * a dark terminal — core game engine.
 *
 * Pure game state + rules, no DOM. Loaded in the browser as `Engine`
 * and in Node (for the simulation test) via module.exports.
 *
 * The progression follows Steve Yegge's 8 stages of AI-assisted
 * development: manual coding, an agent in the IDE with permissions on,
 * YOLO mode, the wide agent, the CLI, parallel instances, the
 * hand-managed swarm, and finally building your own orchestrator.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Engine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = {
    LOC_PER_COMMIT: 10,
    PENDING_CAP: 600,       // stage 2 agent stalls until you click "allow"
    AGENT_BASE_LOC: 2,      // code/sec per agent before multipliers
    BASE_REVENUE: 15,       // $ per commit shipped
    BASE_BUG_RATE: 0.08,    // bugs per agent-written commit (YOLO and up)
    ORCH_BUILD_TIME: 30,    // seconds to build the orchestrator
    ENDING_SHIPPED: 60000,  // features shipped under the orchestrator
    AGENT_HIRE_BASE: 10000,
    AGENT_HIRE_GROWTH: 1.3,
    OFFLINE_CAP: 3600       // max seconds of offline progress
  };

  var STAGES = {
    1: {
      name: 'the dark terminal', cost: 0, quote: '',
      enter: ['the terminal is dark.', 'a cursor blinks.', 'you begin to type.']
    },
    2: {
      name: 'an agent in the ide', cost: 150,
      quote: 'permissions on. it asks before every change.',
      enter: ['something wakes inside the ide.',
        'it asks permission for everything. allow. allow. allow.']
    },
    3: {
      name: 'yolo mode', cost: 600,
      quote: 'you turn the permissions off.',
      enter: ['you turn off the guardrails.', 'the agent stops asking.',
        'you mostly stop reading.']
    },
    4: {
      name: 'the wide agent', cost: 2500,
      quote: 'one agent, the whole codebase at once.',
      enter: ['the agent grows wide.', 'it touches every file at once.',
        'merges happen on their own now.']
    },
    5: {
      name: 'the cli', cost: 12000,
      quote: 'no more ide. diffs scroll by. you may or may not look at them.',
      enter: ['you close the ide. you do not miss it.',
        'diffs scroll by in the dark.', 'shipping happens on its own now.']
    },
    6: {
      name: 'parallel instances', cost: 50000,
      quote: 'three to five agents at once. you are very fast.',
      enter: ['a second terminal. a third.', 'you are very fast now.']
    },
    7: {
      name: 'the swarm', cost: 250000,
      quote: 'ten or more agents, hand-managed. the limits approach.',
      enter: ['ten agents. twelve. twenty.',
        'tabs everywhere. you spend more time herding than building.']
    },
    8: {
      name: 'the orchestrator', cost: 2000000,
      quote: 'you stop wrangling agents and build the thing that wrangles them.',
      enter: ['the orchestrator hums.', 'the swarm falls into formation.',
        'no one asks permission. nothing is forgotten.']
    }
  };

  var UPGRADES = [
    { id: 'mech_keyboard', stage: 1, cost: 15, name: 'mechanical keyboard',
      desc: '+2 code per keystroke', msg: 'clack. clack. clack.' },
    { id: 'git_aliases', stage: 1, cost: 25, name: 'git aliases',
      desc: 'merge up to 30 commits at a time',
      msg: 'gco. gcp. gpf. you know what they mean.' },
    { id: 'tab_completion', stage: 1, cost: 40, name: 'tab completion',
      desc: 'keystrokes write twice the code',
      msg: 'the editor finishes your thoughts. it feels like cheating.' },
    { id: 'ci_pipeline', stage: 1, cost: 60, name: 'ci pipeline',
      desc: 'ship up to 15 commits at a time',
      msg: 'green checks all the way down.' },
    { id: 'vim_bindings', stage: 1, cost: 90, name: 'vim bindings',
      desc: 'keystrokes write twice the code',
      msg: 'you stop reaching for the mouse.' },
    { id: 'monorepo', stage: 2, cost: 200, name: 'monorepo tooling',
      desc: 'merge up to 100 commits at a time', msg: 'one repo. all of it.' },
    { id: 'linter', stage: 3, cost: 400, name: 'linter',
      desc: 'agents write half as many bugs',
      msg: 'a thousand small arguments, settled.' },
    { id: 'release_train', stage: 3, cost: 500, name: 'release train',
      desc: 'ship up to 50 commits at a time',
      msg: 'it leaves on time, with or without you.' },
    { id: 'freelance', stage: 3, cost: 800, name: 'freelance contracts',
      desc: '2x revenue per commit',
      msg: 'strangers pay for your features now.' },
    { id: 'test_suite', stage: 4, cost: 1500, name: 'test suite',
      desc: 'agents write half as many bugs',
      msg: "the tests fail so you don't have to." },
    { id: 'enterprise', stage: 5, cost: 8000, name: 'enterprise customers',
      desc: '2.5x revenue per commit',
      msg: 'a procurement department learns your name.' },
    { id: 'shared_context', stage: 6, cost: 30000, name: 'shared context',
      desc: 'agents produce 50% more',
      msg: "the agents stop repeating each other's mistakes." },
    { id: 'prompt_library', stage: 6, cost: 80000, name: 'prompt library',
      desc: 'agents produce 50% more', msg: 'the good words, written down.' },
    { id: 'agentic_qa', stage: 7, cost: 50000, name: 'agentic qa',
      desc: 'fix 100 bugs at a time',
      msg: 'you hire a chimp to watch the chimps.' },
    { id: 'pivot', stage: 7, cost: 100000, name: 'the pivot',
      desc: '3x revenue per commit',
      msg: 'you add the word "agentic" to the landing page. revenue triples.' }
  ];

  function createState() {
    return {
      v: 1,
      stage: 1,
      loc: 0, commits: 0, features: 0, money: 0, bugs: 0, pending: 0,
      agents: 0, chaos: 0,
      upgrades: {},
      seen: {},
      orchBuilding: false, orchProgress: 0, orchBuilt: false,
      shippedSinceOrch: 0,
      ended: false,
      playtime: 0,
      lifetime: { loc: 0, commits: 0, features: 0, money: 0, clicks: 0 },
      lastSeen: 0
    };
  }

  /* ----- derived values ----- */

  function clickPower(s) {
    var p = 1;
    if (s.upgrades.mech_keyboard) p += 2;
    if (s.upgrades.tab_completion) p *= 2;
    if (s.upgrades.vim_bindings) p *= 2;
    return p;
  }
  function mergeBatch(s) {
    return s.upgrades.monorepo ? 100 : s.upgrades.git_aliases ? 30 : 10;
  }
  function shipBatch(s) {
    return s.upgrades.release_train ? 50 : s.upgrades.ci_pipeline ? 15 : 5;
  }
  function revenuePerCommit(s) {
    var r = C.BASE_REVENUE;
    if (s.upgrades.freelance) r *= 2;
    if (s.upgrades.enterprise) r *= 2.5;
    if (s.upgrades.pivot) r *= 3;
    return r;
  }
  function bugRate(s) {
    if (s.orchBuilt) return 0; // the witness reviews everything
    var b = C.BASE_BUG_RATE;
    if (s.upgrades.linter) b *= 0.5;
    if (s.upgrades.test_suite) b *= 0.5;
    return b;
  }
  function fixBatch(s) { return s.upgrades.agentic_qa ? 100 : 10; }
  function quality(s) { return Math.max(0.4, 1 - s.bugs * 0.005); }
  function focus(s) {
    if (s.stage < 7 || s.orchBuilt) return 1;
    return 1 - s.chaos / 150;
  }
  function agentMult(s) {
    var m = 1;
    if (s.stage >= 3) m *= 1.5;
    if (s.stage >= 4) m *= 3;
    if (s.stage >= 5) m *= 3;
    if (s.upgrades.shared_context) m *= 1.5;
    if (s.upgrades.prompt_library) m *= 1.5;
    if (s.orchBuilt) m *= 5;
    return m;
  }
  function agentLocPerSec(s) {
    return s.agents * C.AGENT_BASE_LOC * agentMult(s) * focus(s);
  }
  function autoShipRate(s) {
    if (s.stage < 5) return 0;
    if (s.orchBuilt) return 1e9;
    return s.stage === 5 ? 3 : s.stage === 6 ? 15 : 60;
  }
  function agentCap(s) {
    return s.stage >= 7 ? 20 : s.stage >= 6 ? 5 : s.stage >= 2 ? 1 : 0;
  }
  function hireCost(s) {
    return Math.round(
      C.AGENT_HIRE_BASE * Math.pow(C.AGENT_HIRE_GROWTH, Math.max(0, s.agents - 1)));
  }
  function moneyPerSec(s) {
    if (s.stage < 5) return 0;
    var commitsPerSec = agentLocPerSec(s) / C.LOC_PER_COMMIT;
    return Math.min(autoShipRate(s), commitsPerSec) * revenuePerCommit(s) * quality(s);
  }

  /* ----- simulation ----- */

  // Advances the world by dt seconds. Returns event strings for the UI
  // ('stage:8' when the orchestrator finishes, 'ending' at the finale).
  function tick(s, dt) {
    var ev = [];

    if (s.orchBuilding) {
      s.orchProgress += dt;
      if (s.orchProgress >= C.ORCH_BUILD_TIME) {
        s.orchBuilding = false;
        s.orchBuilt = true;
        s.stage = 8;
        s.chaos = 0;
        s.bugs = 0;
        ev.push('stage:8');
      }
    }

    var gen = agentLocPerSec(s) * dt;
    if (gen > 0) {
      if (s.stage === 2) {
        s.pending = Math.min(C.PENDING_CAP, s.pending + gen);
      } else {
        s.loc += gen;
        s.lifetime.loc += gen;
        // unreviewed agent code carries bugs; hand-written code does not
        s.bugs += (gen / C.LOC_PER_COMMIT) * bugRate(s);
      }
    }

    if (s.stage >= 4 && s.loc > 0) {
      var merged = s.loc / C.LOC_PER_COMMIT;
      s.commits += merged;
      s.lifetime.commits += merged;
      s.loc = 0;
    }

    var rate = autoShipRate(s);
    if (rate > 0 && s.commits > 0) {
      var n = Math.min(s.commits, rate * dt);
      s.commits -= n;
      s.features += n;
      s.lifetime.features += n;
      var gain = n * revenuePerCommit(s) * quality(s);
      s.money += gain;
      s.lifetime.money += gain;
      if (s.orchBuilt) {
        s.shippedSinceOrch += n;
        if (!s.ended && s.shippedSinceOrch >= C.ENDING_SHIPPED) {
          s.ended = true;
          ev.push('ending');
        }
      }
    }

    if (s.stage >= 7 && !s.orchBuilt) {
      if (s.agents > 5) {
        s.chaos = Math.min(100, s.chaos + (s.agents - 5) * 0.4 * dt);
      } else {
        s.chaos = Math.max(0, s.chaos - 2 * dt);
      }
    }

    s.playtime += dt;
    return ev;
  }

  /* ----- player actions ----- */

  var actions = {
    write: function (s) {
      var p = clickPower(s);
      s.loc += p;
      s.lifetime.loc += p;
      s.lifetime.clicks++;
      return { ok: true, n: p };
    },
    review: function (s) {
      if (s.stage !== 2 || s.pending < 1) return { ok: false };
      var n = Math.floor(s.pending);
      s.pending -= n;
      s.loc += n;
      s.lifetime.loc += n;
      s.lifetime.clicks++;
      return { ok: true, n: n };
    },
    merge: function (s) {
      if (s.loc < C.LOC_PER_COMMIT) return { ok: false };
      var n = Math.min(Math.floor(s.loc / C.LOC_PER_COMMIT), mergeBatch(s));
      s.loc -= n * C.LOC_PER_COMMIT;
      s.commits += n;
      s.lifetime.commits += n;
      s.lifetime.clicks++;
      return { ok: true, n: n };
    },
    ship: function (s) {
      if (s.commits < 1) return { ok: false };
      var n = Math.min(Math.floor(s.commits), shipBatch(s));
      var gain = n * revenuePerCommit(s) * quality(s);
      s.commits -= n;
      s.features += n;
      s.money += gain;
      s.lifetime.features += n;
      s.lifetime.money += gain;
      s.lifetime.clicks++;
      return { ok: true, n: n, gain: gain };
    },
    fix: function (s) {
      if (s.bugs < 1) return { ok: false };
      var n = Math.min(s.bugs, fixBatch(s));
      s.bugs -= n;
      s.lifetime.clicks++;
      return { ok: true, n: Math.max(1, Math.floor(n)) };
    },
    babysit: function (s) {
      if (s.stage < 7 || s.orchBuilt || s.chaos <= 0) return { ok: false };
      s.chaos = Math.max(0, s.chaos - 25);
      s.lifetime.clicks++;
      return { ok: true };
    },
    hire: function (s) {
      var cost = hireCost(s);
      if (s.stage < 6 || s.agents >= agentCap(s) || s.money < cost) {
        return { ok: false };
      }
      s.money -= cost;
      s.agents++;
      return { ok: true, cost: cost };
    },
    evolve: function (s) {
      var next = s.stage + 1;
      if (next > 8 || s.orchBuilding || s.orchBuilt) return { ok: false };
      var st = STAGES[next];
      if (s.money < st.cost) return { ok: false };
      s.money -= st.cost;
      if (next === 8) {
        // the orchestrator is a project, not a purchase: it takes time
        s.orchBuilding = true;
        s.orchProgress = 0;
        return { ok: true, building: true };
      }
      s.stage = next;
      if (next === 2) s.agents = 1;
      return { ok: true, next: next };
    },
    buyUpgrade: function (s, id) {
      var u = null;
      for (var i = 0; i < UPGRADES.length; i++) {
        if (UPGRADES[i].id === id) { u = UPGRADES[i]; break; }
      }
      if (!u || s.upgrades[id] || s.stage < u.stage || s.money < u.cost) {
        return { ok: false };
      }
      s.money -= u.cost;
      s.upgrades[id] = true;
      return { ok: true, upgrade: u };
    }
  };

  /* ----- helpers ----- */

  function fmt(n) {
    if (!isFinite(n) || n < 0) n = 0;
    if (n < 1000) return String(Math.floor(n));
    var units = ['k', 'M', 'B', 'T'];
    var i = -1;
    var x = n;
    while (x >= 1000 && i < units.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? String(Math.floor(x)) : x.toFixed(1)) + units[i];
  }

  function fmtTime(sec) {
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s2 = sec % 60;
    return (h > 0 ? h + 'h ' : '') + m + 'm ' + s2 + 's';
  }

  // Restores a save on top of fresh defaults so new fields get sane values.
  function hydrate(raw) {
    var s = createState();
    if (!raw || typeof raw !== 'object') return s;
    for (var k in s) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
      if (k === 'lifetime' || k === 'upgrades' || k === 'seen') {
        for (var k2 in raw[k]) s[k][k2] = raw[k][k2];
      } else {
        s[k] = raw[k];
      }
    }
    return s;
  }

  return {
    C: C,
    STAGES: STAGES,
    UPGRADES: UPGRADES,
    createState: createState,
    hydrate: hydrate,
    tick: tick,
    actions: actions,
    fmt: fmt,
    fmtTime: fmtTime,
    clickPower: clickPower,
    mergeBatch: mergeBatch,
    shipBatch: shipBatch,
    revenuePerCommit: revenuePerCommit,
    bugRate: bugRate,
    fixBatch: fixBatch,
    quality: quality,
    focus: focus,
    agentMult: agentMult,
    agentLocPerSec: agentLocPerSec,
    autoShipRate: autoShipRate,
    agentCap: agentCap,
    hireCost: hireCost,
    moneyPerSec: moneyPerSec
  };
});
