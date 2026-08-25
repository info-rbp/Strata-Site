import type { FC } from 'hono/jsx';
import { Shell } from './layout';

const REQUEST_CATEGORIES = [
  ['water_leak', 'Water Leak'], ['lift', 'Lift'], ['access_door', 'Access Door'],
  ['lighting', 'Lighting'], ['garage', 'Garage'], ['waste', 'Waste'],
  ['cleaning', 'Cleaning'], ['security', 'Security'], ['damage', 'Damage'],
  ['noise', 'Noise'], ['other', 'Other'],
];

export const ResidentHome: FC = () => (
  <Shell portal="resident" active="/resident" pageTitle="Home">
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <a href="/resident/report" class="card p-5 hover:border-blue-300 transition-colors">
        <i class="fa-solid fa-triangle-exclamation text-amber-500 text-xl mb-2"></i>
        <div class="font-semibold text-slate-800">Report a Problem</div>
        <div class="text-sm text-slate-500 mt-1">Leaks, lift faults, lighting and more</div>
      </a>
      <a href="/resident/moves" class="card p-5 hover:border-blue-300 transition-colors">
        <i class="fa-solid fa-truck-fast text-blue-600 text-xl mb-2"></i>
        <div class="font-semibold text-slate-800">Move / Delivery Booking</div>
        <div class="text-sm text-slate-500 mt-1">Book lift access and loading dock time</div>
      </a>
      <a href="/resident/access-devices" class="card p-5 hover:border-blue-300 transition-colors">
        <i class="fa-solid fa-key text-purple-600 text-xl mb-2"></i>
        <div class="font-semibold text-slate-800">Access Device Request</div>
        <div class="text-sm text-slate-500 mt-1">Fobs, swipes, remotes and physical keys</div>
      </a>
      <a href="/resident/requests" class="card p-5 hover:border-blue-300 transition-colors">
        <i class="fa-solid fa-list-check text-slate-600 text-xl mb-2"></i>
        <div class="font-semibold text-slate-800">My Requests</div>
        <div class="text-sm text-slate-500 mt-1">Track the status of everything you've submitted</div>
      </a>
      <a href="/resident/notices" class="card p-5 hover:border-blue-300 transition-colors">
        <i class="fa-solid fa-bullhorn text-green-600 text-xl mb-2"></i>
        <div class="font-semibold text-slate-800">Building Notices</div>
        <div class="text-sm text-slate-500 mt-1">Announcements from Building Management</div>
      </a>
    </div>
    <div id="recent-activity" class="mt-8"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function () {
        try {
          const [requests, moves] = await Promise.all([PMHub.api('/requests'), PMHub.api('/moves')]);
          const items = [...requests.map(r => ({ ...r, kind: 'Request' })), ...moves.map(m => ({ ...m, kind: 'Move' }))]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
          const host = document.getElementById('recent-activity');
          host.innerHTML = '<h2 class="font-semibold text-slate-800 mb-3">Recent Activity</h2>' +
            (items.length ? '<div class="card divide-y divide-slate-100">' + items.map(i =>
              '<div class="p-4 flex items-center justify-between"><div><div class="text-sm font-medium text-slate-800">' + i.kind + ': ' + PMHub.escapeHtml(i.category || i.move_type || '') + '</div><div class="text-xs text-slate-400">' + PMHub.fmtDate(i.created_at) + '</div></div>' + PMHub.statusChip(i.status) + '</div>'
            ).join('') + '</div>' : PMHub.emptyState('No recent activity yet.'));
        } catch (e) { console.error(e); }
      });
    `,
      }}
    ></script>
  </Shell>
);

export const ResidentReport: FC = () => (
  <Shell portal="resident" active="/resident/report" pageTitle="Report a Problem">
    <div class="max-w-2xl">
      <div class="card p-6">
        <form id="report-form" class="space-y-4">
          <div>
            {'' /* label */}
            <label class="field-label">Category</label>
            <select id="rf-category" class="field-input">
              {REQUEST_CATEGORIES.map(([v, l]) => (
                <option value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div>
            <label class="field-label">Location (optional)</label>
            <input id="rf-location" class="field-input" placeholder="e.g. Level 3 corridor, Unit 402 bathroom" />
          </div>
          <div>
            <label class="field-label">Description</label>
            <textarea id="rf-description" class="field-input" rows={4} placeholder="Describe the issue in as much detail as possible" required></textarea>
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" id="rf-urgent" class="rounded" />
            <label for="rf-urgent" class="text-sm text-slate-600">This is urgent (safety risk / active damage)</label>
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" id="rf-access" class="rounded" />
            <label for="rf-access" class="text-sm text-slate-600">Apartment access is required to resolve this</label>
          </div>
          <div>
            <label class="field-label">Contact details (optional)</label>
            <input id="rf-contact" class="field-input" placeholder="Best number/email to reach you" />
          </div>
          <div id="report-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"></div>
          <button type="submit" id="report-submit" class="btn-primary">Submit Report</button>
        </form>
      </div>
      <div id="report-success" class="hidden card p-6 mt-4 border-green-200 bg-green-50">
        <i class="fa-solid fa-circle-check text-green-600 text-lg"></i>
        <span class="ml-2 font-medium text-green-800">Request submitted. Reference: <span id="report-ref"></span></span>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell();
      document.getElementById('report-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errorEl = document.getElementById('report-error');
        const btn = document.getElementById('report-submit');
        errorEl.classList.add('hidden');
        btn.disabled = true;
        try {
          const res = await PMHub.api('/requests', { method: 'POST', body: {
            category: document.getElementById('rf-category').value,
            locationText: document.getElementById('rf-location').value || undefined,
            description: document.getElementById('rf-description').value,
            urgency: document.getElementById('rf-urgent').checked ? 'urgent' : 'normal',
            apartmentAccessRequired: document.getElementById('rf-access').checked,
            contactDetails: document.getElementById('rf-contact').value || undefined,
          }});
          document.getElementById('report-ref').textContent = res.referenceNumber;
          document.getElementById('report-success').classList.remove('hidden');
          document.getElementById('report-form').reset();
          PMHub.toast('Request submitted successfully.', 'success');
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        } finally {
          btn.disabled = false;
        }
      });
    `,
      }}
    ></script>
  </Shell>
);

