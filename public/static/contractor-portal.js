// Contractor attendance and assigned work portal.
(function () {
  'use strict';

  const App = window.ProInspectBM;
  const root = document.getElementById('contractor-page');
  if (!root) return;
  const page = root.dataset.page;
  const state = { me: null, contractor: null, config: null, propertyId: null, attendance: [], workOrders: [] };

  function showError(id, message) {
    const host = document.getElementById(id);
    if (!host) return;
    host.textContent = message || '';
    host.classList.toggle('hidden', !message);
  }

  function propertyById(id) {
    return (state.contractor.properties || []).find((property) => property.id === id) || null;
  }

  async function loadRules(propertyId) {
    try {
      const data = await App.api(`/properties/${encodeURIComponent(propertyId)}/operating-settings`);
      const text = data.settings.contractorSignInInstructions || 'All contractors must sign in and sign out. Any key or access device must be returned before leaving.';
      document.getElementById('contractor-rules').innerHTML = `<div class="font-semibold mb-1"><i class="fa-solid fa-circle-info mr-2"></i>${App.escapeHtml(data.property.name)} site access</div><div>${App.escapeHtml(text)}</div>`;
    } catch (error) {
      document.getElementById('contractor-rules').textContent = 'All contractors must sign in and sign out before leaving.';
    }
  }

  async function loadAttendance() {
    const host = document.getElementById('contractor-attendance-list');
    try {
      state.attendance = await App.api('/attendance');
      if (!state.attendance.length) {
        host.innerHTML = App.emptyState('No attendance records yet.', 'fa-helmet-safety');
        return;
      }
      host.innerHTML = `<div class="divide-y divide-slate-100">${state.attendance.slice(0, 30).map((row) => `<div class="py-3" data-attendance-id="${App.escapeHtml(row.id)}">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-slate-900">${App.escapeHtml(row.purpose || 'Site attendance')}</div>
            <div class="text-xs text-slate-500 mt-1">${App.fmtDateTime(row.sign_in_at)}${row.area_accessed ? ` · ${App.escapeHtml(row.area_accessed)}` : ''}</div>
            ${row.sign_out_at ? `<div class="text-xs text-slate-400 mt-1">Signed out ${App.fmtDateTime(row.sign_out_at)}</div>` : ''}
          </div>
          <div class="flex flex-col items-end gap-2 shrink-0">
            ${App.statusChip(row.status)}
            ${['on_site', 'pending_key_return'].includes(row.status) ? '<button type="button" class="attendance-signout btn-primary text-xs">Sign out</button>' : ''}
          </div>
        </div>
        ${row.status === 'pending_key_return' ? '<div class="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">Your work record is saved. Building Management must record the controlled key return before the attendance closes.</div>' : ''}
      </div>`).join('')}</div>`;
      host.querySelectorAll('.attendance-signout').forEach((button) => {
        button.addEventListener('click', () => {
          const id = button.closest('[data-attendance-id]').dataset.attendanceId;
          openSignout(id);
        });
      });
    } catch (error) {
      host.innerHTML = `<div class="form-error">${App.escapeHtml(error.message)}</div>`;
    }
  }

  function openSignout(id) {
    const row = state.attendance.find((item) => item.id === id);
    if (!row) return;
    const modal = document.getElementById('contractor-signout-modal');
    const form = document.getElementById('contractor-signout-form');
    form.reset();
    form.elements.attendanceId.value = id;
    form.elements.clientSubmissionId.value = App.clientId('contractor-signout');
    form.elements.areaLeftClean.checked = true;
    document.getElementById('signout-summary').textContent = row.purpose || 'Site attendance';
    showError('signout-error', '');
    modal.classList.remove('hidden');
  }

  function closeSignout() {
    document.getElementById('contractor-signout-modal').classList.add('hidden');
  }

  async function submitSignin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    showError('contractor-error', '');
    if (!form.reportValidity()) return;
    const button = document.getElementById('contractor-signin-submit');
    App.setSubmitting(button, true, 'Signing in…');
    try {
      const workOrderId = new URL(window.location.href).searchParams.get('workOrderId') || undefined;
      const payload = {
        propertyId: form.elements.propertyId.value,
        workOrderId,
        purpose: form.elements.purpose.value,
        visitorName: form.elements.visitorName.value,
        visitorMobile: form.elements.visitorMobile.value || undefined,
        visitorEmail: form.elements.visitorEmail.value || undefined,
        expectedDurationMinutes: form.elements.expectedDurationMinutes.value ? Number(form.elements.expectedDurationMinutes.value) : undefined,
        areaAccessed: form.elements.areaAccessed.value || undefined,
        accessItemType: form.elements.accessItemType.value || 'none',
        accessItemIdentifier: form.elements.accessItemIdentifier.value || undefined,
        vehicleRegistration: form.elements.vehicleRegistration.value || undefined,
        parkingLocation: form.elements.parkingLocation.value || undefined,
        siteRulesAcknowledged: form.elements.siteRulesAcknowledged.checked,
        clientSubmissionId: form.elements.clientSubmissionId.value,
      };
      await App.api('/attendance/sign-in', { method: 'POST', body: payload, idempotencyKey: payload.clientSubmissionId });
      App.toast('You are signed in.', 'success');
      form.reset();
      form.elements.clientSubmissionId.value = App.clientId('contractor-signin');
      form.elements.propertyId.value = state.propertyId;
      form.elements.visitorName.value = state.me.fullName || state.contractor.contact_name || '';
      form.elements.visitorMobile.value = state.contractor.contact_phone || '';
      form.elements.visitorEmail.value = state.me.email || state.contractor.contact_email || '';
      history.replaceState({}, '', '/contractor');
      await loadAttendance();
    } catch (error) {
      showError('contractor-error', error.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function submitSignout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    showError('signout-error', '');
    if (!form.reportValidity()) return;
    if (form.elements.workCompleted.checked && !form.elements.workDescription.value.trim()) {
      showError('signout-error', 'Describe the work performed when marking the visit complete.');
      return;
    }
    const attendanceId = form.elements.attendanceId.value;
    const row = state.attendance.find((item) => item.id === attendanceId);
    const button = document.getElementById('signout-submit');
    App.setSubmitting(button, true, 'Signing out…');
    try {
      let report = null;
      if (form.elements.serviceReport.files && form.elements.serviceReport.files[0]) {
        report = await App.upload(form.elements.serviceReport.files[0], row.property_id);
      }
      const payload = {
        workCompleted: form.elements.workCompleted.checked,
        workDescription: form.elements.workDescription.value || undefined,
        additionalDefects: form.elements.additionalDefects.value || undefined,
        furtherAttendanceRequired: form.elements.furtherAttendanceRequired.checked,
        quoteOrReportToFollow: form.elements.quoteOrReportToFollow.checked,
        areaLeftClean: form.elements.areaLeftClean.checked,
        signoutNotes: form.elements.signoutNotes.value || undefined,
        serviceReportR2Key: report && report.r2Key,
        clientSubmissionId: form.elements.clientSubmissionId.value,
      };
      const response = await App.api(`/attendance/${encodeURIComponent(attendanceId)}/sign-out`, {
        method: 'POST', body: payload, idempotencyKey: payload.clientSubmissionId,
      });
      closeSignout();
      App.toast(response.keyReturnRequired ? 'Work record saved. Return the key to Building Management.' : 'Signed out successfully.', response.keyReturnRequired ? 'warning' : 'success');
      await loadAttendance();
    } catch (error) {
      showError('signout-error', error.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function initialiseAttendance() {
    const properties = state.contractor.properties && state.contractor.properties.length
      ? state.contractor.properties
      : state.me.propertyScope
        ? [{ id: state.me.propertyScope, name: state.me.propertyScope }]
        : [];
    if (!properties.length) throw new Error('No approved property is linked to this contractor account.');
    state.contractor.properties = properties;
    state.propertyId = state.me.propertyScope || properties[0].id;
    const form = document.getElementById('contractor-signin-form');
    form.elements.clientSubmissionId.value = App.clientId('contractor-signin');
    document.getElementById('contractor-company').textContent = state.contractor.company_name || 'Contractor';
    document.getElementById('ci-property').innerHTML = App.optionsHtml(properties.map((property) => ({ value: property.id, label: property.name })), undefined);
    document.getElementById('ci-property').value = state.propertyId;
    document.getElementById('ci-access-type').innerHTML = App.optionsHtml(state.config.options.accessItemTypes, undefined);
    document.getElementById('ci-name').value = state.me.fullName || state.contractor.contact_name || '';
    document.getElementById('ci-mobile').value = state.contractor.contact_phone || '';
    document.getElementById('ci-email').value = state.me.email || state.contractor.contact_email || '';
    const workOrderId = new URL(window.location.href).searchParams.get('workOrderId');
    if (workOrderId) {
      try {
        const workOrder = await App.api('/work-orders/' + encodeURIComponent(workOrderId));
        form.elements.purpose.value = workOrder.scope || '';
        form.elements.areaAccessed.value = workOrder.location_id || '';
      } catch (error) {
        App.toast(error.message, 'error');
      }
    }
    document.getElementById('ci-property').addEventListener('change', (event) => {
      state.propertyId = event.target.value;
      loadRules(state.propertyId);
    });
    form.addEventListener('submit', submitSignin);
    document.getElementById('signout-close').addEventListener('click', closeSignout);
    document.getElementById('contractor-signout-form').addEventListener('submit', submitSignout);
    await Promise.all([loadRules(state.propertyId), loadAttendance()]);
    document.getElementById('contractor-loading').classList.add('hidden');
    document.getElementById('contractor-content').classList.remove('hidden');
  }

  async function loadWork() {
    const host = document.getElementById('contractor-work-list');
    try {
      state.workOrders = await App.api('/work-orders');
      if (!state.workOrders.length) {
        host.innerHTML = `<div class="card p-5">${App.emptyState('No assigned work orders.', 'fa-file-invoice')}</div>`;
      } else {
        host.innerHTML = state.workOrders.map((row) => `<article class="card p-5" data-work-id="${App.escapeHtml(row.id)}">
          <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-400">Work order</div>
              <h2 class="font-semibold text-slate-900 mt-1">${App.escapeHtml(row.scope)}</h2>
              <p class="text-sm text-slate-500 mt-2">${[row.locationName, row.scheduled_at ? App.fmtDateTime(row.scheduled_at) : null].filter(Boolean).map(App.escapeHtml).join(' · ')}</p>
              ${row.access_needs ? `<p class="text-xs text-slate-500 mt-2"><strong>Access:</strong> ${App.escapeHtml(row.access_needs)}</p>` : ''}
              ${row.resident_impact_notes ? `<p class="text-xs text-slate-500 mt-1"><strong>Resident impact:</strong> ${App.escapeHtml(row.resident_impact_notes)}</p>` : ''}
            </div>
            <div class="flex flex-col items-start sm:items-end gap-2 shrink-0">
              ${App.statusChip(row.status)}
              ${row.status === 'scheduled' ? `<a href="/contractor?workOrderId=${encodeURIComponent(row.id)}" class="btn-primary text-xs">Check in for work</a>` : ''}
              ${row.status === 'in_progress' ? '<button type="button" class="complete-work btn-primary text-xs">Submit completion</button>' : ''}
            </div>
          </div>
          ${row.work_performed ? `<div class="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><strong>Work performed:</strong> ${App.escapeHtml(row.work_performed)}</div>` : ''}
        </article>`).join('');
        host.querySelectorAll('.complete-work').forEach((button) => {
          button.addEventListener('click', () => openWorkComplete(button.closest('[data-work-id]').dataset.workId));
        });
      }
      document.getElementById('contractor-loading').classList.add('hidden');
      host.classList.remove('hidden');
    } catch (error) {
      document.getElementById('contractor-loading').innerHTML = `<div class="form-error">${App.escapeHtml(error.message)}</div>`;
    }
  }

  function openWorkComplete(id) {
    const work = state.workOrders.find((item) => item.id === id);
    if (!work) return;
    const form = document.getElementById('work-complete-form');
    form.reset();
    form.elements.workOrderId.value = id;
    document.getElementById('work-complete-summary').textContent = work.scope;
    showError('work-complete-error', '');
    document.getElementById('work-complete-modal').classList.remove('hidden');
  }

  function closeWorkComplete() {
    document.getElementById('work-complete-modal').classList.add('hidden');
  }

  async function submitWorkComplete(event) {
    event.preventDefault();
    const form = event.currentTarget;
    showError('work-complete-error', '');
    if (!form.reportValidity()) return;
    const workOrderId = form.elements.workOrderId.value;
    const work = state.workOrders.find((item) => item.id === workOrderId);
    const button = document.getElementById('work-complete-submit');
    App.setSubmitting(button, true, 'Submitting…');
    try {
      let report = null;
      if (form.elements.serviceReport.files && form.elements.serviceReport.files[0]) {
        report = await App.upload(form.elements.serviceReport.files[0], work.property_id);
      }
      await App.api(`/work-orders/${encodeURIComponent(workOrderId)}/complete`, {
        method: 'POST',
        body: {
          findings: form.elements.findings.value || undefined,
          workPerformed: form.elements.workPerformed.value,
          recommendations: form.elements.recommendations.value || undefined,
          serviceReportR2Key: report && report.r2Key,
        },
      });
      closeWorkComplete();
      App.toast('Work completion submitted for Building Manager verification.', 'success');
      await loadWork();
    } catch (error) {
      showError('work-complete-error', error.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function initialise() {
    try {
      state.me = await App.initShell();
      if (!state.me) return;
      const [contractor, config] = await Promise.all([App.api('/my-contractor'), App.api('/forms/config')]);
      if (!contractor) throw new Error('No active contractor record is linked to this login.');
      state.contractor = contractor;
      state.config = config;
      if (page === 'attendance') await initialiseAttendance();
      else {
        document.getElementById('work-complete-close').addEventListener('click', closeWorkComplete);
        document.getElementById('work-complete-form').addEventListener('submit', submitWorkComplete);
        await loadWork();
      }
    } catch (error) {
      document.getElementById('contractor-loading').innerHTML = `<div class="form-error">${App.escapeHtml(error.message || 'The contractor portal could not be loaded.')}</div>`;
    }
  }

  initialise();
})();
