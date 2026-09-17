(() => {
  const $ = (id) => document.getElementById(id);
  const documentTerms = window.CaseForgeTerms;
  const reader = $('terms-reader'), checkbox = $('terms-agree');
  const agreement = checkbox.closest('.terms-agreement');
  let receipt = null, reachedEnd = false, busy = false;
  const accepted = () => receipt?.accepted === true && receipt.version === documentTerms?.version;
  function paint() {
    const showAgreement = Boolean(receipt && (accepted() || reachedEnd));
    agreement.hidden = !showAgreement;
    $('ready-open').hidden = !showAgreement;
    checkbox.disabled = busy || !receipt || accepted() || !reachedEnd;
    if (accepted()) checkbox.checked = true;
    $('terms-agree-label').textContent = accepted() ? 'Terms accepted on this device.' : 'I agree to the Beta terms & conditions.';
    const message = accepted() ? 'Accepted · you can review these terms anytime.'
      : reachedEnd ? 'Review complete. You can agree below.' : 'Scroll to the end to continue.';
    if ($('terms-scroll-status').textContent !== message) $('terms-scroll-status').textContent = message;
  }
  function notify() { paint(); window.dispatchEvent(new Event('caseforge:terms')); }
  function measure(fromScroll = false) {
    if (document.body.dataset.entryStage !== 'ready' || reader.closest('[hidden]') || reader.clientHeight <= 0) return;
    const max = Math.max(0, reader.scrollHeight - reader.clientHeight);
    const atEnd = max > 2 && reader.scrollTop > 0 && reader.scrollTop >= max - 2;
    const position = atEnd ? 100 : Math.max(0, Math.min(99, Math.round(reader.scrollTop / max * 100)));
    const displayedPosition = Number.isFinite(position) ? position : 0;
    $('terms-progress').value = displayedPosition; $('terms-progress-value').textContent = `${displayedPosition}%`;
    // A stage change or transient layout must never count as reading the terms.
    if (fromScroll === true && atEnd && !reachedEnd) { reachedEnd = true; notify(); }
  }
  if (documentTerms) {
    $('terms-version').textContent = `${documentTerms.version.replace('beta-', 'v')} · ${documentTerms.updated}`;
    const intro = document.createElement('p'); intro.className = 'terms-introduction'; intro.textContent = documentTerms.introduction;
    $('terms-document').append(intro);
    documentTerms.sections.forEach((section, index) => {
      const wrapper = document.createElement('section'); wrapper.className = 'terms-section';
      const number = document.createElement('span'); number.className = 'terms-section-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('h2'); heading.textContent = section.title;
      const paragraphs = document.createElement('div');
      for (const copy of section.paragraphs) { const paragraph = document.createElement('p'); paragraph.textContent = copy; paragraphs.append(paragraph); }
      wrapper.append(number, heading, paragraphs); $('terms-document').append(wrapper);
    });
    const end = document.createElement('p'); end.className = 'terms-end'; end.textContent = 'End of terms'; $('terms-document').append(end);
  }
  reader.addEventListener('scroll', () => measure(true), { passive: true });
  checkbox.addEventListener('change', notify);
  window.addEventListener('caseforge:stage', () => window.requestAnimationFrame?.(measure));
  window.addEventListener('resize', measure);
  if (window.ResizeObserver) new ResizeObserver(measure).observe(reader);
  window.CaseForgeTermsScreen = Object.freeze({
    async load() {
      const result = await window.strategistDesktop?.getTermsStatus?.();
      if (!documentTerms || result?.error || !result || result.version !== documentTerms.version || !/^[a-f0-9]{64}$/.test(result.documentHash)) {
        receipt = null; paint(); throw new Error(result?.error || 'Terms could not be loaded. Reopen the app and try again.');
      }
      receipt = result; paint();
    },
    canContinue: () => Boolean(receipt && (accepted() || reachedEnd && checkbox.checked)),
    isAccepted: accepted,
    setBusy(value) { busy = value; paint(); },
    async accept() {
      if (accepted()) return;
      if (!receipt || !reachedEnd || !checkbox.checked) throw new Error('Review the terms and select the agreement checkbox.');
      const result = await window.strategistDesktop?.acceptTerms?.({ version: receipt.version, documentHash: receipt.documentHash, accepted: true });
      if (result?.accepted !== true || result.version !== receipt.version || result.documentHash !== receipt.documentHash || result.error) {
        throw new Error(result?.error || 'Your acceptance could not be saved. Please try again.');
      }
      receipt = result; paint();
    }
  });
  paint();
})();
