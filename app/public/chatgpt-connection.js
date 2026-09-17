// One account state shared by chat and document scans. Credentials remain in
// the native runtime's OS credential store; never in browser storage.
const connections = new WeakMap();
export const chatGPTBrand = '<img src="/vendor/openai/monoblossom-white.svg" width="22" height="22" alt=""><span>Sign in with ChatGPT</span>';

export function getChatGPTConnection(desktop) {
  if (desktop && connections.has(desktop)) return connections.get(desktop);
  const listeners = new Set();
  const targetWindow = globalThis.window, targetDocument = globalThis.document;
  let state = { connected: false, checking: Boolean(desktop?.chatGPTStatus), available: Boolean(desktop?.chatGPTLogin) };
  let revision = 0, pendingRefresh, pendingAction, poll, disposed = false;
  function publish(value) {
    if (disposed) return;
    value = { ...value };
    // A transport check is not a logout. Retain the last known account until
    // the runtime confirms signed_out, without persisting an optimistic flag.
    if (state.connected && value.connected === false && (value.error || ['error','unknown','checking'].includes(value.state))) {
      for (const key of ['connected','email','plan','model']) delete value[key];
    } else if (value.connected === false) value = { email:null, plan:null, model:null, ...value };
    state = { ...state, ...value };
    clearTimeout(poll);
    if (state.signingIn && listeners.size) poll = setTimeout(() => void refresh(), 2000);
    for (const listener of listeners) { try { listener(state); } catch { /* One view cannot prevent other account updates. */ } }
  }
  const unsubscribe = desktop?.onChatGPTStatus?.(value => { revision++; publish({ checking: false, ...value }); });
  async function refresh() {
    if (!desktop?.chatGPTStatus || disposed) return state;
    if (pendingRefresh) return pendingRefresh;
    const start = revision;
    pendingRefresh = (async () => {
      try { const value = await desktop.chatGPTStatus(); if (start === revision) publish({ ...value, checking: false }); }
      catch (error) { if (start === revision) publish({ checking: false, error: error.message || 'Could not check your ChatGPT connection.' }); }
      finally { pendingRefresh = null; }
      return state;
    })();
    return pendingRefresh;
  }
  async function action(method) {
    if (pendingAction) return pendingAction;
    if (!desktop?.[method]) return state;
    const start = ++revision;
    publish({ changing: true, error: null });
    pendingAction = (async () => {
      try {
        const value = await desktop[method]();
        if (start === revision) publish(value);
      } catch (error) { if (start === revision) publish({ error: error.message || 'Could not update your ChatGPT connection.' }); }
      finally { publish({ changing: false }); pendingAction = null; }
      return state;
    })();
    return pendingAction;
  }
  const focus = () => void refresh();
  const visibility = () => { if (!targetDocument.hidden) void refresh(); };
  if (desktop) { targetWindow?.addEventListener('focus', focus); targetDocument?.addEventListener('visibilitychange', visibility); }
  const api = {
    get state() { return state; }, refresh,
    subscribe(listener) {
      listeners.add(listener); listener(state);
      if (state.signingIn && !poll && !disposed) poll = setTimeout(() => void refresh(), 2000);
      return () => { listeners.delete(listener); if (!listeners.size) { clearTimeout(poll); poll = null; } };
    },
    login: () => action('chatGPTLogin'), logout: () => action('chatGPTLogout'), cancelLogin: () => action('chatGPTCancelLogin'),
    dispose() { if (disposed) return; disposed = true; clearTimeout(poll); unsubscribe?.(); listeners.clear(); targetWindow?.removeEventListener('focus', focus); targetDocument?.removeEventListener('visibilitychange', visibility); if (desktop) connections.delete(desktop); },
  };
  if (desktop) connections.set(desktop, api);
  return api;
}