export const ResidentMoves: FC = () => (
  <Shell portal="resident" active="/resident/moves" pageTitle="Move / Delivery Booking">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card p-6">
        <h2 class="font-semibold text-slate-800 mb-4">New Booking</h2>
        <form id="move-form" class="space-y-4">
          <div>
            <label class="field-label">Type</label>
            <select id="mf-type" class="field-input">
              <option value="move_in">Move In</option>
              <option value="move_out">Move Out</option>
              <option value="furniture_delivery">Furniture Delivery</option>
              <option value="furniture_removal">Furniture Removal</option>
              <option value="bulky_item">Bulky Item</option>
            </select>
          </div>
          <div>
            <label class="field-label">Date &amp; Time</label>
            <input id="mf-datetime" type="datetime-local" class="field-input" required />
          </div>
          <div>
            <label class="field-label">Removalist / Company (optional)</label>
            <input id="mf-removalist" class="field-input" />
          </div>
          <div>
            <label class="field-label">Vehicle details (optional)</label>
            <input id="mf-vehicle" class="field-input" placeholder="e.g. 8-tonne truck, rego ABC123" />
          </div>
          <div>
            <label class="field-label">Estimated duration (minutes)</label>
            <input id="mf-duration" type="number" class="field-input" placeholder="120" />
          </div>
          <div class="flex items-center gap-2">
            <input type="checkbox" id="mf-rules" class="rounded" required />
            <label for="mf-rules" class="text-sm text-slate-600">I acknowledge the building move-in/out rules</label>
          </div>
          <div id="move-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"></div>
          <button type="submit" class="btn-primary">Submit Booking Request</button>
        </form>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-4">My Bookings</h2>
        <div id="move-list"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell();
      async function loadMoves() {
        const list = await PMHub.api('/moves');
        const host = document.getElementById('move-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(m =>
          '<div class="p-4"><div class="flex items-center justify-between"><div class="font-medium text-sm text-slate-800">' + m.move_type.replace(/_/g,' ') + '</div>' + PMHub.statusChip(m.status) + '</div><div class="text-xs text-slate-400 mt-1">' + PMHub.fmtDateTime(m.requested_at) + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No bookings yet.', 'fa-truck-fast');
      }
      loadMoves();
      document.getElementById('move-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errorEl = document.getElementById('move-error');
        errorEl.classList.add('hidden');
        try {
          const units = await PMHub.api('/me/units');
          if (!units.length) { errorEl.textContent = 'No unit is linked to your account yet. Contact Building Management.'; errorEl.classList.remove('hidden'); return; }
          await PMHub.api('/moves', { method: 'POST', body: {
            unitId: units[0].id,
            moveType: document.getElementById('mf-type').value,
            requestedAt: new Date(document.getElementById('mf-datetime').value).toISOString(),
            removalistName: document.getElementById('mf-removalist').value || undefined,
            vehicleDetails: document.getElementById('mf-vehicle').value || undefined,
            estimatedDurationMinutes: document.getElementById('mf-duration').value ? Number(document.getElementById('mf-duration').value) : undefined,
            rulesAcknowledged: document.getElementById('mf-rules').checked,
          }});
          document.getElementById('move-form').reset();
          PMHub.toast('Booking submitted for approval.', 'success');
          loadMoves();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      });
    `,
      }}
    ></script>
  </Shell>
);

export const ResidentAccessDevices: FC = () => (
  <Shell portal="resident" active="/resident/access-devices" pageTitle="Access Device Request">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="card p-6">
        <h2 class="font-semibold text-slate-800 mb-4">New Request</h2>
        <form id="adr-form" class="space-y-4">
          <div>
            <label class="field-label">Request Type</label>
            <select id="adr-type" class="field-input">
              <option value="replacement_fob">Replacement Fob</option>
              <option value="additional_fob">Additional Fob</option>
              <option value="remote">Remote</option>
              <option value="swipe">Swipe Card</option>
              <option value="physical_key">Physical Key</option>
              <option value="lost_stolen">Lost / Stolen — Deactivate</option>
            </select>
          </div>
          <div>
            <label class="field-label">Your role for this unit</label>
            <select id="adr-role" class="field-input">
              <option value="owner">Owner</option>
              <option value="tenant">Tenant</option>
              <option value="authorised_agent">Authorised Agent</option>
            </select>
            <p class="text-xs text-slate-400 mt-1">Tenant requests require owner authorisation before issue.</p>
          </div>
          <div id="adr-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2"></div>
          <button type="submit" class="btn-primary">Submit Request</button>
        </form>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-4">My Requests</h2>
        <div id="adr-list"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell();
      async function loadRequests() {
        const list = await PMHub.api('/access-device-requests');
        const host = document.getElementById('adr-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(r =>
          '<div class="p-4"><div class="flex items-center justify-between"><div class="font-medium text-sm text-slate-800">' + r.request_type.replace(/_/g,' ') + '</div>' + PMHub.statusChip(r.status) + '</div><div class="text-xs text-slate-400 mt-1">' + PMHub.fmtDate(r.created_at) + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No requests yet.', 'fa-key');
      }
      loadRequests();
      document.getElementById('adr-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        const errorEl = document.getElementById('adr-error');
        errorEl.classList.add('hidden');
        try {
          const units = await PMHub.api('/me/units');
          if (!units.length) { errorEl.textContent = 'No unit is linked to your account yet. Contact Building Management.'; errorEl.classList.remove('hidden'); return; }
          await PMHub.api('/access-device-requests', { method: 'POST', body: {
            unitId: units[0].id,
            requestType: document.getElementById('adr-type').value,
            requesterRole: document.getElementById('adr-role').value,
          }});
          document.getElementById('adr-form').reset();
          PMHub.toast('Request submitted.', 'success');
          loadRequests();
        } catch (err) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      });
    `,
      }}
    ></script>
  </Shell>
);

