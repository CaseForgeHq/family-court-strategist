// Pointer-driven decorative lighting. Actual controls never tilt or move.
(() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (hover: none)');
  const surfaces = Array.from(document.querySelectorAll('.entry-card, .hero-glass:not(.terms-glass)'));
  let frame = null, pending = null;
  function reset(surface) {
    surface.removeAttribute('data-glass-active');
    surface.style.removeProperty('--glass-tilt-x');
    surface.style.removeProperty('--glass-tilt-y');
    surface.style.removeProperty('--glass-spot-x');
    surface.style.removeProperty('--glass-spot-y');
  }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; pending = null;
    surfaces.forEach(reset);
  }
  function paint() {
    frame = null;
    if (!pending || preference.matches || document.hidden) return;
    const { surface, clientX, clientY } = pending;
    pending = null;
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const x = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height));
    surface.setAttribute('data-glass-active', 'true');
    surface.style.setProperty('--glass-tilt-x', `${((.5 - y) * 4).toFixed(2)}deg`);
    surface.style.setProperty('--glass-tilt-y', `${((x - .5) * 4).toFixed(2)}deg`);
    surface.style.setProperty('--glass-spot-x', `${(x * 100).toFixed(1)}%`);
    surface.style.setProperty('--glass-spot-y', `${(y * 100).toFixed(1)}%`);
  }
  for (const surface of surfaces) {
    surface.addEventListener('pointermove', (event) => {
      if (preference.matches || document.hidden || event.pointerType === 'touch') return;
      pending = { surface, clientX: event.clientX, clientY: event.clientY };
      if (frame === null) frame = requestAnimationFrame(paint);
    }, { passive: true });
    surface.addEventListener('pointerleave', () => {
      if (pending?.surface === surface) { pending = null; if (frame !== null) cancelAnimationFrame(frame); frame = null; }
      reset(surface);
    });
    surface.addEventListener('pointercancel', () => reset(surface));
  }
  preference.addEventListener('change', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('blur', stop);
  window.addEventListener('pagehide', stop);
})();
