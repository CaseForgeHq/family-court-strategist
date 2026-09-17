const token = location.hash.slice(1); history.replaceState(null, '', '/');
const $ = id => document.getElementById(id); let busy = false, prepared = false;
async function api(path, value) {
  const response = await fetch(`/api/${path}`, { method: value ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(value ? { body: JSON.stringify(value) } : {}) });
  const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
}
function preview() {
  $('preview-title').textContent = $('required').checked ? 'Required update' : 'Update available';
  $('preview-message').textContent = $('message').value || 'Your release message appears here.';
  $('publish').disabled = busy || !prepared || $('confirmation').value !== 'PUBLISH'; $('prepare').disabled = busy;
}
for (const id of ['message', 'required']) $(id).addEventListener('input', () => { prepared = false; preview(); });
$('confirmation').addEventListener('input', preview);
async function run(action) {
  if (busy) return; busy = true; preview(); $('status').textContent = action === 'publish' ? 'Verifying and publishing…' : 'Checking the built installer…';
  try {
    const result = await api(action, action === 'prepare' ? { message: $('message').value, required: $('required').checked } : { confirm: $('confirmation').value, version: prepared.version, message: prepared.message, required: prepared.required });
    prepared = action === 'prepare' ? result : false; $('status').textContent = result.result;
    if (action === 'publish') $('confirmation').value = '';
  } catch (error) { $('status').textContent = error.message; }
  finally { busy = false; preview(); }
}
$('prepare').addEventListener('click', () => run('prepare')); $('publish').addEventListener('click', () => run('publish'));
api('status').then(info => { $('version').textContent = `Version ${info.version} · ${info.repository}`; $('preview-version').textContent = `Case Forge ${info.version}`; $('message').value = info.message; $('required').checked = info.required; preview(); }).catch(error => { $('status').textContent = error.message; });
async function refreshQueue() {
  try {
    const { entries } = await api('queue'); $('queue').replaceChildren();
    for (const entry of entries.filter(e => !['published','cancelled'].includes(e.state))) {
      const item = document.createElement('li');
      item.textContent = `${entry.state}${entry.version ? ' · v' + entry.version : ''}: ${entry.message}`;
      $('queue').append(item);
    }
    if (!$('queue').children.length) { const item = document.createElement('li'); item.textContent = 'No pending releases.'; $('queue').append(item); }
  } catch (error) { $('queue').textContent = error.message; }
}
void refreshQueue(); setInterval(refreshQueue, 5000);
