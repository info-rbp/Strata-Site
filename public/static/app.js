// PM Hub — shared client runtime. Loaded on every page before the
// page-specific script. Provides: authenticated fetch helper, shell wiring
// (user/property badges, logout, notifications), small render utilities.
(function () {
  'use strict';

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
    returned: 'Returned', destroyed: 'Destroyed', normal: 'Normal', high: 'High', immediate_danger: 'Immediate Danger',
    urgent: 'Urgent', recommended: 'Recommended', more_info_requested: 'More Info Requested', suspended: 'Suspended',
    information_only: 'Information Only', resident_contact: 'Resident Contact', formal_breach_action: 'Formal Breach Action',
    no_action: 'No Action', monitor: 'Monitor',
  };

  const PROPERTY_LABELS = {}; // populated once /api/properties resolves

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function statusChip(status) {
    if (!status) return '';
    const label = STATUS_LABELS[status] || status.replace(/_/g, ' ');
    return `<span class="status-chip status-${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try { return window.dayjs(iso).format('D MMM YYYY'); } catch (e) { return iso; }
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    try { return window.dayjs(iso).format('D MMM YYYY, h:mm A'); } catch (e) { return iso; }
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

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body && typeof body === 'object' && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body,
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      const message = (data && data.error && data.error.message) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.code = data && data.error && data.error.code;
      throw err;
    }
    return data;
  }

  function toast(message, type) {
    type = type || 'info';
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
      document.body.appendChild(host);
    }
    const colors = {
      info: 'bg-slate-800', success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-amber-600',
    };
    const el = document.createElement('div');
    el.className = `${colors[type] || colors.info} text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-lg transition-opacity duration-300`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
  }

  function confirmDialog(message) {
    return window.confirm(message);
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
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return null;
    }
    const badge = document.getElementById('user-badge');
    if (badge) {
      const roleLabel = (me.role || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      badge.innerHTML = `<div class="font-medium text-slate-800">${escapeHtml(me.fullName || me.email)}</div><div class="text-xs text-slate-400">${escapeHtml(roleLabel)}</div>`;
    }
    const propBadge = document.getElementById('property-badge');
    if (propBadge) {
      if (me.propertyScope) {
        try {
          const props = await api('/properties');
          const p = props.find((x) => x.id === me.propertyScope);
          propBadge.textContent = p ? p.name : me.propertyScope;
        } catch (e) { propBadge.textContent = ''; }
      } else {
        propBadge.textContent = 'All properties';
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
        const unread = list.filter((n) => !n.is_read);
        if (dot) dot.classList.toggle('hidden', unread.length === 0);
        return list;
      } catch (e) { return []; }
    }
    let panel = null;
    btn.addEventListener('click', async () => {
      if (panel) { panel.remove(); panel = null; return; }
      const list = await refresh();
      panel = document.createElement('div');
      panel.className = 'absolute right-4 top-14 w-80 max-h-96 overflow-y-auto card z-40 p-2';
      panel.innerHTML = list.length
        ? list
            .slice(0, 20)
            .map(
              (n) => `<div class="px-3 py-2 rounded-lg ${n.is_read ? '' : 'bg-blue-50'} mb-1">
                <div class="text-sm font-medium text-slate-800">${escapeHtml(n.title)}</div>
                ${n.body ? `<div class="text-xs text-slate-500 mt-0.5">${escapeHtml(n.body)}</div>` : ''}
                <div class="text-[11px] text-slate-400 mt-1">${timeAgo(n.created_at)}</div>
              </div>`,
            )
            .join('')
        : '<div class="text-sm text-slate-400 px-3 py-4 text-center">No notifications</div>';
      document.body.appendChild(panel);
      if (list.some((n) => !n.is_read)) {
        api('/notifications/read-all', { method: 'POST' }).then(() => { if (dot) dot.classList.add('hidden'); }).catch(() => {});
      }
      const closeOnOutside = (ev) => {
        if (panel && !panel.contains(ev.target) && ev.target !== btn) {
          panel.remove(); panel = null;
          document.removeEventListener('click', closeOnOutside);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOnOutside), 10);
    });
    refresh();
    setInterval(refresh, 30000);
  }

  function fieldLabel(text) {
    return `<label class="field-label">${escapeHtml(text)}</label>`;
  }

  function emptyState(message, icon) {
    icon = icon || 'fa-inbox';
    return `<div class="text-center py-12 text-slate-400">
      <i class="fa-solid ${icon} text-3xl mb-2"></i>
      <div class="text-sm">${escapeHtml(message)}</div>
    </div>`;
  }

  window.PMHub = {
    api, toast, confirmDialog, escapeHtml, statusChip, fmtDate, fmtDateTime, timeAgo,
    initShell, fieldLabel, emptyState, STATUS_LABELS,
  };
})();
