(() => {
  const stages = ['configure', 'preferences', 'ready'];
  let current = 'configure';
  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const progress = document.querySelector('.setup-progress');
  const animations = new Set();
  function stopMotion() {
    for (const animation of animations) animation.cancel();
    animations.clear();
    if (progress) progress.dataset.motion = 'instant';
  }
  function animate(element, frames, options) {
    if (!element?.animate) return;
    const animation = element.animate(frames, options);
    animations.add(animation);
    animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
  }
  function show(stage, focus = true) {
    if (!stages.includes(stage) || !document.getElementById(`${stage}-stage`)) return;
    const previous = current;
    const shouldAnimate = focus && previous !== stage && !motion?.matches && !document.hidden;
    stopMotion();
    current = stage;
    document.body.dataset.entryStage = stage;
    if (progress) {
      progress.dataset.motion = shouldAnimate ? 'animated' : 'instant';
      progress.style.setProperty('--active-step', String(stages.indexOf(stage)));
    }
    for (const name of stages) {
      const panel = document.getElementById(`${name}-stage`);
      if (panel) { panel.hidden = name !== stage; panel.inert = name !== stage; }
      const item = document.querySelector(`[data-step="${name}"]`);
      if (!item) continue;
      item.dataset.state = stages.indexOf(name) < stages.indexOf(stage) ? 'complete' : name === stage ? 'current' : 'pending';
      if (name === stage) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    }
    const fill = document.getElementById('setup-progress-fill');
    if (fill) fill.style.width = `${stages.indexOf(stage) * 50}%`;
    window.dispatchEvent(new CustomEvent('caseforge:stage', { detail: { stage } }));
    if (focus) {
      const target = document.querySelector(`#${stage}-stage h1, #${stage}-stage h2`);
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
    }
    // The active marker and incoming page animate; the old page is already inert.
    if (shouldAnimate) {
      const direction = stages.indexOf(stage) > stages.indexOf(previous) ? 1 : -1;
      animate(document.querySelector(`[data-step="${stage}"] .progress-number`), [
        { transform: 'scale(.92)' },
        { transform: 'scale(1.08)', offset: .55 },
        { transform: 'scale(1)' },
      ], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
      animate(document.getElementById(`${stage}-stage`), [
        { opacity: 0, transform: `translateX(${direction * 18}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ], { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' });
      if (stage === 'ready') animate(document.querySelector('.ready-mark path'), [
        { strokeDashoffset: 1 }, { strokeDashoffset: 0 },
      ], { duration: 340, delay: 60, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  motion?.addEventListener?.('change', stopMotion);
  window.addEventListener('pagehide', stopMotion);
  window.CaseForgeEntry = Object.freeze({ show, getStage: () => current });
  show('configure', false);
})();
