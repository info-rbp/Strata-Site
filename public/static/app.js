// ProInspect Building Management shared browser runtime.
// Deliberately dependency-light: field forms must remain usable on ordinary
// phones with ordinary reception, a scenario web projects sometimes discover
// only after launch.
(function () {
  'use strict';

  const PRODUCT_NAME = 'ProInspect Building Management';
  const STATUS_LABELS = {
    new: 'New', triaged: 'Triaged', converted_to_defect: 'Converted', closed: 'Closed',
    bm_assessment: 'BM Assessment', minor_repair: 'Minor Repair', contractor_required: 'Contractor Required',
    awaiting_approval: 'Awaiting Approval', approved: 'Approved', contractor_booked: 'Contractor Booked',
    in_progress: 'In Progress', awaiting_verification: 'Awaiting Verification', completed: 'Completed',
    created: 'Created', scheduled: 'Scheduled', verified: 'Verified', cancelled: 'Cancelled',
    pending_approval: 'Pending Approval', declined: 'Declined', pre_move_setup: 'Pre-Move Setup',
    post_move_inspection: 'Post-Move Inspection', submitted: 'Submitted', awaiting_authorisation: 'Awaiting Authorisation',
    programming: 'Programming', ready_for_collection: 'Ready for Collection', issued: 'Issued',
    on_site: 'On Site', pending_key_return: 'Pending Key Return', open: 'Open', monitoring: 'Monitoring',
    pending: 'Pending', in_progress_task: 'In Progress', active: 'Active', stock: 'Stock',
    pending_programming: 'Pending Programming', lost: 'Lost', stolen: 'Stolen', deactivated: 'Deactivated',
    returned: 'Returned', destroyed: 'Destroyed', normal: 'Normal', routine: 'Routine', medium: 'Medium',
    high: 'High', immediate_danger: 'Immediate Danger', urgent: 'Urgent', recommended: 'Recommended',
    more_info_requested: 'More Info Requested', suspended: 'Suspended', information_only: 'Information Only',
    resident_contact: 'Resident Contact', formal_breach_action: 'Formal Breach Action', no_action: 'No Action',
    monitor: 'Monitor', outstanding: 'Outstanding', referred: 'Referred', complete: 'Complete',
    exception: 'Exception', pass: 'OK', fail: 'Defect', not_applicable: 'N/A', draft: 'Draft', finalised: 'Finalised',
  };

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusChip(status) {
    if (!status) return '';
    const label = STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
    return `<span class="status-chip status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric',
      }).format(new Date(iso));
    } catch (e) { return String(iso); }
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(new Date(iso));
    } catch (e) { return String(iso); }
  }

  function timeAgo(iso) {
    if (!iso) return '';
    try {
      const diffMs = Date.now() - new Date(iso).getTime();
      const mins = Math.round(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      return Math.round(hrs / 24) + 'd ago';
    } catch (e) { return ''; }
  }

  function clientId(prefix) {
    const uuid = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix || 'field'}-${uuid}`;
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    let body = opts.body;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !(body instanceof Blob) && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch('/api' + path, {
        method: opts.method || 'GET',
        headers,
        body,
        credentials: 'same-origin',
        signal: opts.signal,
      });
    } catch (networkError) {
      const error = new Error('The request could not reach the server. Your draft is still saved on this device.');
      error.code = 'NETWORK_ERROR';
      error.cause = networkError;
      throw error;
    }
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    try { data = contentType.includes('application/json') ? await res.json() : await res.text(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : typeof data === 'string' && data
          ? data
          : `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function upload(file, propertyId) {
    if (!file) return null;
    const headers = {
      'Content-Type': file.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name || 'upload'),
    };
    if (propertyId) headers['X-Property-Id'] = propertyId;
    return api('/uploads', { method: 'POST', headers, body: file });
  }

  function toast(message, type) {
    type = type || 'info';
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-[calc(100vw-2rem)]';
      document.body.appendChild(host);
    }
    const colors = {
      info: 'bg-slate-800', success: 'bg-emerald-700', error: 'bg-red-700', warning: 'bg-amber-700',
    };
    const el = document.createElement('div');
    el.className = `${colors[type] || colors.info} text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg transition-opacity duration-300`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4500);
  }

  function confirmDialog(message) {
    return window.confirm(message);
  }

  function localDateTimeInput(date) {
    const d = date ? new Date(date) : new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function localDateInput(date) {
    return localDateTimeInput(date).slice(0, 10);
  }

  function formToObject(form) {
    const data = {};
    const formData = new FormData(form);
    formData.forEach((value, key) => {
      if (value instanceof File) return;
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (!Array.isArray(data[key])) data[key] = [data[key]];
        data[key].push(value);
      } else {
        data[key] = value;
      }
    });
    form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
      if (!Object.prototype.hasOwnProperty.call(data, input.name)) data[input.name] = false;
      if (input.checked && input.value === 'on') data[input.name] = true;
    });
    return data;
  }

  function fillForm(form, data) {
    if (!form || !data) return;
    Object.keys(data).forEach((key) => {
      const fields = form.querySelectorAll(`[name="${window.CSS && CSS.escape ? CSS.escape(key) : key}"]`);
      fields.forEach((field) => {
        if (field.type === 'file') return;
        if (field.type === 'checkbox') {
          field.checked = Array.isArray(data[key]) ? data[key].includes(field.value) : data[key] === true || data[key] === field.value;
        } else if (field.type === 'radio') {
          field.checked = data[key] === field.value;
        } else {
          field.value = data[key] === null || data[key] === undefined ? '' : data[key];
        }
      });
    });
  }

  function draftKey(formType, propertyId) {
    return `proinspect-bm:draft:${formType}:${propertyId || 'unscoped'}`;
  }

  function saveDraft(key, value) {
    try { localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), value })); } catch (e) { /* private mode */ }
  }

  function loadDraft(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && parsed.value ? parsed : null;
    } catch (e) { return null; }
  }

  function clearDraft(key) {
    try { localStorage.removeItem(key); } catch (e) { /* private mode */ }
  }

  function attachAutosave(form, key, options) {
    if (!form) return function () {};
    options = options || {};
    let timer = null;
    const save = function () {
      saveDraft(key, formToObject(form));
      if (options.onSave) options.onSave();
    };
    const schedule = function () {
      clearTimeout(timer);
      timer = setTimeout(save, 300);
    };
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    return save;
  }

  function setSubmitting(button, submitting, label) {
    if (!button) return;
    if (submitting) {
      button.dataset.originalLabel = button.textContent;
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>' + escapeHtml(label || 'Saving…');
    } else {
      button.disabled = false;
      button.textContent = button.dataset.originalLabel || label || 'Save';
    }
  }

  function optionsHtml(options, placeholder) {
    const first = placeholder === undefined ? '' : `<option value="">${escapeHtml(placeholder)}</option>`;
    return first + (options || []).map((option) =>
      `<option value="${escapeHtml(option.value !== undefined ? option.value : option.id)}">${escapeHtml(option.label !== undefined ? option.label : option.name)}</option>`
    ).join('');
  }

  function emptyState(message, icon) {
    icon = icon || 'fa-inbox';
    return `<div class="text-center py-12 text-slate-400">
      <i class="fa-solid ${icon} text-3xl mb-2"></i>
      <div class="text-sm">${escapeHtml(message)}</div>
    </div>`;
  }

  async function initShell() {
    let me;
    try {
      const r = await api('/me');
      me = r.user;
    } catch (e) {
      me = null;
    }
    if (!me) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname + window.location.search);
      return null;
    }
    const badge = document.getElementById('user-badge');
    if (badge) {
      const roleLabel = (me.role || '').replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
      badge.innerHTML = `<div class="font-medium text-slate-800">${escapeHtml(me.fullName || me.email)}</div><div class="text-xs text-slate-400">${escapeHtml(roleLabel)}</div>`;
    }
    const propBadge = document.getElementById('property-badge');
    if (propBadge) {
      if (me.propertyScope) {
        try {
          const props = await api('/properties');
          const property = props.find((item) => item.id === me.propertyScope);
          propBadge.textContent = property ? property.name : me.propertyScope;
        } catch (e) { propBadge.textContent = ''; }
      } else {
        propBadge.textContent = 'Prima & Meridian';
      }
    }
    const titleEl = document.getElementById('page-title');
    if (titleEl && !titleEl.textContent) titleEl.textContent = document.title.split('·')[0].trim();
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
        window.location.href = '/login';
      });
    }
    initNotifications();
    return me;
  }

  async function initNotifications() {
    const btn = document.getElementById('notif-btn');
    const dot = document.getElementById('notif-dot');
    if (!btn) return;
    async function refresh() {
      try {
        const list = await api('/notifications');
        const unread = list.filter((item) => !item.is_read);
        if (dot) dot.classList.toggle('hidden', unread.length === 0);
        return list;
      } catch (e) { return []; }
    }
    let panel = null;
    btn.addEventListener('click', async () => {
      if (panel) { panel.remove(); panel = null; return; }
      const list = await refresh();
      panel = document.createElement('div');
      panel.className = 'fixed md:absolute right-4 top-14 w-[calc(100vw-2rem)] md:w-80 max-h-96 overflow-y-auto card z-40 p-2';
      panel.innerHTML = list.length
        ? list.slice(0, 20).map((item) => `<div class="px-3 py-2 rounded-lg ${item.is_read ? '' : 'bg-blue-50'} mb-1">
            <div class="text-sm font-medium text-slate-800">${escapeHtml(item.title)}</div>
            ${item.body ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(item.body)}</div>` : ''}
            <div class="text-[11px] text-slate-400 mt-1">${timeAgo(item.created_at)}</div>
          </div>`).join('')
        : '<div class="text-sm text-slate-400 px-3 py-4 text-center">No notifications</div>';
      document.body.appendChild(panel);
      if (list.some((item) => !item.is_read)) {
        api('/notifications/read-all', { method: 'POST' }).then(() => { if (dot) dot.classList.add('hidden'); }).catch(() => {});
      }
      const closeOnOutside = (event) => {
        if (panel && !panel.contains(event.target) && event.target !== btn) {
          panel.remove(); panel = null;
          document.removeEventListener('click', closeOnOutside);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
    });
    refresh();
    setInterval(refresh, 60000);
  }

  const runtime = {
    PRODUCT_NAME, api, upload, toast, confirmDialog, escapeHtml, statusChip, fmtDate, fmtDateTime,
    timeAgo, initShell, emptyState, STATUS_LABELS, clientId, localDateTimeInput,
    localDateInput, formToObject, fillForm, draftKey, saveDraft, loadDraft, clearDraft,
    attachAutosave, setSubmitting, optionsHtml,
  };
  window.ProInspectBM = runtime;
  // Temporary compatibility alias while the remaining legacy Phase 1 pages
  // are progressively retired. New code must use ProInspectBM.
  window.PMHub = runtime;
})();
