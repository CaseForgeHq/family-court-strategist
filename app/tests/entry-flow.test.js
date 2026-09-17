import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const script = readFileSync(new URL('../../desktop/entry-flow.js', import.meta.url), 'utf8');
const stages = ['configure', 'preferences', 'ready'];
const html = `<!doctype html><body><nav class="setup-progress" aria-label="Setup progress"><ol>
  ${stages.map((name, index) => `<li data-step="${name}"><span class="progress-number">0${index + 1}</span>${name}</li>`).join('')}
  </ol><div id="setup-progress-fill"></div></nav><main>
  ${stages.map(name => `<section id="${name}-stage"><h2 id="${name}-title">${name}</h2><button>${name} action</button>${name === 'ready' ? '<svg class="ready-mark"><path></path></svg>' : ''}</section>`).join('')}
  </main></body>`;

function fixture(t, { reduced = false, animationSupport = true } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, { document } = window;
  const animations = [], motionChanges = new Set(), focusCalls = [], stageEvents = [], timers = [];
  const media = {
    matches: reduced,
    addEventListener(type, callback) { assert.equal(type, 'change'); motionChanges.add(callback); },
  };
  window.matchMedia = (query) => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; };
  window.setTimeout = (...args) => { timers.push({ kind: 'timeout', args }); return timers.length; };
  window.setInterval = (...args) => { timers.push({ kind: 'interval', args }); return timers.length; };
  const focus = window.HTMLElement.prototype.focus;
  window.HTMLElement.prototype.focus = function (options) {
    focusCalls.push({ target: this, preventScroll: options?.preventScroll });
    focus.call(this, options);
  };
  if (animationSupport) window.Element.prototype.animate = function (frames, options) {
    let resolve, reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const animation = {
      target: this, frames, options, cancellations: 0, finished,
      panelsAtStart: stages.map(name => ({ name, hidden: document.getElementById(name + '-stage').hidden, inert: document.getElementById(name + '-stage').inert })),
      cancel() { this.cancellations++; reject(new Error('Animation cancelled')); },
      finish() { resolve(); },
    };
    animations.push(animation); return animation;
  };
  window.addEventListener('caseforge:stage', event => stageEvents.push(event.detail.stage));
  window.eval(script);
  const pagehide = () => window.dispatchEvent(new window.Event('pagehide'));
  t.after(() => { pagehide(); window.close(); });
  return { window, document, animations, focusCalls, stageEvents, timers, flow: window.CaseForgeEntry, pagehide,
    setReduced(value) { media.matches = value; for (const callback of motionChanges) callback({ matches: value }); },
  };
}

function assertStage(ui, current) {
  assert.equal(ui.flow.getStage(), current);
  assert.equal(ui.document.body.dataset.entryStage, current);
  for (const name of stages) {
    const panel = ui.document.getElementById(name + '-stage');
    assert.equal(panel.hidden, name !== current, name + ' visibility');
    assert.equal(panel.inert, name !== current, name + ' keyboard isolation');
    const step = ui.document.querySelector(`[data-step="${name}"]`);
    assert.equal(step.getAttribute('aria-current'), name === current ? 'step' : null);
    assert.equal(step.dataset.state, name === current ? 'current' : stages.indexOf(name) < stages.indexOf(current) ? 'complete' : 'pending');
  }
  assert.equal(ui.document.querySelectorAll('[aria-current="step"]').length, 1);
  assert.equal(ui.document.querySelector('.setup-progress').style.getPropertyValue('--active-step'), String(stages.indexOf(current)));
}

test('initial and non-focusing entry routes update accessibility state without motion or focus theft', (t) => {
  const ui = fixture(t);
  assertStage(ui, 'configure');
  assert.equal(ui.document.activeElement, ui.document.body);
  assert.equal(ui.focusCalls.length, 0); assert.equal(ui.animations.length, 0);
  assert.equal(ui.document.querySelector('.setup-progress').dataset.motion, 'instant');
  assert.equal(ui.document.getElementById('setup-progress-fill').style.width, '0%');
  ui.flow.show('ready', false);
  assertStage(ui, 'ready');
  assert.equal(ui.document.getElementById('setup-progress-fill').style.width, '100%');
  assert.equal(ui.document.activeElement, ui.document.body);
  assert.equal(ui.focusCalls.length, 0); assert.equal(ui.animations.length, 0);
  assert.deepEqual(ui.stageEvents, ['configure', 'ready']);
});