export const ResidentRequests: FC = () => (
  <Shell portal="resident" active="/resident/requests" pageTitle="My Requests">
    <div id="all-requests"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function () {
        const [requests, moves, devices] = await Promise.all([
          PMHub.api('/requests'), PMHub.api('/moves'), PMHub.api('/access-device-requests'),
        ]);
        const rows = [
          ...requests.map(r => ({ kind: 'Maintenance Request', label: (r.category||'').replace(/_/g,' '), status: r.status, date: r.created_at })),
          ...moves.map(m => ({ kind: 'Move / Delivery', label: (m.move_type||'').replace(/_/g,' '), status: m.status, date: m.created_at })),
          ...devices.map(d => ({ kind: 'Access Device', label: (d.request_type||'').replace(/_/g,' '), status: d.status, date: d.created_at })),
        ].sort((a,b) => new Date(b.date) - new Date(a.date));
        const host = document.getElementById('all-requests');
        host.innerHTML = rows.length ? '<div class="card divide-y divide-slate-100">' + rows.map(r =>
          '<div class="p-4 flex items-center justify-between"><div><div class="text-xs text-slate-400 uppercase tracking-wide">' + r.kind + '</div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(r.label) + '</div><div class="text-xs text-slate-400 mt-0.5">' + PMHub.fmtDate(r.date) + '</div></div>' + PMHub.statusChip(r.status) + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('You have not submitted anything yet.');
      });
    `,
      }}
    ></script>
  </Shell>
);

export const ResidentNotices: FC = () => (
  <Shell portal="resident" active="/resident/notices" pageTitle="Building Notices">
    <div id="notice-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function () {
        const list = await PMHub.api('/notices');
        const host = document.getElementById('notice-list');
        host.innerHTML = list.length ? list.map(n =>
          '<div class="card p-5 mb-3"><div class="font-semibold text-slate-800">' + PMHub.escapeHtml(n.title) + '</div><div class="text-sm text-slate-600 mt-2 whitespace-pre-wrap">' + PMHub.escapeHtml(n.body) + '</div><div class="text-xs text-slate-400 mt-3">' + PMHub.fmtDate(n.published_at) + '</div></div>'
        ).join('') : PMHub.emptyState('No notices published yet.', 'fa-bullhorn');
      });
    `,
      }}
    ></script>
  </Shell>
);
