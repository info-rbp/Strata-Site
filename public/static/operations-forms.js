// Mobile-first operational forms for ProInspect Building Management.
(function () {
  'use strict';

  const App = window.ProInspectBM;
  const state = {
    me: null,
    config: null,
    propertyOptions: [],
    options: null,
    propertyId: null,
    activeFormType: null,
  };

  const FORM_UI = {
    daily_activity: { icon: 'fa-pen-to-square' },
    maintenance_defect: { icon: 'fa-screwdriver-wrench' },
    waste_activity: { icon: 'fa-recycle' },
    incident: { icon: 'fa-shield-halved' },
    bylaw_observation: { icon: 'fa-gavel' },
    resident_induction: { icon: 'fa-person-circle-check' },
  };

  const endpointByForm = {
    daily_activity: '/activities',
    maintenance_defect: '/defects',
    waste_activity: '/waste-events',
    incident: '/incidents',
    bylaw_observation: '/bylaw-observations',
    resident_induction: '/resident-onboarding',
  };

  const field = {
    text(name, label, options) {
      options = options || {};
      return `<div class="${options.wrapClass || ''}">
        <label class="field-label ${options.required ? 'field-required' : ''}" for="field-${name}">${App.escapeHtml(label)}</label>
        <input class="field-input" id="field-${name}" name="${name}" type="${options.type || 'text'}"
          ${options.placeholder ? `placeholder="${App.escapeHtml(options.placeholder)}"` : ''}
          ${options.value !== undefined ? `value="${App.escapeHtml(options.value)}"` : ''}
          ${options.min !== undefined ? `min="${options.min}"` : ''}
          ${options.max !== undefined ? `max="${options.max}"` : ''}
          ${options.step !== undefined ? `step="${options.step}"` : ''}
          ${options.required ? 'required' : ''} ${options.autocomplete ? `autocomplete="${options.autocomplete}"` : ''} />
        ${options.hint ? `<span class="field-hint">${App.escapeHtml(options.hint)}</span>` : ''}
      </div>`;
    },
    textarea(name, label, options) {
      options = options || {};
      return `<div class="${options.wrapClass || ''}">
        <label class="field-label ${options.required ? 'field-required' : ''}" for="field-${name}">${App.escapeHtml(label)}</label>
        <textarea class="field-input" id="field-${name}" name="${name}" rows="${options.rows || 3}"
          ${options.placeholder ? `placeholder="${App.escapeHtml(options.placeholder)}"` : ''}
          ${options.required ? 'required' : ''}></textarea>
        ${options.hint ? `<span class="field-hint">${App.escapeHtml(options.hint)}</span>` : ''}
      </div>`;
    },
    select(name, label, optionsList, options) {
      options = options || {};
      return `<div class="${options.wrapClass || ''}">
        <label class="field-label ${options.required ? 'field-required' : ''}" for="field-${name}">${App.escapeHtml(label)}</label>
        <select class="field-input" id="field-${name}" name="${name}" ${options.required ? 'required' : ''}>
          ${App.optionsHtml(optionsList || [], options.placeholder === undefined ? 'Select…' : options.placeholder)}
        </select>
        ${options.hint ? `<span class="field-hint">${App.escapeHtml(options.hint)}</span>` : ''}
      </div>`;
    },
    checkbox(name, label, options) {
      options = options || {};
      return `<label class="flex items-start gap-2.5 text-sm text-slate-700 ${options.wrapClass || ''}">
        <input type="checkbox" name="${name}" id="field-${name}" class="mt-1 rounded border-slate-300" ${options.checked ? 'checked' : ''} />
        <span>${App.escapeHtml(label)}${options.hint ? `<span class="block text-xs text-slate-500 mt-0.5">${App.escapeHtml(options.hint)}</span>` : ''}</span>
      </label>`;
    },
    file(name, label, options) {
      options = options || {};
      return `<div class="${options.wrapClass || ''}">
        <label class="field-label" for="field-${name}">${App.escapeHtml(label)}</label>
        <input class="field-input" id="field-${name}" name="${name}" type="file"
          accept="${options.accept || 'image/*,application/pdf'}" ${options.capture ? `capture="${options.capture}"` : ''} />
        <span class="field-hint">${App.escapeHtml(options.hint || 'Optional. Photos are stored securely with the record.')}</span>
      </div>`;
    },
  };

  function section(title, body, extraClass) {
    return `<section class="form-section ${extraClass || ''}">
      <h2 class="form-section-title">${App.escapeHtml(title)}</h2>${body}
    </section>`;
  }

  function optionsFor(key) {
    return state.config && state.config.options ? state.config.options[key] || [] : [];
  }

  function propertyLocations() {
    return (state.options && state.options.locations || []).map((item) => ({
      value: item.id,
      label: [item.name, item.levelLabel].filter(Boolean).join(' · '),
    }));
  }

  function propertyBuildings() {
    return (state.options && state.options.buildings || []).map((item) => ({ value: item.id, label: item.name }));
  }

  function propertyUnits() {
    return (state.options && state.options.units || []).map((item) => ({
      value: item.id,
      label: `Unit ${item.unitNumber}${item.levelLabel ? ` · ${item.levelLabel}` : ''}`,
    }));
  }

  function propertyContractors() {
    return (state.options && state.options.contractors || []).map((item) => ({
      value: item.id,
      label: `${item.companyName}${item.tradeCategory ? ` · ${item.tradeCategory}` : ''}`,
    }));
  }

  function baseHidden(clientSubmissionId) {
    return `<input type="hidden" name="clientSubmissionId" value="${App.escapeHtml(clientSubmissionId)}" />`;
  }

  function renderDailyActivity(clientSubmissionId) {
    return `<form id="operational-form" data-form-type="daily_activity" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('What happened', `<div class="form-grid two">
        ${field.text('occurredAt', 'Date and time', { type: 'datetime-local', value: App.localDateTimeInput(), required: true })}
        ${field.select('category', 'Activity category', optionsFor('activityCategories'), { required: true })}
        ${field.select('buildingId', 'Building / core', propertyBuildings(), { placeholder: 'Optional' })}
        ${field.select('locationId', 'Known location', propertyLocations(), { placeholder: 'Optional' })}
        ${field.text('levelLabel', 'Level', { placeholder: 'e.g. Level 2, Basement, Roof' })}
        ${field.text('specificLocation', 'Specific location', { placeholder: 'e.g. Core 1 lift lobby' })}
      </div>
      <div class="form-grid mt-3">
        ${field.textarea('summary', 'Activity undertaken', { rows: 3, required: true, placeholder: 'One clear sentence is usually enough.' })}
        ${field.textarea('actionTaken', 'Action taken', { rows: 2, placeholder: 'What you did, who you contacted, or what was completed.' })}
      </div>`)}
      ${section('Status and effort', `<div class="form-grid three">
        ${field.select('priority', 'Priority', optionsFor('priorities'), { required: true, placeholder: undefined })}
        ${field.select('status', 'Current status', optionsFor('activityStatuses'), { required: true, placeholder: undefined })}
        ${field.text('minutesSpent', 'Minutes spent', { type: 'number', min: 0, max: 1440, placeholder: 'Optional' })}
      </div>
      <div class="mt-4">${field.checkbox('followUpRequired', 'Follow-up is required')}</div>
      <div id="follow-up-fields" class="hidden form-grid two mt-3">
        ${field.text('followUpDate', 'Follow-up date', { type: 'date' })}
        ${field.select('responsibleParty', 'Responsible party', optionsFor('responsibleParties'), { placeholder: 'Select responsible party' })}
      </div>`)}
      ${section('Evidence and notes', `<div class="form-grid two">
        ${field.file('evidence', 'Photo or document', { accept: 'image/*,application/pdf', capture: 'environment' })}
        ${field.textarea('additionalNotes', 'Additional notes', { rows: 3 })}
      </div>`)}
      ${formFooter('Save activity')}
    </form>`;
  }

  function renderDefect(clientSubmissionId) {
    return `<form id="operational-form" data-form-type="maintenance_defect" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('Identify the issue', `<div class="form-grid two">
        ${field.select('category', 'Defect category', optionsFor('defectCategories'), { required: true })}
        ${field.select('locationId', 'Known location', propertyLocations(), { placeholder: 'Optional' })}
        ${field.select('unitId', 'Resident unit involved', propertyUnits(), { placeholder: 'None / unknown' })}
        ${field.text('specificLocation', 'Specific location', { placeholder: 'e.g. above bay 110, Core 2 roof' })}
      </div>
      <div class="form-grid mt-3">
        ${field.textarea('description', 'Issue description', { rows: 4, required: true, placeholder: 'What failed, what you observed, and the current condition.' })}
      </div>`)}
      ${section('Risk and immediate response', `<div class="form-grid two">
        ${field.select('riskLevel', 'Risk level', optionsFor('riskLevels'), { required: true, placeholder: undefined })}
        ${field.select('responsibility', 'Likely responsibility', optionsFor('responsibility'), { required: true, placeholder: undefined })}
      </div>
      <div class="form-grid mt-3">
        ${field.textarea('immediateResponse', 'Immediate action / make-safe response', { rows: 3, placeholder: 'Isolation, signage, cleanup, notification or temporary control.' })}
      </div>`)}
      ${section('Required follow-up', `<div class="grid gap-3">
        ${field.checkbox('contractorRequired', 'A contractor is required')}
        <div id="contractor-fields" class="hidden">${field.select('assignedContractorId', 'Preferred / attending contractor', propertyContractors(), { placeholder: 'Not selected yet' })}</div>
        ${field.checkbox('strataApprovalRequired', 'Strata approval is required')}
        ${field.checkbox('quoteRequired', 'A quote is required')}
        <div class="form-grid two">
          ${field.text('dueDate', 'Target completion date', { type: 'date' })}
          ${field.text('nextFollowUpDate', 'Next follow-up date', { type: 'date' })}
        </div>
      </div>`)}
      ${section('Evidence', `<div class="form-grid two">
        ${field.file('evidence', 'Photo or document', { accept: 'image/*,application/pdf', capture: 'environment' })}
        ${field.text('evidenceCaption', 'Evidence note', { placeholder: 'What the photo shows' })}
      </div>`)}
      ${formFooter('Create defect record')}
    </form>`;
  }

  function renderWaste(clientSubmissionId) {
    return `<form id="operational-form" data-form-type="waste_activity" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('Waste activity', `<div class="form-grid two">
        ${field.text('occurredAt', 'Date and time', { type: 'datetime-local', value: App.localDateTimeInput(), required: true })}
        ${field.select('wasteType', 'Waste type', optionsFor('wasteTypes'), { required: true })}
        ${field.select('activity', 'Activity', optionsFor('wasteActivities'), { required: true })}
        ${field.select('locationId', 'Location', propertyLocations(), { placeholder: 'Optional' })}
        ${field.text('quantity', 'Quantity / bins', { type: 'number', min: 0, max: 1000, placeholder: 'Optional' })}
        ${field.text('minutesSpent', 'Minutes spent', { type: 'number', min: 0, max: 1440, placeholder: 'Optional' })}
        ${field.text('conditionStatus', 'Condition', { placeholder: 'e.g. clean, 2.5 bins full, chute operating' })}
      </div>`)}
      ${section('Exception or follow-up', `<div class="grid gap-3">
        ${field.checkbox('issueIdentified', 'An issue or breach was identified')}
        <div id="waste-issue-fields" class="hidden form-grid two">
          ${field.select('exceptionCategory', 'Issue type', optionsFor('wasteExceptions'), { placeholder: 'Select issue' })}
          ${field.select('responsibleUnitId', 'Unit responsible, if known', propertyUnits(), { placeholder: 'Unknown / not applicable' })}
          ${field.textarea('notes', 'Issue details', { rows: 3, wrapClass: 'sm:col-span-2' })}
          ${field.textarea('actionTaken', 'Action taken', { rows: 3, wrapClass: 'sm:col-span-2' })}
        </div>
        ${field.checkbox('collectionRequired', 'A collection or external follow-up is required')}
        <div id="collection-fields" class="hidden">${field.text('collectionArrangedDate', 'Collection / follow-up date', { type: 'date' })}</div>
      </div>`)}
      ${section('Evidence', field.file('evidence', 'Photo', { accept: 'image/*', capture: 'environment' }))}
      ${formFooter('Save waste log')}
    </form>`;
  }

  function renderIncident(clientSubmissionId) {
    return `<form id="operational-form" data-form-type="incident" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('Incident details', `<div class="form-grid two">
        ${field.text('incidentAt', 'Date and time', { type: 'datetime-local', value: App.localDateTimeInput(), required: true })}
        ${field.select('category', 'Incident type', optionsFor('incidentCategories'), { required: true })}
        ${field.select('severity', 'Severity', [{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High / urgent escalation' }], { required: true, placeholder: undefined })}
        ${field.select('locationId', 'Known location', propertyLocations(), { placeholder: 'Optional' })}
        ${field.select('unitId', 'Unit involved', propertyUnits(), { placeholder: 'None / unknown' })}
        ${field.text('personInvolved', 'Person / vehicle involved', { placeholder: 'Optional' })}
      </div>
      <div class="form-grid mt-3">
        ${field.textarea('description', 'What happened', { rows: 4, required: true })}
        ${field.text('witnesses', 'Witnesses', { placeholder: 'Names or contact details, if known' })}
      </div>`)}
      ${section('Response', `<div class="form-grid">
        ${field.textarea('immediateRisk', 'Immediate risk', { rows: 2 })}
        ${field.textarea('actionsTaken', 'Immediate action taken', { rows: 3 })}
        ${field.textarea('damageNotes', 'Damage observed', { rows: 2 })}
        ${field.textarea('temporaryRepairNotes', 'Temporary repair / control', { rows: 2, hint: 'A permanent-remediation defect will be created automatically.' })}
        ${field.text('emergencyServiceContractor', 'Emergency service / contractor contacted', { placeholder: 'Optional' })}
      </div>`)}
      ${section('CCTV and external reference', `<div class="grid gap-3">
        ${field.checkbox('cctvAvailable', 'CCTV footage may be available')}
        <div id="cctv-fields" class="hidden form-grid two">
          ${field.checkbox('cctvReviewed', 'CCTV has been reviewed')}
          ${field.text('cctvTimestamp', 'Relevant CCTV time', { placeholder: 'e.g. 26 Aug 2026, 05:52' })}
        </div>
        ${field.checkbox('policeOrSecurityContacted', 'Police or security was contacted')}
        <div id="external-reference-fields" class="hidden">${field.text('externalReference', 'Police / security reference', { placeholder: 'Incident or job number' })}</div>
      </div>`)}
      ${section('Escalation and follow-up', `<div class="grid gap-3">
        ${field.checkbox('strataNotified', 'Strata Manager has been notified')}
        <div id="strata-notified-fields" class="hidden">${field.text('strataNotifiedAt', 'Notification time', { type: 'datetime-local', value: App.localDateTimeInput() })}</div>
        ${field.checkbox('followUpRequired', 'Follow-up is required')}
        <div id="incident-follow-up-fields" class="hidden">${field.text('followUpDate', 'Follow-up date', { type: 'date' })}</div>
        ${field.textarea('resolution', 'Resolution / current position', { rows: 2 })}
      </div>`)}
      ${section('Evidence', field.file('evidence', 'Photo, document or CCTV still', { accept: 'image/*,application/pdf', capture: 'environment' }))}
      ${formFooter('Save incident')}
    </form>`;
  }

  function renderBylaw(clientSubmissionId) {
    return `<form id="operational-form" data-form-type="bylaw_observation" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('Objective observation', `<div class="form-grid two">
        ${field.text('occurredAt', 'Date and time', { type: 'datetime-local', value: App.localDateTimeInput(), required: true })}
        ${field.select('category', 'Category', optionsFor('bylawCategories'), { required: true })}
        ${field.select('locationId', 'Known location', propertyLocations(), { placeholder: 'Optional' })}
        ${field.select('unitId', 'Unit involved, if known', propertyUnits(), { placeholder: 'Unknown / not applicable' })}
      </div>
      <div class="form-grid mt-3">
        ${field.textarea('observation', 'What was observed', { rows: 4, required: true, hint: 'Record facts rather than deciding whether a formal breach occurred.' })}
        ${field.textarea('actionTaken', 'Immediate operational action', { rows: 2, placeholder: 'e.g. item made safe, resident spoken to, area photographed' })}
        ${field.text('followUpDate', 'Suggested follow-up date', { type: 'date' })}
      </div>`)}
      ${section('Evidence', field.file('evidence', 'Photo', { accept: 'image/*', capture: 'environment' }))}
      ${formFooter('Save observation')}
    </form>`;
  }

  function renderInduction(clientSubmissionId) {
    const moduleHtml = (optionsFor('inductionModules') || []).map((item) => `<label class="flex items-start gap-2 text-sm text-slate-700 py-1">
      <input class="mt-1 rounded" type="checkbox" name="modulesAcknowledged" value="${App.escapeHtml(item.value)}" />
      <span>${App.escapeHtml(item.label)}</span>
    </label>`).join('');
    return `<form id="operational-form" data-form-type="resident_induction" novalidate>
      ${baseHidden(clientSubmissionId)}
      ${section('Resident and unit', `<div class="form-grid two">
        ${field.select('unitId', 'Unit', propertyUnits(), { required: true })}
        ${field.text('residentName', 'Resident name', { required: true, autocomplete: 'name' })}
        ${field.select('residentRole', 'Resident type', [
          { value: 'owner', label: 'Owner' }, { value: 'tenant', label: 'Tenant' }, { value: 'authorised_agent', label: 'Authorised Agent' },
        ], { required: true })}
        ${field.text('moveInDate', 'Move-in date', { type: 'date', value: App.localDateInput() })}
      </div>`)}
      ${section('Induction checklist', `<div class="grid sm:grid-cols-2 gap-x-6 gap-y-1">${moduleHtml}</div>
        <div class="mt-4 rounded-lg bg-blue-50 p-3">${field.checkbox('rulesAcknowledged', 'Resident acknowledges the building rules and information provided')}</div>`)}
      ${section('Questions and completion', `<div class="form-grid">
        ${field.textarea('questionsRaised', 'Questions raised', { rows: 2 })}
        ${field.textarea('outstandingMatters', 'Outstanding matters / follow-up', { rows: 2 })}
        ${field.text('acknowledgementName', 'Acknowledgement name', { placeholder: 'Resident name confirming completion' })}
        ${field.textarea('bmNotes', 'Building Manager notes', { rows: 2 })}
        ${field.checkbox('completed', 'Mark induction complete', { hint: 'All checklist items and the rules acknowledgement must be selected.' })}
      </div>`)}
      ${formFooter('Save induction')}
    </form>`;
  }

  function formFooter(label) {
    return `<div id="form-message" class="hidden mt-3" role="alert"></div>
      <div class="form-actions">
        <button type="button" class="btn-secondary" id="clear-form">Clear</button>
        <button type="submit" class="btn-primary" id="submit-form"><i class="fa-solid fa-floppy-disk"></i>${App.escapeHtml(label)}</button>
      </div>`;
  }

  const renderers = {
    daily_activity: renderDailyActivity,
    maintenance_defect: renderDefect,
    waste_activity: renderWaste,
    incident: renderIncident,
    bylaw_observation: renderBylaw,
    resident_induction: renderInduction,
  };

  function definition(formType) {
    return (state.config.definitions || []).find((item) => item.type === formType) || {
      title: formType.replace(/_/g, ' '), description: '', expectedCompletionSeconds: 60,
    };
  }

  function showHub() {
    state.activeFormType = null;
    document.getElementById('form-workspace').classList.add('hidden');
    document.getElementById('forms-hub').classList.remove('hidden');
    const url = new URL(window.location.href);
    url.searchParams.delete('form');
    history.replaceState({}, '', url);
    loadRecentSubmissions();
  }

  function openForm(formType) {
    if (!renderers[formType]) return;
    state.activeFormType = formType;
    const meta = definition(formType);
    document.getElementById('forms-hub').classList.add('hidden');
    document.getElementById('form-workspace').classList.remove('hidden');
    document.getElementById('active-form-title').textContent = meta.title;
    document.getElementById('active-form-description').textContent = meta.description;
    document.getElementById('active-form-duration').textContent = `~${Math.max(1, Math.round((meta.expectedCompletionSeconds || 60) / 60))} min`;
    const host = document.getElementById('active-form-host');
    const clientSubmissionId = App.clientId(formType);
    host.innerHTML = renderers[formType](clientSubmissionId);
    bindActiveForm();
    const url = new URL(window.location.href);
    url.searchParams.set('form', formType);
    history.replaceState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggle(selector, show) {
    const element = document.querySelector(selector);
    if (element) element.classList.toggle('hidden', !show);
  }

  function bindConditionalFields(form) {
    const mappings = [
      ['followUpRequired', '#follow-up-fields'],
      ['contractorRequired', '#contractor-fields'],
      ['issueIdentified', '#waste-issue-fields'],
      ['collectionRequired', '#collection-fields'],
      ['cctvAvailable', '#cctv-fields'],
      ['policeOrSecurityContacted', '#external-reference-fields'],
      ['strataNotified', '#strata-notified-fields'],
    ];
    if (state.activeFormType === 'incident') mappings.push(['followUpRequired', '#incident-follow-up-fields']);
    mappings.forEach(([name, selector]) => {
      const input = form.elements[name];
      if (!input) return;
      const refresh = () => toggle(selector, input.checked);
      input.addEventListener('change', refresh);
      refresh();
    });
  }

  function bindActiveForm() {
    const form = document.getElementById('operational-form');
    if (!form) return;
    const draftKey = App.draftKey(state.activeFormType, state.propertyId);
    const draft = App.loadDraft(draftKey);
    if (draft) {
      App.fillForm(form, draft.value);
      const indicator = document.getElementById('draft-indicator');
      indicator.textContent = `Draft restored · ${App.fmtDateTime(draft.savedAt)}`;
    } else {
      document.getElementById('draft-indicator').textContent = 'Draft saves automatically on this device';
    }
    bindConditionalFields(form);
    App.attachAutosave(form, draftKey, {
      onSave: () => { document.getElementById('draft-indicator').textContent = 'Draft saved'; },
    });
    form.addEventListener('submit', (event) => submitForm(event, draftKey));
    document.getElementById('clear-form').addEventListener('click', () => {
      if (!App.confirmDialog('Clear this form and its saved draft?')) return;
      App.clearDraft(draftKey);
      openForm(state.activeFormType);
    });
  }

  function toIso(value) {
    return value ? new Date(value).toISOString() : undefined;
  }

  function numberOrUndefined(value) {
    return value === '' || value === undefined || value === null ? undefined : Number(value);
  }

  async function uploadEvidence(form) {
    const input = form.querySelector('input[type="file"]');
    const file = input && input.files && input.files[0];
    if (!file) return null;
    return App.upload(file, state.propertyId);
  }

  function checked(form, name) {
    const input = form.elements[name];
    return Boolean(input && input.checked);
  }

  function value(form, name) {
    const input = form.elements[name];
    return input && input.value ? input.value : undefined;
  }

  function payloadFor(formType, form, evidence) {
    const clientSubmissionId = value(form, 'clientSubmissionId');
    const common = { propertyId: state.propertyId, clientSubmissionId };
    if (formType === 'daily_activity') {
      return {
        ...common,
        occurredAt: toIso(value(form, 'occurredAt')),
        activityDate: value(form, 'occurredAt') ? value(form, 'occurredAt').slice(0, 10) : undefined,
        category: value(form, 'category'), buildingId: value(form, 'buildingId'),
        locationId: value(form, 'locationId'), levelLabel: value(form, 'levelLabel'),
        specificLocation: value(form, 'specificLocation'), summary: value(form, 'summary'),
        actionTaken: value(form, 'actionTaken'), priority: value(form, 'priority') || 'routine',
        status: value(form, 'status') || 'completed', minutesSpent: numberOrUndefined(value(form, 'minutesSpent')),
        followUpRequired: checked(form, 'followUpRequired'), followUpDate: value(form, 'followUpDate'),
        responsibleParty: value(form, 'responsibleParty'), evidenceR2Key: evidence && evidence.r2Key,
        additionalNotes: value(form, 'additionalNotes'),
      };
    }
    if (formType === 'maintenance_defect') {
      return {
        ...common,
        category: value(form, 'category'), locationId: value(form, 'locationId'),
        unitId: value(form, 'unitId'), specificLocation: value(form, 'specificLocation'),
        description: value(form, 'description'), riskLevel: value(form, 'riskLevel') || 'normal',
        responsibility: value(form, 'responsibility'), immediateResponse: value(form, 'immediateResponse'),
        contractorRequired: checked(form, 'contractorRequired'), assignedContractorId: value(form, 'assignedContractorId'),
        strataApprovalRequired: checked(form, 'strataApprovalRequired'), quoteRequired: checked(form, 'quoteRequired'),
        dueDate: value(form, 'dueDate'), nextFollowUpDate: value(form, 'nextFollowUpDate'),
        evidenceR2Key: evidence && evidence.r2Key, evidenceContentType: evidence && evidence.contentType,
        evidenceCaption: value(form, 'evidenceCaption'), source: 'building_manager',
      };
    }
    if (formType === 'waste_activity') {
      return {
        ...common,
        occurredAt: toIso(value(form, 'occurredAt')), wasteType: value(form, 'wasteType'),
        activity: value(form, 'activity'), locationId: value(form, 'locationId'),
        quantity: numberOrUndefined(value(form, 'quantity')), minutesSpent: numberOrUndefined(value(form, 'minutesSpent')),
        conditionStatus: value(form, 'conditionStatus'), issueIdentified: checked(form, 'issueIdentified'),
        exceptionCategory: value(form, 'exceptionCategory'), responsibleUnitId: value(form, 'responsibleUnitId'),
        notes: value(form, 'notes'), actionTaken: value(form, 'actionTaken'),
        collectionRequired: checked(form, 'collectionRequired'), collectionArrangedDate: value(form, 'collectionArrangedDate'),
        evidenceR2Key: evidence && evidence.r2Key,
      };
    }
    if (formType === 'incident') {
      return {
        ...common,
        incidentAt: toIso(value(form, 'incidentAt')), category: value(form, 'category'),
        severity: value(form, 'severity') || 'normal', locationId: value(form, 'locationId'),
        unitId: value(form, 'unitId'), description: value(form, 'description'),
        personInvolved: value(form, 'personInvolved'), witnesses: value(form, 'witnesses'),
        immediateRisk: value(form, 'immediateRisk'), actionsTaken: value(form, 'actionsTaken'),
        damageNotes: value(form, 'damageNotes'), temporaryRepairNotes: value(form, 'temporaryRepairNotes'),
        emergencyServiceContractor: value(form, 'emergencyServiceContractor'),
        cctvAvailable: checked(form, 'cctvAvailable'), cctvReviewed: checked(form, 'cctvReviewed'),
        cctvTimestamp: value(form, 'cctvTimestamp'), policeOrSecurityContacted: checked(form, 'policeOrSecurityContacted'),
        externalReference: value(form, 'externalReference'), strataNotified: checked(form, 'strataNotified'),
        strataNotifiedAt: value(form, 'strataNotifiedAt') ? toIso(value(form, 'strataNotifiedAt')) : undefined,
        followUpRequired: checked(form, 'followUpRequired'), followUpDate: value(form, 'followUpDate'),
        resolution: value(form, 'resolution'), evidenceR2Key: evidence && evidence.r2Key,
      };
    }
    if (formType === 'bylaw_observation') {
      return {
        ...common,
        occurredAt: toIso(value(form, 'occurredAt')), category: value(form, 'category'),
        locationId: value(form, 'locationId'), unitId: value(form, 'unitId'),
        observation: value(form, 'observation'), actionTaken: value(form, 'actionTaken'),
        followUpDate: value(form, 'followUpDate'), evidenceR2Key: evidence && evidence.r2Key,
      };
    }
    if (formType === 'resident_induction') {
      return {
        ...common,
        unitId: value(form, 'unitId'), residentName: value(form, 'residentName'),
        residentRole: value(form, 'residentRole'), moveInDate: value(form, 'moveInDate'),
        modulesAcknowledged: Array.from(form.querySelectorAll('input[name="modulesAcknowledged"]:checked')).map((item) => item.value),
        rulesAcknowledged: checked(form, 'rulesAcknowledged'), questionsRaised: value(form, 'questionsRaised'),
        outstandingMatters: value(form, 'outstandingMatters'), acknowledgementName: value(form, 'acknowledgementName'),
        bmNotes: value(form, 'bmNotes'), completed: checked(form, 'completed'),
      };
    }
    throw new Error('Unsupported form type.');
  }

  async function submitForm(event, draftKey) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('form-message');
    message.className = 'hidden mt-3';
    if (!form.reportValidity()) return;
    const button = document.getElementById('submit-form');
    App.setSubmitting(button, true, 'Saving…');
    try {
      const evidence = await uploadEvidence(form);
      const payload = payloadFor(state.activeFormType, form, evidence);
      await App.api(endpointByForm[state.activeFormType], {
        method: 'POST', body: payload, idempotencyKey: payload.clientSubmissionId,
      });
      App.clearDraft(draftKey);
      message.textContent = 'Saved successfully. This record is now available to the monthly report.';
      message.className = 'form-success mt-3';
      App.toast('Record saved.', 'success');
      setTimeout(showHub, 700);
    } catch (error) {
      message.textContent = error.message || 'The record could not be saved.';
      message.className = 'form-error mt-3';
      App.toast(error.message || 'Save failed.', 'error');
    } finally {
      App.setSubmitting(button, false);
    }
  }

  async function loadRecentSubmissions() {
    const host = document.getElementById('recent-submissions');
    if (!host || !state.propertyId) return;
    try {
      const rows = await App.api(`/form-submissions?propertyId=${encodeURIComponent(state.propertyId)}&limit=8`);
      host.innerHTML = rows.length ? `<div class="divide-y divide-slate-100">${rows.map((row) => `<div class="py-2.5 flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-medium text-slate-800 truncate">${App.escapeHtml(row.form_type.replace(/_/g, ' '))}</div>
          <div class="text-xs text-slate-400">${App.fmtDateTime(row.submitted_at)}</div>
        </div>
        <span class="status-chip status-completed">Saved</span>
      </div>`).join('')}</div>` : App.emptyState('No field submissions recorded yet.', 'fa-clipboard');
    } catch (error) {
      host.innerHTML = `<div class="text-sm text-red-600">${App.escapeHtml(error.message)}</div>`;
    }
  }

  async function loadPropertyOptions() {
    state.options = await App.api(`/forms/options?propertyId=${encodeURIComponent(state.propertyId)}`);
    loadRecentSubmissions();
  }

  async function initialise() {
    try {
      state.me = await App.initShell();
      if (!state.me) return;
      const [config, properties] = await Promise.all([
        App.api('/forms/config'), App.api('/properties'),
      ]);
      state.config = config;
      state.propertyOptions = properties || [];
      state.propertyId = state.me.propertyScope || (state.propertyOptions[0] && state.propertyOptions[0].id);
      if (!state.propertyId) throw new Error('No property is available for this account.');

      const propertyRow = document.getElementById('forms-property-row');
      const propertySelect = document.getElementById('forms-property');
      propertySelect.innerHTML = App.optionsHtml(state.propertyOptions.map((item) => ({ value: item.id, label: item.name })), undefined);
      propertySelect.value = state.propertyId;
      if (!state.me.propertyScope && state.propertyOptions.length > 1) propertyRow.classList.remove('hidden');
      propertySelect.addEventListener('change', async () => {
        state.propertyId = propertySelect.value;
        await loadPropertyOptions();
        if (state.activeFormType) openForm(state.activeFormType);
      });

      await loadPropertyOptions();
      document.getElementById('forms-loading').classList.add('hidden');
      document.getElementById('forms-hub').classList.remove('hidden');
      document.querySelectorAll('[data-form]').forEach((button) => {
        button.addEventListener('click', () => openForm(button.dataset.form));
      });
      document.getElementById('forms-back').addEventListener('click', showHub);
      document.getElementById('refresh-submissions').addEventListener('click', loadRecentSubmissions);
      const requestedForm = new URL(window.location.href).searchParams.get('form');
      if (requestedForm && renderers[requestedForm]) openForm(requestedForm);
    } catch (error) {
      document.getElementById('forms-loading').innerHTML = `<div class="form-error">${App.escapeHtml(error.message || 'Quick forms could not be loaded.')}</div>`;
    }
  }

  initialise();
})();