test('forward and back navigation focus the incoming heading and hide the old page before animating', (t) => {
  const ui = fixture(t);
  const start = (name, direction) => {
    const before = ui.animations.length;
    ui.flow.show(name); assertStage(ui, name);
    const panel = ui.document.getElementById(name + '-stage'), heading = ui.document.getElementById(name + '-title');
    assert.equal(ui.document.activeElement, heading); assert.equal(heading.tabIndex, -1);
    assert.equal(ui.focusCalls.at(-1).preventScroll, true);
    const incoming = ui.animations.slice(before);
    assert.ok(incoming.length > 0);
    const marker = ui.document.querySelector(`[data-step="${name}"] .progress-number`);
    assert.ok(incoming.every(animation => panel.contains(animation.target) || animation.target === marker), 'Only the incoming page and its active marker may animate');
    assert.ok(incoming.some(animation => animation.target === marker), 'The active marker confirms the selected step');
    assert.equal(ui.document.querySelector('.setup-progress').dataset.motion, 'animated');
    for (const animation of incoming) for (const old of animation.panelsAtStart.filter(item => item.name !== name)) {
      assert.equal(old.hidden, true); assert.equal(old.inert, true);
    }
    const slide = incoming.find(animation => animation.target === panel);
    const distance = Number(slide.frames[0].transform.match(/translateX\((-?[\d.]+)px\)/)[1]);
    assert.equal(Math.sign(distance), direction, 'Forward and Back need opposite visual directions');
  };
  start('preferences', 1);
  assert.equal(ui.document.getElementById('setup-progress-fill').style.width, '50%');
  start('ready', 1); start('preferences', -1);
  assert.deepEqual(ui.stageEvents, ['configure', 'preferences', 'ready', 'preferences']);
});

test('rapid navigation cancels superseded motion and leaves no delayed page changes or duplicate timers', async (t) => {
  const ui = fixture(t);
  ui.flow.show('preferences'); const first = [...ui.animations];
  ui.flow.show('ready'); const second = ui.animations.slice(first.length);
  assert.ok(first.every(animation => animation.cancellations === 1));
  ui.flow.show('configure');
  assert.ok(second.every(animation => animation.cancellations === 1));
  const final = ui.animations.at(-1);
  assert.equal(final.target.id, 'configure-stage'); assert.equal(final.cancellations, 0);
  ui.pagehide(); ui.pagehide();
  assert.equal(final.cancellations, 1, 'Repeated page cleanup must not re-cancel old animation handles');
  await Promise.resolve();
  assertStage(ui, 'configure');
  assert.equal(ui.document.activeElement.id, 'configure-title');
  assert.deepEqual(ui.timers, [], 'Transitions must not leave timer-driven navigation or background loops');
});

test('reduced motion skips transitions and changing the preference cancels motion already running', (t) => {
  const ui = fixture(t, { reduced: true });
  ui.flow.show('preferences'); assertStage(ui, 'preferences');
  assert.equal(ui.document.activeElement.id, 'preferences-title'); assert.equal(ui.animations.length, 0);
  ui.setReduced(false); ui.flow.show('ready');
  assert.ok(ui.animations.length > 0);
  const running = [...ui.animations]; ui.setReduced(true);
  assert.ok(running.every(animation => animation.cancellations === 1));
  assert.equal(ui.document.querySelector('.setup-progress').dataset.motion, 'instant');
  ui.flow.show('configure'); assertStage(ui, 'configure');
  assert.equal(ui.document.activeElement.id, 'configure-title');
  assert.equal(ui.animations.length, running.length);
});

test('finished transitions are released and invalid or same-page routes do not start extra motion', async (t) => {
  const ui = fixture(t);
  ui.flow.show('preferences'); const completed = [...ui.animations];
  for (const animation of completed) animation.finish();
  await Promise.resolve();
  ui.flow.show('not-a-stage'); assertStage(ui, 'preferences');
  assert.equal(ui.animations.length, completed.length);
  ui.flow.show('preferences');
  assert.equal(ui.animations.length, completed.length);
  assert.ok(completed.every(animation => animation.cancellations === 0));
  ui.flow.show('ready');
  assert.ok(completed.every(animation => animation.cancellations === 0), 'Completed handles must not accumulate until later navigation');
});

test('navigation stays accessible when animation APIs are unavailable or the document is hidden', (t) => {
  const ui = fixture(t, { animationSupport: false });
  ui.flow.show('preferences'); assertStage(ui, 'preferences');
  assert.equal(ui.document.activeElement.id, 'preferences-title');
  const hidden = fixture(t);
  Object.defineProperty(hidden.document, 'hidden', { configurable: true, value: true });
  hidden.flow.show('ready'); assertStage(hidden, 'ready');
  assert.equal(hidden.animations.length, 0);
});
