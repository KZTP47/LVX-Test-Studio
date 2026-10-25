/* Explicit archive recovery remains usable when the project's SQLite cannot open. */
(function (global) {
  'use strict';
  const MAX_BYTES = 100 * 1024 * 1024;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => global.LVXIcons?.svg(name) || '';
  function unwrap(result) {
    if (result?.__lvxError) { const error = new Error(result.__lvxError.message); error.code = result.__lvxError.code; error.details = result.__lvxError.details; throw error; }
    return result;
  }
  async function render(container, { onRecovered } = {}) {
    if (!container || typeof container.querySelector !== 'function') throw new TypeError('Choose a recovery container.');
    const bridge = global.electronAPI?.studioOps;
    let archive = null, valid = false, busy = false, finished = false, selectedFile = null, generation = 0, workspaceRoot;
    const call = async (action, payload = {}) => {
      if (!bridge) throw new Error('Open the desktop app to recover a project.');
      return unwrap(await (bridge.invokeRaw || bridge.invoke).call(bridge, 'workspace', action, { ...payload, ...(workspaceRoot ? { workspaceRoot } : {}) }));
    };
    container.innerHTML = `<div class="studio-page-title"><h2 tabindex="-1">Restore your project</h2><p>A saved project archive can rebuild a workspace that cannot be opened. Your original database will be preserved.</p></div><p data-recovery-status role="status" aria-live="polite" tabindex="-1">Reading the selected workspace…</p><div data-recovery-content></div>`;
    const notice = container.querySelector('[data-recovery-status]'), body = container.querySelector('[data-recovery-content]');
    const message = (text, error = false, focus = false) => { notice.textContent = text; notice.setAttribute('role', error ? 'alert' : 'status'); if (focus) notice.focus(); };
    let status;
    try { status = await call('status'); workspaceRoot = status.workspaceRoot; if (!workspaceRoot) throw new Error('Choose the workspace folder before restoring an archive.'); }
    catch (error) { message(error.message, true, true); return; }
    // The exact root is captured once. Host workspace checks reject stale forms.
    body.innerHTML = `<p class="studio-path">Workspace: ${esc(workspaceRoot)}</p>${status.error ? `<details class="studio-evidence"><summary>Why the project could not open</summary><p>${esc(status.error.message)}</p></details>` : ''}<form data-recovery-form><section class="studio-section"><h3>Choose a saved archive</h3><p>Select an LVX project archive (.json), smaller than 100 MB. Validation checks its format, checksums, records and dependencies before anything changes.</p><label class="studio-field">Project archive<input type="file" name="recovery-archive" accept=".json,application/json" aria-describedby="recovery-file-help"></label><p id="recovery-file-help">Use an archive exported from Project &amp; backup. A damaged or incomplete file cannot be restored.</p><div class="studio-actions"><button type="submit" data-recovery-validate disabled>${icon('search')}Validate archive</button></div><div data-recovery-preview></div></section><section class="studio-section"><h3>Replace the damaged workspace</h3><p>Restore replaces all current project records and stored evidence with this archive. The original database and its journals are kept in the private project storage folder for recovery.</p><p>Credential values are excluded. Imported code must be reviewed before it can run. Restored schedules stay disabled until you enable them.</p><label><input type="checkbox" name="recovery-confirm" disabled> I understand this replaces the current project with the selected archive.</label><div class="studio-actions"><button type="button" data-recovery-restore class="studio-primary" disabled>${icon('refresh')}Restore project from archive</button></div></section></form><section class="studio-section" data-recovery-result hidden></section>`;
    const form = body.querySelector('form'), fileInput = body.querySelector('[name="recovery-archive"]'), validateButton = body.querySelector('[data-recovery-validate]'), confirm = body.querySelector('[name="recovery-confirm"]'), restoreButton = body.querySelector('[data-recovery-restore]'), preview = body.querySelector('[data-recovery-preview]'), resultRegion = body.querySelector('[data-recovery-result]');
    function controls() {
      form.setAttribute('aria-busy', String(busy));
      fileInput.disabled = busy || finished; validateButton.disabled = busy || finished || !selectedFile;
      confirm.disabled = busy || finished || !valid;
      restoreButton.disabled = busy || finished || !valid || !confirm.checked;
      validateButton.innerHTML = `${icon('search')}${busy && !valid ? 'Validating archive…' : 'Validate archive'}`;
      restoreButton.innerHTML = `${icon('refresh')}${busy && valid ? 'Restoring project…' : 'Restore project from archive'}`;
    }
    function invalidate() { generation++; archive = null; valid = false; confirm.checked = false; preview.replaceChildren(); controls(); }
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files?.[0] || null; invalidate();
      if (selectedFile && selectedFile.size >= MAX_BYTES) { selectedFile = null; controls(); message('This archive is too large. Choose a JSON archive smaller than 100 MB.', true, true); }
      else message(selectedFile ? `Selected ${selectedFile.name}. Validate it to see what will be restored.` : 'Choose a saved project archive.');
    });
    confirm.addEventListener('change', controls);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || finished || !selectedFile) return;
      invalidate(); const token = generation, file = selectedFile; busy = true; controls(); message('Checking the archive. Your original database is unchanged.');
      try {
        const parsed = JSON.parse(await file.text());
        const validation = await call('validateRecovery', { archive: parsed });
        if (token !== generation || !form.isConnected) return;
        const errors = Array.isArray(validation?.errors) ? validation.errors : [];
        if (validation?.valid !== true) {
          preview.innerHTML = `<h4 tabindex="-1">Archive needs attention</h4><ul>${(errors.length ? errors : ['The archive could not be verified.']).slice(0, 30).map(error => `<li>${esc(error)}</li>`).join('')}</ul><p>Choose a complete archive exported from LVX. Your original database has not been changed.</p>`;
          message('Validation failed. Nothing has been restored.', true); preview.querySelector('h4').focus(); return;
        }
        if (!Number.isSafeInteger(validation.records) || validation.records < 0 || !Number.isSafeInteger(validation.artifacts) || validation.artifacts < 0) throw new Error('The archive preview is incomplete. Validate the file again.');
        archive = parsed; valid = true;
        preview.innerHTML = `<h4 tabindex="-1">Archive validated</h4><p><strong>${validation.records} project records</strong> and <strong>${validation.artifacts} evidence files</strong> will replace this workspace.</p><p>Checksums and dependencies passed. Credential values are excluded; code still requires review.</p>`;
        message('Archive validated. Review the replacement notice and confirm before restoring.'); preview.querySelector('h4').focus();
      } catch (error) { message(error instanceof SyntaxError ? 'This file is not valid JSON. Choose an LVX project archive and validate it again.' : error.message, true, true); }
      finally { busy = false; controls(); }
    });
    restoreButton.addEventListener('click', async () => {
      if (busy || finished || !valid || !confirm.checked || !archive) return;
      busy = true; controls(); message('Restoring the verified archive. Keep this window open.');
      try {
        const result = await call('recover', { archive });
        if (result?.status !== 'SUCCESS' || result.recovered !== true) throw new Error('The service did not confirm recovery. Your project has not been reported as restored.');
        finished = true;
        const warnings = Array.isArray(result.warnings) ? result.warnings : [];
        resultRegion.hidden = false;
        resultRegion.innerHTML = `<h3 tabindex="-1">${warnings.length ? 'Project restored; some evidence needs attention' : 'Project restored'}</h3><p>The verified archive is now saved in this workspace. Review imported code in Project &amp; backup before running it.</p>${warnings.length ? `<ul>${warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}<details class="studio-evidence"><summary>Original database preserved</summary><p class="studio-path">${esc(result.preservedDatabase || 'The service preserved the original database in private project storage.')}</p></details>${onRecovered ? `<div class="studio-actions"><button type="button" data-recovery-open>${icon('folder')}Open recovered project</button></div>` : ''}`;
        message(warnings.length ? 'Project restored. Review the evidence warnings below.' : 'Project restored. Your original database was preserved.'); resultRegion.querySelector('h3').focus();
        resultRegion.querySelector('[data-recovery-open]')?.addEventListener('click', async event => {
          const button = event.currentTarget; button.disabled = true;
          try { await onRecovered(result); }
          catch (error) { message(`The project was restored, but could not be opened: ${error.message}. Reload the app to try again.`, true, true); button.disabled = false; }
        });
      } catch (error) { message(`Recovery failed: ${error.message} Validate the archive again before retrying.`, true, true); valid = false; archive = null; confirm.checked = false; }
      finally { busy = false; controls(); }
    });
    message(status.error ? 'This workspace could not open. Choose a saved archive to recover it.' : 'Choose the saved archive you want to restore.');
    container.querySelector('h2').focus();
  }
  global.LVXRecovery = { render };
})(window);
