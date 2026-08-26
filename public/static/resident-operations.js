// Resident move and access device workflows.
(function () {
  'use strict';

  const App = window.ProInspectBM;
  const root = document.getElementById('resident-operation-page');
  if (!root) return;
  const page = root.dataset.page;
  const state = { me: null, config: null, units: [], propertyId: null, settings: null };

  function unitProperty(unitId) {
    return state.units.find((unit) => unit.id === unitId) || state.units[0] || null;
  }

  function error(message) {
    const host = document.getElementById('resident-operation-error');
    host.textContent = message || '';
    host.classList.toggle('hidden', !message);
  }

  function numberOrUndefined(value) {
    return value === '' || value === undefined || value === null ? undefined : Number(value);
  }

  async function loadSettings(unitId) {
    const unit = unitProperty(unitId);
    if (!unit) return;
    state.propertyId = unit.property_id;
    state.settings = await App.api(`/properties/${encodeURIComponent(state.propertyId)}/operating-settings`);
    if (page === 'moves') renderMoveRules();
  }

  function renderMoveRules() {
    const host = document.getElementById('move-operating-rules');
    const settings = state.settings && state.settings.settings || {};
    const parts = [];
    if (settings.moveNoticeHours) parts.push(`At least ${settings.moveNoticeHours} hours notice is required.`);
    if (settings.moveWeekdaysOnly) parts.push('Bookings are limited to weekdays.');
    if (settings.moveStartTime && settings.moveEndTime) parts.push(`Approved hours are ${settings.moveStartTime}–${settings.moveEndTime}.`);
    if (settings.maximumVehicleHeightMm) parts.push(`Basement vehicle clearance is ${settings.maximumVehicleHeightMm} mm.`);
    if (settings.moveAccessInstructions) parts.push(settings.moveAccessInstructions);
    host.innerHTML = `<div class="font-semibold mb-1"><i class="fa-solid fa-circle-info mr-2"></i>${App.escapeHtml(state.settings.property.name)} requirements</div>
      <div>${App.escapeHtml(parts.join(' '))}</div>`;
  }

  function suggestedMoveDate() {
    const settings = state.settings && state.settings.settings || {};
    const hours = Number(settings.moveNoticeHours || 24);
    const date = new Date(Date.now() + hours * 60 * 60 * 1000 + 60 * 60 * 1000);
    if (settings.moveWeekdaysOnly) {
      while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
    }
    if (settings.moveStartTime) {
      const [hour, minute] = settings.moveStartTime.split(':').map(Number);
      date.setHours(hour, minute, 0, 0);
    }
    return App.localDateTimeInput(date);
  }

  function renderUnits(selectId) {
    const select = document.getElementById(selectId);
    select.innerHTML = App.optionsHtml(state.units.map((unit) => ({
      value: unit.id,
      label: `Unit ${unit.unit_number}${unit.occupancyRole ? ` · ${String(unit.occupancyRole).replace(/_/g, ' ')}` : ''}`,
    })), undefined);
    if (state.units[0]) select.value = state.units[0].id;
    select.addEventListener('change', () => loadSettings(select.value));
  }

  function renderMoveForm() {
    const form = document.getElementById('resident-move-form');
    renderUnits('rm-unit');
    document.getElementById('rm-type').innerHTML = App.optionsHtml(state.config.options.moveTypes, 'Select booking type');
    document.getElementById('rm-name').value = state.me.fullName || '';
    document.getElementById('rm-email').value = state.me.email || '';
    const firstUnit = state.units[0];
    if (firstUnit && firstUnit.occupancyRole) document.getElementById('rm-role').value = firstUnit.occupancyRole;
    document.getElementById('move-acknowledgements').innerHTML = state.config.options.moveAcknowledgements.map((item) => `<label class="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" name="acknowledgements" value="${App.escapeHtml(item.value)}" class="mt-1 rounded" required />
      <span>${App.escapeHtml(item.label)}</span>
    </label>`).join('');
    form.elements.clientSubmissionId.value = App.clientId('move');
    const draftKey = App.draftKey('resident-move', state.propertyId);
    const draft = App.loadDraft(draftKey);
    if (draft) App.fillForm(form, draft.value);
    App.attachAutosave(form, draftKey);
    form.addEventListener('submit', (event) => submitMove(event, draftKey));
  }

  async function submitMove(event, draftKey) {
    event.preventDefault();
    error('');
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const acknowledgements = Array.from(form.querySelectorAll('input[name="acknowledgements"]:checked')).map((input) => input.value);
    if (acknowledgements.length !== state.config.options.moveAcknowledgements.length) {
      error('All building requirements must be acknowledged.');
      return;
    }
    const button = document.getElementById('resident-operation-submit');
    App.setSubmitting(button, true, 'Submitting…');
    try {
      const unit = unitProperty(form.elements.unitId.value);
      const payload = {
        propertyId: unit.property_id,
        unitId: unit.id,
        moveType: form.elements.moveType.value,
        requestedAt: new Date(form.elements.requestedAt.value).toISOString(),
        estimatedDurationMinutes: numberOrUndefined(form.elements.estimatedDurationMinutes.value),
        applicantName: form.elements.applicantName.value,
        applicantRole: form.elements.applicantRole.value,
        applicantPhone: form.elements.applicantPhone.value || undefined,
        applicantEmail: form.elements.applicantEmail.value || undefined,
        removalistName: form.elements.removalistName.value || undefined,
        removalistContact: form.elements.removalistContact.value || undefined,
        vehicleType: form.elements.vehicleType.value || undefined,
        vehicleHeightMm: numberOrUndefined(form.elements.vehicleHeightMm.value),
        vehicleDetails: form.elements.vehicleDetails.value || undefined,
        liftRequired: form.elements.liftRequired.checked,
        liftProtectionRequired: form.elements.liftProtectionRequired.checked,
        loadingAreaRequired: form.elements.loadingAreaRequired.checked,
        liftKeyRequired: form.elements.liftKeyRequired.checked,
        acknowledgements,
        rulesAcknowledged: form.elements.rulesAcknowledged.checked,
        specialRequirements: form.elements.specialRequirements.value || undefined,
        clientSubmissionId: form.elements.clientSubmissionId.value,
      };
      await App.api('/moves', { method: 'POST', body: payload, idempotencyKey: payload.clientSubmissionId });
      App.clearDraft(draftKey);
      App.toast('Move booking submitted for approval.', 'success');
      form.reset();
      form.elements.clientSubmissionId.value = App.clientId('move');
      document.getElementById('rm-unit').value = state.units[0].id;
      document.getElementById('rm-name').value = state.me.fullName || '';
      document.getElementById('rm-email').value = state.me.email || '';
      document.getElementById('rm-datetime').value = suggestedMoveDate();
      await loadList();
    } catch (exception) {
      error(exception.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  function renderAccessForm() {
    const form = document.getElementById('resident-access-form');
    renderUnits('ra-unit');
    document.getElementById('ra-name').value = state.me.fullName || '';
    document.getElementById('ra-email').value = state.me.email || '';
    const firstUnit = state.units[0];
    if (firstUnit && firstUnit.occupancyRole) document.getElementById('ra-role').value = firstUnit.occupancyRole;
    form.elements.clientSubmissionId.value = App.clientId('access-request');
    const role = document.getElementById('ra-role');
    const refreshAuthority = () => document.getElementById('owner-authority-row').classList.toggle('hidden', role.value !== 'tenant');
    role.addEventListener('change', refreshAuthority);
    refreshAuthority();
    const requestType = document.getElementById('ra-request-type');
    requestType.addEventListener('change', () => {
      const mapping = { replacement_fob: 'fob', additional_fob: 'fob', remote: 'remote', swipe: 'swipe', physical_key: 'key' };
      if (mapping[requestType.value]) document.getElementById('ra-device-type').value = mapping[requestType.value];
    });
    const draftKey = App.draftKey('resident-access', state.propertyId);
    const draft = App.loadDraft(draftKey);
    if (draft) App.fillForm(form, draft.value);
    App.attachAutosave(form, draftKey);
    form.addEventListener('submit', (event) => submitAccess(event, draftKey));
  }

  async function submitAccess(event, draftKey) {
    event.preventDefault();
    error('');
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const role = form.elements.requesterRole.value;
    const authorityInput = form.elements.ownerAuthority;
    if (role === 'tenant' && (!authorityInput.files || !authorityInput.files[0])) {
      error('Written owner authority is required for tenant requests.');
      return;
    }
    const button = document.getElementById('resident-operation-submit');
    App.setSubmitting(button, true, 'Submitting…');
    try {
      const unit = unitProperty(form.elements.unitId.value);
      let authority = null;
      if (authorityInput.files && authorityInput.files[0]) authority = await App.upload(authorityInput.files[0], unit.property_id);
      const payload = {
        propertyId: unit.property_id,
        unitId: unit.id,
        requestType: form.elements.requestType.value,
        requesterRole: role,
        applicantName: form.elements.applicantName.value,
        managingAgentName: form.elements.managingAgentName.value || undefined,
        contactPhone: form.elements.contactPhone.value || undefined,
        contactEmail: form.elements.contactEmail.value || undefined,
        deviceTypeRequested: form.elements.deviceTypeRequested.value,
        quantityRequested: Number(form.elements.quantityRequested.value),
        requestReason: form.elements.requestReason.value || undefined,
        ownerAuthorisationR2Key: authority && authority.r2Key,
        requestedCollectionDate: form.elements.requestedCollectionDate.value || undefined,
        clientSubmissionId: form.elements.clientSubmissionId.value,
      };
      await App.api('/access-device-requests', { method: 'POST', body: payload, idempotencyKey: payload.clientSubmissionId });
      App.clearDraft(draftKey);
      App.toast('Access device request submitted.', 'success');
      form.reset();
      form.elements.clientSubmissionId.value = App.clientId('access-request');
      form.elements.unitId.value = state.units[0].id;
      form.elements.applicantName.value = state.me.fullName || '';
      form.elements.contactEmail.value = state.me.email || '';
      await loadList();
    } catch (exception) {
      error(exception.message);
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function loadList() {
    const host = document.getElementById('resident-operation-list');
    try {
      const rows = await App.api(page === 'moves' ? '/moves' : '/access-device-requests');
      if (!rows.length) {
        host.innerHTML = App.emptyState(page === 'moves' ? 'No move bookings submitted.' : 'No access requests submitted.', page === 'moves' ? 'fa-truck' : 'fa-key');
        return;
      }
      host.innerHTML = `<div class="divide-y divide-slate-100">${rows.slice(0, 20).map((row) => page === 'moves' ? `<div class="py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-slate-900">${App.escapeHtml(String(row.move_type || '').replace(/_/g, ' '))}</div>
            <div class="text-xs text-slate-500 mt-1">Unit ${App.escapeHtml(row.unitNumber || '')} · ${App.fmtDateTime(row.requested_at)}</div>
          </div>${App.statusChip(row.status)}
        </div>
        ${row.decline_reason ? `<div class="text-xs text-red-600 mt-2">${App.escapeHtml(row.decline_reason)}</div>` : ''}
      </div>` : `<div class="py-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-slate-900">${App.escapeHtml(String(row.device_type_requested || row.request_type || '').replace(/_/g, ' '))}</div>
            <div class="text-xs text-slate-500 mt-1">Unit ${App.escapeHtml(row.unitNumber || '')} · Qty ${Number(row.quantity_requested || 1)}</div>
            <div class="text-xs text-slate-400 mt-1">${App.fmtDate(row.created_at)}</div>
          </div>${App.statusChip(row.status)}
        </div>
      </div>`).join('')}</div>`;
    } catch (exception) {
      host.innerHTML = `<div class="form-error">${App.escapeHtml(exception.message)}</div>`;
    }
  }

  async function initialise() {
    try {
      state.me = await App.initShell();
      if (!state.me) return;
      const [config, units] = await Promise.all([App.api('/forms/config'), App.api('/me/units')]);
      state.config = config;
      state.units = units || [];
      if (!state.units.length) throw new Error('No current unit is linked to this resident account.');
      await loadSettings(state.units[0].id);
      if (page === 'moves') {
        renderMoveForm();
        document.getElementById('rm-datetime').value = suggestedMoveDate();
      } else {
        renderAccessForm();
      }
      await loadList();
      document.getElementById('resident-operation-loading').classList.add('hidden');
      document.getElementById('resident-operation-content').classList.remove('hidden');
    } catch (exception) {
      document.getElementById('resident-operation-loading').innerHTML = `<div class="form-error">${App.escapeHtml(exception.message || 'The form could not be loaded.')}</div>`;
    }
  }

  initialise();
})();
