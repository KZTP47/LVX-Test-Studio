// An explicit user click accepts only the imported items named by this error.
// Ordinary validation, conflicts and provider errors have no bypass action.
export function attachImportReviewRecovery(error, invoke, workspaceRoot) {
  const hashes = error?.details?.hashes;
  if (error?.code !== 'IMPORT_REVIEW_REQUIRED' || !workspaceRoot || !Array.isArray(hashes) || !hashes.length || !hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) return error;
  const selected = [...new Set(hashes)];
  error.acceptImportReview = async () => {
    for (const hash of selected) {
      const result = await invoke('host', 'trustImport', {hash, workspaceRoot});
      if (result?.__lvxError) throw Object.assign(Error(result.__lvxError.message), result.__lvxError);
      if (result?.trusted !== true || result.hash !== hash) throw Error('Import acceptance was not confirmed. Try again.');
    }
  };
  return error;
}

const recoveries = new WeakMap();
export function appendImportReviewAction(container, error, recover) {
  if (!container || typeof error?.acceptImportReview !== 'function') return;
  let state = recoveries.get(error);
  if (!state) { state = {busy:false, buttons:new Set()}; recoveries.set(error, state); }
  for (const item of state.buttons) if (!item.isConnected) state.buttons.delete(item);
  const button = document.createElement('button'); button.type = 'button';
  button.className = 'lvx-import-accept'; button.textContent = 'bypass and accept';
  button.title = 'Accept the imported content blocking this action and retry';
  button.disabled = state.busy; state.buttons.add(button);
  button.onclick = async () => {
    if (state.busy) return; state.busy = true;
    for (const item of state.buttons) item.disabled = true;
    try { await recover(); }
    catch (failure) { container.textContent = failure.message || String(failure); }
    finally { state.busy = false; for (const item of state.buttons) if (item.isConnected) item.disabled = false; }
  };
  container.append(' ', button);
}
if (typeof window !== 'undefined') window.LVXImportReviewRecovery = {append:appendImportReviewAction};
