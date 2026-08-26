// Monthly Building Management Report workspace.
(function () {
  'use strict';

  const App = window.ProInspectBM;
  const state = { me: null, properties: [], propertyId: null, month: null, report: null };
  const SECTION_ORDER = [
    'executive_summary',
    'building_maintenance_repairs',
    'building_security',
    'cleaning',
    'gardening_grounds',
    'resident_movements',
    'resident_inductions',
    'waste_management',
    'contractor_activity',
    'access_devices_keys',
    'bylaw_issues',
    'leave_plans',
    'other',
    'outstanding_actions',
  ];
  const METRICS = [
    ['activitiesRecorded', 'Activities'],
    ['defectsRaised', 'Defects raised'],
    ['openDefects', 'Open defects'],
    ['contractorVisits', 'Contractor visits'],
    ['movesAndDeliveries', 'Moves / deliveries'],
    ['residentInductions', 'Inductions'],
    ['incidents', 'Incidents'],
    ['wasteActivities', 'Waste activities'],
    ['bylawObservations', 'By-law observations'],
    ['inspectionsCompleted', 'Inspections'],
    ['inspectionExceptions', 'Inspection exceptions'],
    ['outstandingTasks', 'Outstanding actions'],
  ];

  function canEdit() {
    return ['building_manager', 'relief_building_manager', 'strata_manager', 'system_administrator'].includes(state.me && state.me.role);
  }

  function showError(message) {
    const host = document.getElementById('report-error');
    host.textContent = message || '';
    host.classList.toggle('hidden', !message);
  }

  function setBusy(button, busy, label) {
    App.setSubmitting(button, busy, label);
  }

  function commentaryKey() {
    return `proinspect-bm:report-commentary:${state.propertyId}:${state.month}`;
  }

  function collectCommentary() {
    const commentary = {};
    document.querySelectorAll('[data-report-commentary]').forEach((textarea) => {
      commentary[textarea.dataset.reportCommentary] = textarea.value.trim();
    });
    return commentary;
  }

  function saveLocalCommentary() {
    App.saveDraft(commentaryKey(), collectCommentary());
    const status = document.getElementById('report-status');
    if (status && (!state.report.draft || state.report.draft.status !== 'finalised')) {
      status.innerHTML = '<span class="text-xs text-slate-400"><i class="fa-solid fa-cloud-arrow-down mr-1"></i>Commentary draft saved on this device</span>';
    }
  }

  function sectionCommentary(sectionKey) {
    const local = App.loadDraft(commentaryKey());
    if (local && local.value && Object.prototype.hasOwnProperty.call(local.value, sectionKey)) return local.value[sectionKey];
    return state.report.commentary && state.report.commentary[sectionKey] || '';
  }

  function renderMetrics() {
    const host = document.getElementById('report-metrics');
    host.innerHTML = METRICS.map(([key, label]) => `<div class="card metric-card">
      <div class="metric-value">${Number(state.report.metrics[key] || 0).toLocaleString('en-AU')}</div>
      <div class="metric-label">${App.escapeHtml(label)}</div>
    </div>`).join('');
  }

  function itemRow(item) {
    const location = [item.location, item.unitNumber ? `Unit ${item.unitNumber}` : null].filter(Boolean).join(' · ');
    return `<tr>
      <td class="whitespace-nowrap">${App.escapeHtml(item.date ? App.fmtDate(item.date) : '—')}</td>
      <td>
        <div class="font-medium text-slate-800">${App.escapeHtml(item.summary)}</div>
        ${location ? `<div class="text-[11px] text-slate-400 mt-1">${App.escapeHtml(location)}</div>` : ''}
      </td>
      <td>${item.actions ? App.escapeHtml(item.actions) : '<span class="text-slate-300">—</span>'}</td>
      <td>${item.status ? App.statusChip(item.status) : ''}</td>
    </tr>`;
  }

  function renderSection(sectionKey) {
    const section = state.report.sections[sectionKey];
    if (!section) return '';
    const commentary = sectionCommentary(sectionKey);
    const finalised = state.report.draft && state.report.draft.status === 'finalised';
    const rows = section.items || [];
    return `<section class="card report-section overflow-hidden" data-section="${App.escapeHtml(sectionKey)}">
      <div class="px-4 sm:px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
        <h2 class="font-semibold text-slate-900">${App.escapeHtml(section.title)}</h2>
        <span class="status-chip status-routine">${rows.length} record${rows.length === 1 ? '' : 's'}</span>
      </div>
      <div class="p-4 sm:p-5">
        <label class="field-label" for="commentary-${App.escapeHtml(sectionKey)}">Report commentary</label>
        <textarea id="commentary-${App.escapeHtml(sectionKey)}" class="field-input mb-4" rows="${sectionKey === 'executive_summary' ? 5 : 3}"
          data-report-commentary="${App.escapeHtml(sectionKey)}" ${finalised || !canEdit() ? 'disabled' : ''}
          placeholder="Add context, decisions, recommendations or commentary not captured by the structured records.">${App.escapeHtml(commentary)}</textarea>
        ${rows.length ? `<div class="overflow-x-auto"><table class="report-table min-w-[760px]">
          <thead><tr><th>Date</th><th>Summary</th><th>Actions / outcome</th><th>Status</th></tr></thead>
          <tbody>${rows.map(itemRow).join('')}</tbody>
        </table></div>` : '<div class="text-sm text-slate-400 py-3">No structured records were captured for this section.</div>'}
      </div>
    </section>`;
  }

  function renderReport() {
    document.getElementById('report-title').textContent = state.report.draft && state.report.draft.title || state.report.title;
    const property = state.report.property || {};
    document.getElementById('report-property-details').textContent = [property.address, property.strataPlan ? `Strata Plan ${property.strataPlan}` : null].filter(Boolean).join(' · ');
    renderMetrics();
    document.getElementById('report-sections').innerHTML = SECTION_ORDER.map(renderSection).join('');
    document.querySelectorAll('[data-report-commentary]').forEach((textarea) => {
      textarea.addEventListener('input', debounce(saveLocalCommentary, 350));
    });
    const finalised = state.report.draft && state.report.draft.status === 'finalised';
    const statusHost = document.getElementById('report-status');
    if (finalised) {
      statusHost.innerHTML = `<div class="form-success"><i class="fa-solid fa-lock mr-2"></i>Finalised ${state.report.draft.finalisedAt ? App.fmtDateTime(state.report.draft.finalisedAt) : ''}. The stored report snapshot is locked.</div>`;
    } else if (state.report.draft) {
      statusHost.innerHTML = `<div class="text-sm text-slate-500">${App.statusChip(state.report.draft.status)} · Last updated ${App.fmtDateTime(state.report.draft.updatedAt)}</div>`;
    } else {
      statusHost.innerHTML = '<div class="text-sm text-slate-500">Live preview. Generate a draft to save commentary and create a stable report snapshot.</div>';
    }
    document.getElementById('report-save').disabled = !canEdit() || finalised;
    document.getElementById('report-generate').disabled = !canEdit() || finalised;
    document.getElementById('report-finalise').disabled = !canEdit() || finalised;
    document.getElementById('report-workspace').classList.remove('hidden');
  }

  let debounceTimer = null;
  function debounce(callback, wait) {
    return function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(callback, wait);
    };
  }

  async function loadReport() {
    state.propertyId = document.getElementById('report-property').value;
    state.month = document.getElementById('report-month').value;
    if (!state.propertyId || !state.month) return;
    showError('');
    document.getElementById('report-loading').classList.remove('hidden');
    document.getElementById('report-workspace').classList.add('hidden');
    try {
      state.report = await App.api(`/reports/monthly?propertyId=${encodeURIComponent(state.propertyId)}&month=${encodeURIComponent(state.month)}`);
      renderReport();
    } catch (error) {
      showError(error.message);
    } finally {
      document.getElementById('report-loading').classList.add('hidden');
    }
  }

  async function generateDraft() {
    const button = document.getElementById('report-generate');
    setBusy(button, true, 'Generating…');
    try {
      await App.api('/reports/monthly/draft/generate', {
        method: 'POST', body: { propertyId: state.propertyId, month: state.month },
      });
      App.toast('Report draft generated.', 'success');
      await loadReport();
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function ensureDraft() {
    if (state.report.draft) return;
    await App.api('/reports/monthly/draft/generate', {
      method: 'POST', body: { propertyId: state.propertyId, month: state.month },
    });
  }

  async function saveCommentary() {
    const button = document.getElementById('report-save');
    setBusy(button, true, 'Saving…');
    try {
      await ensureDraft();
      const commentary = collectCommentary();
      await App.api('/reports/monthly/draft', {
        method: 'PUT',
        body: {
          propertyId: state.propertyId,
          month: state.month,
          title: document.getElementById('report-title').textContent,
          commentary,
        },
      });
      App.clearDraft(commentaryKey());
      App.toast('Report commentary saved.', 'success');
      await loadReport();
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  async function finaliseReport() {
    if (!App.confirmDialog('Finalise this monthly report? The report snapshot and commentary will be locked.')) return;
    const button = document.getElementById('report-finalise');
    setBusy(button, true, 'Finalising…');
    try {
      await saveCommentary();
      await App.api('/reports/monthly/draft/finalise', {
        method: 'POST', body: { propertyId: state.propertyId, month: state.month },
      });
      App.toast('Monthly report finalised.', 'success');
      await loadReport();
    } catch (error) {
      App.toast(error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  }

  function exportPayload() {
    return {
      contract: state.report.contract,
      contractVersion: state.report.contractVersion,
      exportedBy: 'ProInspect Building Management',
      exportedAt: new Date().toISOString(),
      property: state.report.property,
      month: state.report.month,
      period: state.report.period,
      metrics: state.report.metrics,
      sections: state.report.sections,
      commentary: collectCommentary(),
      draft: state.report.draft,
    };
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportPayload(), null, 2));
      App.toast('AI-ready report JSON copied.', 'success');
    } catch (error) {
      App.toast('Clipboard access was blocked by the browser.', 'error');
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.propertyId}-${state.month}-building-management-report.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function initialise() {
    try {
      state.me = await App.initShell();
      if (!state.me) return;
      state.properties = await App.api('/properties');
      state.propertyId = state.me.propertyScope || (state.properties[0] && state.properties[0].id);
      state.month = new Date().toISOString().slice(0, 7);
      const propertySelect = document.getElementById('report-property');
      propertySelect.innerHTML = App.optionsHtml(state.properties.map((property) => ({ value: property.id, label: property.name })), undefined);
      propertySelect.value = state.propertyId;
      propertySelect.disabled = Boolean(state.me.propertyScope);
      document.getElementById('report-month').value = state.month;
      document.getElementById('report-load').addEventListener('click', loadReport);
      document.getElementById('report-generate').addEventListener('click', generateDraft);
      document.getElementById('report-save').addEventListener('click', saveCommentary);
      document.getElementById('report-finalise').addEventListener('click', finaliseReport);
      document.getElementById('report-copy').addEventListener('click', copyJson);
      document.getElementById('report-download').addEventListener('click', downloadJson);
      document.getElementById('report-print').addEventListener('click', () => window.print());
      propertySelect.addEventListener('change', loadReport);
      document.getElementById('report-month').addEventListener('change', loadReport);
      await loadReport();
    } catch (error) {
      document.getElementById('report-loading').classList.add('hidden');
      showError(error.message || 'The monthly report could not be loaded.');
    }
  }

  initialise();
})();
