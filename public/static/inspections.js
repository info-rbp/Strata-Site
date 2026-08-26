// Mobile checkpoint runner for ProInspect Building Management.
(function () {
  'use strict';

  const App = window.ProInspectBM;
  const state = {
    me: null,
    config: null,
    properties: [],
    propertyId: null,
    options: null,
    inspection: null,
    checkpoints: [],
    results: [],
    currentIndex: 0,
  };

  function activeKey() {
    return `proinspect-bm:active-inspection:${state.propertyId || 'unscoped'}`;
  }

  function setActiveInspection(id) {
    if (id) localStorage.setItem(activeKey(), id);
    else localStorage.removeItem(activeKey());
  }

  function getActiveInspection() {
    return localStorage.getItem(activeKey());
  }

  function optionRows(items, label) {
    return [{ value: '', label: label || 'Select…' }].concat((items || []).map((item) => ({
      value: item.value !== undefined ? item.value : item.id,
      label: item.label !== undefined ? item.label : item.name,
    })));
  }

  function setSelect(id, rows) {
    const select = document.getElementById(id);
    select.innerHTML = rows.map((row) => `<option value="${App.escapeHtml(row.value)}">${App.escapeHtml(row.label)}</option>`).join('');
  }

  function setError(id, message) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('hidden', !message);
  }

  async function loadPropertyData() {
    const query = `?propertyId=${encodeURIComponent(state.propertyId)}`;
    const [options, templates] = await Promise.all([
      App.api('/forms/options' + query),
      App.api('/inspection-templates' + query),
    ]);
    state.options = options;
    setSelect('inspection-template', optionRows(templates.map((item) => ({
      value: item.id,
      label: `${item.name}${item.checkpointCount ? ` · ${item.checkpointCount} checks` : ''}`,
    })), 'Choose a template'));
    setSelect('inspection-type', optionRows(state.config.options.inspectionTypes, 'Choose a type'));
    setSelect('inspection-location', optionRows((options.locations || []).map((item) => ({
      value: item.id,
      label: [item.name, item.levelLabel].filter(Boolean).join(' · '),
    })), 'All / not specified'));
    setSelect('inspection-building', optionRows((options.buildings || []).map((item) => ({
      value: item.id, label: item.name,
    })), 'Not specified'));
    await loadInspectionList();
  }

  async function loadInspectionList() {
    const host = document.getElementById('inspection-list');
    host.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading…';
    try {
      const rows = await App.api(`/inspections?propertyId=${encodeURIComponent(state.propertyId)}`);
      if (!rows.length) {
        host.innerHTML = App.emptyState('No inspections recorded yet.', 'fa-clipboard-check');
        return;
      }
      host.innerHTML = `<div class="divide-y divide-slate-100">${rows.slice(0, 20).map((row) => `<div class="py-3 flex items-start justify-between gap-3" data-inspection-id="${App.escapeHtml(row.id)}">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-slate-900 truncate">${App.escapeHtml(row.templateName || row.inspection_type || 'Inspection')}</div>
          <div class="text-xs text-slate-500 mt-1">${App.fmtDateTime(row.finished_at || row.started_at)}${row.locationName ? ` · ${App.escapeHtml(row.locationName)}` : ''}</div>
          <div class="text-xs text-slate-500 mt-1">${Number(row.exceptions_count || 0)} exception(s)</div>
        </div>
        <div class="flex flex-col items-end gap-2 shrink-0">
          ${App.statusChip(row.status)}
          ${row.status === 'in_progress' ? '<button type="button" class="resume-inspection btn-quiet text-xs">Resume</button>' : ''}
        </div>
      </div>`).join('')}</div>`;
      host.querySelectorAll('.resume-inspection').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.closest('[data-inspection-id]').dataset.inspectionId;
          openInspection(id);
        });
      });
    } catch (error) {
      host.innerHTML = `<div class="form-error">${App.escapeHtml(error.message)}</div>`;
    }
  }

  async function startInspection(event) {
    event.preventDefault();
    setError('start-inspection-error', '');
    const button = document.getElementById('start-inspection-button');
    const templateId = document.getElementById('inspection-template').value;
    const inspectionType = document.getElementById('inspection-type').value;
    if (!templateId || !inspectionType) {
      setError('start-inspection-error', 'Choose a template and inspection type.');
      return;
    }
    App.setSubmitting(button, true, 'Starting…');
    try {
      const response = await App.api('/inspections', {
        method: 'POST',
        body: {
          propertyId: state.propertyId,
          templateId,
          inspectionType,
          locationId: document.getElementById('inspection-location').value || undefined,
          buildingId: document.getElementById('inspection-building').value || undefined,
          levelLabel: document.getElementById('inspection-level').value || undefined,
          specificLocation: document.getElementById('inspection-specific-location').value || undefined,
        },
      });
      setActiveInspection(response.id);
      await openInspection(response.id);
    } catch (error) {
      setError('start-inspection-error', error.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function openInspection(id) {
    try {
      const payload = await App.api('/inspections/' + encodeURIComponent(id));
      state.inspection = payload.inspection;
      state.checkpoints = payload.checkpoints || [];
      state.results = payload.results || [];
      state.propertyId = state.inspection.property_id;
      setActiveInspection(id);
      const answered = new Set(state.results.map((result) => result.checkpoint_id));
      const firstUnanswered = state.checkpoints.findIndex((checkpoint) => !answered.has(checkpoint.id));
      state.currentIndex = firstUnanswered >= 0 ? firstUnanswered : Math.max(0, state.checkpoints.length - 1);
      document.getElementById('inspection-home').classList.add('hidden');
      document.getElementById('inspection-runner').classList.remove('hidden');
      renderCheckpoint();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      if (error.status === 404) setActiveInspection(null);
      App.toast(error.message || 'Inspection could not be opened.', 'error');
    }
  }

  function resultFor(checkpointId) {
    return state.results.find((result) => result.checkpoint_id === checkpointId) || null;
  }

  function progress() {
    const answered = new Set(state.results.map((result) => result.checkpoint_id)).size;
    return { answered, total: state.checkpoints.length, percent: state.checkpoints.length ? Math.round(answered / state.checkpoints.length * 100) : 0 };
  }

  function renderCheckpoint() {
    const inspection = state.inspection;
    const host = document.getElementById('checkpoint-host');
    document.getElementById('runner-title').textContent = inspection.templateName || inspection.inspection_type || 'Inspection';
    document.getElementById('runner-subtitle').textContent = [inspection.locationName, inspection.level_label, inspection.specific_location].filter(Boolean).join(' · ');
    const stats = progress();
    document.getElementById('runner-progress-label').textContent = `${stats.answered} / ${stats.total}`;
    document.getElementById('runner-progress').style.width = `${stats.percent}%`;

    if (!state.checkpoints.length) {
      host.innerHTML = `<div class="form-error">This template has no checkpoints. Add checkpoints before running it.</div>`;
      return;
    }
    if (inspection.status === 'completed') {
      host.innerHTML = renderCompletedInspection();
      return;
    }

    const checkpoint = state.checkpoints[state.currentIndex];
    const existing = resultFor(checkpoint.id);
    const position = `${state.currentIndex + 1} of ${state.checkpoints.length}`;
    host.innerHTML = `<form id="checkpoint-form" class="grid gap-4" novalidate>
      <input type="hidden" name="checkpointId" value="${App.escapeHtml(checkpoint.id)}" />
      <div>
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-400">Checkpoint ${position}</div>
        <h2 class="text-lg font-semibold text-slate-900 mt-1">${App.escapeHtml(checkpoint.label)}</h2>
        <p class="text-sm text-slate-500 mt-1">${App.escapeHtml(checkpoint.locationName || inspection.locationName || 'Common property')}</p>
      </div>
      <div class="choice-grid">
        ${choice('checkpoint-result', 'pass', 'OK', 'fa-check', existing && existing.result === 'pass')}
        ${choice('checkpoint-result', 'fail', 'Defect', 'fa-triangle-exclamation', existing && existing.result === 'fail')}
        ${choice('checkpoint-result', 'not_applicable', 'N/A', 'fa-minus', existing && existing.result === 'not_applicable')}
      </div>
      <div id="defect-fields" class="${existing && existing.result === 'fail' ? '' : 'hidden'} grid gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <div>
          <label class="field-label field-required" for="checkpoint-observation">Describe the defect</label>
          <textarea id="checkpoint-observation" class="field-input" rows="3" placeholder="What is wrong and where exactly?">${App.escapeHtml(existing && existing.observation || '')}</textarea>
        </div>
        <div class="form-grid two">
          <div>
            <label class="field-label" for="checkpoint-risk">Risk level</label>
            <select id="checkpoint-risk" class="field-input">${state.config.options.riskLevels.map((item) => `<option value="${App.escapeHtml(item.value)}" ${existing && existing.risk_level === item.value ? 'selected' : ''}>${App.escapeHtml(item.label)}</option>`).join('')}</select>
          </div>
          <div>
            <label class="field-label" for="checkpoint-followup">Follow-up date</label>
            <input id="checkpoint-followup" class="field-input" type="date" value="${App.escapeHtml(existing && existing.follow_up_date || '')}" />
          </div>
        </div>
        <div>
          <label class="field-label" for="checkpoint-action">Immediate action / make safe</label>
          <textarea id="checkpoint-action" class="field-input" rows="2">${App.escapeHtml(existing && existing.immediate_action || '')}</textarea>
        </div>
        <label class="flex items-start gap-2 text-sm text-slate-700">
          <input id="checkpoint-maintenance" type="checkbox" class="mt-1 rounded" ${!existing || existing.maintenance_required ? 'checked' : ''} />
          <span>Create / maintain a linked maintenance defect</span>
        </label>
        <div>
          <label class="field-label" for="checkpoint-photo">Photo</label>
          <input id="checkpoint-photo" class="field-input" type="file" accept="image/*" capture="environment" />
          ${existing && existing.photo_r2_key ? '<span class="field-hint">A photo is already attached. Selecting another replaces the result photo reference.</span>' : ''}
        </div>
      </div>
      <div id="checkpoint-error" class="hidden form-error"></div>
      <div class="form-actions">
        <button type="button" id="checkpoint-previous" class="btn-secondary" ${state.currentIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-left"></i>Previous</button>
        <button type="submit" id="checkpoint-save" class="btn-primary">Save &amp; next<i class="fa-solid fa-arrow-right"></i></button>
      </div>
    </form>`;

    const form = document.getElementById('checkpoint-form');
    form.querySelectorAll('input[name="checkpoint-result"]').forEach((input) => {
      input.addEventListener('change', () => {
        document.getElementById('defect-fields').classList.toggle('hidden', input.value !== 'fail' || !input.checked);
      });
    });
    document.getElementById('checkpoint-previous').addEventListener('click', () => {
      if (state.currentIndex > 0) { state.currentIndex -= 1; renderCheckpoint(); }
    });
    form.addEventListener('submit', saveCheckpoint);
  }

  function choice(name, value, label, icon, checked) {
    const id = `${name}-${value}`;
    return `<div class="choice-card">
      <input type="radio" id="${id}" name="${name}" value="${value}" ${checked ? 'checked' : ''} required />
      <label for="${id}"><i class="fa-solid ${icon} mr-2"></i>${label}</label>
    </div>`;
  }

  async function saveCheckpoint(event) {
    event.preventDefault();
    const checkpoint = state.checkpoints[state.currentIndex];
    const selected = document.querySelector('input[name="checkpoint-result"]:checked');
    const errorHost = document.getElementById('checkpoint-error');
    errorHost.classList.add('hidden');
    if (!selected) {
      errorHost.textContent = 'Choose OK, Defect or N/A.';
      errorHost.classList.remove('hidden');
      return;
    }
    const result = selected.value;
    const observation = document.getElementById('checkpoint-observation').value.trim();
    if (result === 'fail' && !observation) {
      errorHost.textContent = 'Describe the defect before saving.';
      errorHost.classList.remove('hidden');
      return;
    }
    const button = document.getElementById('checkpoint-save');
    App.setSubmitting(button, true, 'Saving…');
    try {
      let upload = null;
      const photoInput = document.getElementById('checkpoint-photo');
      if (result === 'fail' && photoInput.files && photoInput.files[0]) {
        upload = await App.upload(photoInput.files[0], state.propertyId);
      }
      const response = await App.api(`/inspections/${encodeURIComponent(state.inspection.id)}/results`, {
        method: 'POST',
        body: {
          checkpointId: checkpoint.id,
          result,
          observation: result === 'fail' ? observation : undefined,
          riskLevel: result === 'fail' ? document.getElementById('checkpoint-risk').value : 'normal',
          immediateAction: result === 'fail' ? document.getElementById('checkpoint-action').value || undefined : undefined,
          maintenanceRequired: result === 'fail' ? document.getElementById('checkpoint-maintenance').checked : false,
          followUpDate: result === 'fail' ? document.getElementById('checkpoint-followup').value || undefined : undefined,
          photoR2Key: upload && upload.r2Key,
          photoContentType: upload && upload.contentType,
        },
      });
      const updatedResult = {
        id: response.id,
        checkpoint_id: checkpoint.id,
        result,
        observation: result === 'fail' ? observation : null,
        risk_level: result === 'fail' ? document.getElementById('checkpoint-risk').value : 'normal',
        immediate_action: result === 'fail' ? document.getElementById('checkpoint-action').value : null,
        maintenance_required: result === 'fail' && document.getElementById('checkpoint-maintenance').checked ? 1 : 0,
        follow_up_date: result === 'fail' ? document.getElementById('checkpoint-followup').value : null,
        photo_r2_key: upload && upload.r2Key || (resultFor(checkpoint.id) && resultFor(checkpoint.id).photo_r2_key) || null,
        defect_id: response.defectId,
      };
      const index = state.results.findIndex((item) => item.checkpoint_id === checkpoint.id);
      if (index >= 0) state.results[index] = updatedResult;
      else state.results.push(updatedResult);
      document.getElementById('inspection-save-state').textContent = 'Saved';
      if (state.currentIndex < state.checkpoints.length - 1) state.currentIndex += 1;
      renderCheckpoint();
    } catch (error) {
      errorHost.textContent = error.message;
      errorHost.classList.remove('hidden');
      App.toast(error.message, 'error');
    } finally {
      App.setSubmitting(button, false);
    }
  }

  function renderCompletedInspection() {
    return `<div>
      <div class="form-success mb-4"><i class="fa-solid fa-circle-check mr-2"></i>Inspection completed and included in the reporting register.</div>
      <div class="divide-y divide-slate-100">${state.checkpoints.map((checkpoint) => {
        const result = resultFor(checkpoint.id);
        return `<div class="py-3 flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-medium text-slate-900">${App.escapeHtml(checkpoint.label)}</div>
            ${result && result.observation ? `<div class="text-xs text-slate-500 mt-1">${App.escapeHtml(result.observation)}</div>` : ''}
          </div>
          ${App.statusChip(result ? result.result : 'not_applicable')}
        </div>`;
      }).join('')}</div>
      <div class="mt-5 flex gap-3 no-print">
        <button type="button" id="completed-back" class="btn-secondary">Return to inspections</button>
        <a href="/bm/forms?form=maintenance_defect" class="btn-primary">Record another defect</a>
      </div>
    </div>`;
  }

  function renderFinishScreen() {
    const stats = progress();
    const defects = state.results.filter((result) => result.result === 'fail').length;
    const host = document.getElementById('checkpoint-host');
    host.innerHTML = `<div class="text-center py-4">
      <div class="w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 mx-auto flex items-center justify-center text-xl"><i class="fa-solid fa-check"></i></div>
      <h2 class="text-xl font-semibold text-slate-900 mt-4">All checkpoints recorded</h2>
      <p class="text-sm text-slate-500 mt-1">${stats.total} checks · ${defects} defect(s)</p>
      <div class="max-w-xl mx-auto mt-5 text-left">
        <label class="field-label" for="inspection-finish-notes">Inspection notes</label>
        <textarea id="inspection-finish-notes" class="field-input" rows="3" placeholder="Optional overall notes"></textarea>
        <div id="finish-error" class="hidden form-error mt-3"></div>
      </div>
      <div class="mt-5 flex flex-col sm:flex-row justify-center gap-3">
        <button type="button" id="finish-review" class="btn-secondary">Review checks</button>
        <button type="button" id="finish-inspection" class="btn-primary"><i class="fa-solid fa-flag-checkered"></i>Complete inspection</button>
      </div>
    </div>`;
    document.getElementById('finish-review').addEventListener('click', () => {
      state.currentIndex = 0;
      renderCheckpoint();
    });
    document.getElementById('finish-inspection').addEventListener('click', finishInspection);
  }

  async function finishInspection() {
    const button = document.getElementById('finish-inspection');
    const errorHost = document.getElementById('finish-error');
    App.setSubmitting(button, true, 'Completing…');
    try {
      await App.api(`/inspections/${encodeURIComponent(state.inspection.id)}/finish`, {
        method: 'POST',
        body: {
          notes: document.getElementById('inspection-finish-notes').value || undefined,
          clientSubmissionId: App.clientId('inspection-complete'),
        },
      });
      state.inspection.status = 'completed';
      setActiveInspection(null);
      App.toast('Inspection completed.', 'success');
      renderCheckpoint();
      const back = document.getElementById('completed-back');
      if (back) back.addEventListener('click', exitRunner);
    } catch (error) {
      errorHost.textContent = error.message;
      errorHost.classList.remove('hidden');
    } finally {
      App.setSubmitting(button, false);
    }
  }

  function nextOrFinish() {
    if (progress().answered === state.checkpoints.length) renderFinishScreen();
    else renderCheckpoint();
  }

  function exitRunner() {
    document.getElementById('inspection-runner').classList.add('hidden');
    document.getElementById('inspection-home').classList.remove('hidden');
    state.inspection = null;
    state.checkpoints = [];
    state.results = [];
    loadInspectionList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function initialise() {
    try {
      state.me = await App.initShell();
      if (!state.me) return;
      const [config, properties] = await Promise.all([App.api('/forms/config'), App.api('/properties')]);
      state.config = config;
      state.properties = properties || [];
      state.propertyId = state.me.propertyScope || (state.properties[0] && state.properties[0].id);
      if (!state.propertyId) throw new Error('No property is available for this account.');
      const propertySelect = document.getElementById('inspection-property');
      propertySelect.innerHTML = App.optionsHtml(state.properties.map((item) => ({ value: item.id, label: item.name })), undefined);
      propertySelect.value = state.propertyId;
      if (!state.me.propertyScope && state.properties.length > 1) document.getElementById('inspection-property-row').classList.remove('hidden');
      propertySelect.addEventListener('change', async () => {
        state.propertyId = propertySelect.value;
        await loadPropertyData();
      });
      await loadPropertyData();
      document.getElementById('inspection-loading').classList.add('hidden');
      document.getElementById('inspection-home').classList.remove('hidden');
      document.getElementById('start-inspection-form').addEventListener('submit', startInspection);
      document.getElementById('refresh-inspections').addEventListener('click', loadInspectionList);
      document.getElementById('inspection-exit').addEventListener('click', exitRunner);
      const activeId = getActiveInspection();
      if (activeId) await openInspection(activeId);
    } catch (error) {
      document.getElementById('inspection-loading').innerHTML = `<div class="form-error">${App.escapeHtml(error.message || 'Inspections could not be loaded.')}</div>`;
    }
  }

  // After saving the final checkpoint, render the completion screen rather
  // than making the user press Next into an empty void.
  const originalRender = renderCheckpoint;
  renderCheckpoint = function () {
    if (state.inspection && state.inspection.status !== 'completed' && state.checkpoints.length && progress().answered === state.checkpoints.length && state.currentIndex >= state.checkpoints.length - 1) {
      renderFinishScreen();
      return;
    }
    originalRender();
  };

  initialise();
})();
