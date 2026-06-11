/*
 * Headless playthrough of a dark terminal.
 *
 * Simulates a reasonably attentive player (about one action per second
 * per button, buys everything as soon as affordable) and asserts the
 * game can be completed in a sane amount of time with no broken math.
 *
 * Run with: node test/sim.js
 */
'use strict';

var E = require('../js/engine.js');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}

var s = E.createState();
var MAX_SECONDS = 4 * 3600;
var stageTimes = { 1: 0 };
var t = 0;

// Upgrade priority: cheap click/batch upgrades first, then revenue.
var buyOrder = [
  'mech_keyboard', 'git_aliases', 'tab_completion', 'ci_pipeline',
  'vim_bindings', 'monorepo', 'linter', 'release_train', 'freelance',
  'test_suite', 'enterprise', 'shared_context', 'prompt_library',
  'agentic_qa', 'pivot'
];

for (t = 0; t < MAX_SECONDS && !s.ended; t++) {
  E.tick(s, 1);

  // one round of clicking per simulated second
  E.actions.write(s);
  E.actions.review(s);
  E.actions.merge(s);
  if (s.stage < 5) E.actions.ship(s);
  if (s.bugs > 20) E.actions.fix(s);
  if (s.chaos > 30) E.actions.babysit(s);

  // spend money: stage first, then agents, then upgrades
  var before = s.stage;
  var r = E.actions.evolve(s);
  if (r.ok && s.stage !== before) stageTimes[s.stage] = t;
  if (r.ok && r.building) stageTimes['orch-start'] = t;
  while (E.actions.hire(s).ok) { /* hire as many as affordable */ }
  for (var i = 0; i < buyOrder.length; i++) E.actions.buyUpgrade(s, buyOrder[i]);

  // sanity every tick
  assert(isFinite(s.money) && s.money >= 0, 'money sane at t=' + t);
  assert(isFinite(s.loc) && s.loc >= 0, 'loc sane at t=' + t);
  assert(isFinite(s.commits) && s.commits >= 0, 'commits sane at t=' + t);
  assert(isFinite(s.bugs) && s.bugs >= 0, 'bugs sane at t=' + t);
  assert(E.focus(s) > 0, 'focus stays positive at t=' + t);
}

assert(s.orchBuilt, 'orchestrator built');
assert(s.stage === 8, 'reached stage 8');
assert(s.ended, 'reached the ending within ' + MAX_SECONDS + 's (took ' + t + 's)');
assert(s.agents > 5, 'hired a swarm (got ' + s.agents + ' agents)');
assert(Object.keys(s.upgrades).length === E.UPGRADES.length, 'bought every upgrade');

// the hydrate round-trip must preserve progress
var copy = E.hydrate(JSON.parse(JSON.stringify(s)));
assert(copy.stage === 8 && copy.ended && copy.orchBuilt, 'save/load round-trip');

// a fresh state must not generate anything on its own
var fresh = E.createState();
E.tick(fresh, 600);
assert(fresh.loc === 0 && fresh.money === 0, 'stage 1 has no passive income');

console.log('PASS: completed in ' + E.fmtTime(t) + ' (' + (t / 60).toFixed(1) + ' min)');
console.log('stage times (min): ' + Object.keys(stageTimes).map(function (k) {
  return k + '=' + (stageTimes[k] / 60).toFixed(1);
}).join('  '));
console.log('lifetime: ' + E.fmt(s.lifetime.loc) + ' loc, ' +
  E.fmt(s.lifetime.features) + ' features, $' + E.fmt(s.lifetime.money) +
  ', ' + E.fmt(s.lifetime.clicks) + ' clicks');
