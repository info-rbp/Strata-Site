import type { FC } from 'hono/jsx';
import { Shell } from './layout';

// ---------------------------------------------------------------------------
// Today — BM command centre
// ---------------------------------------------------------------------------
export const BmToday: FC = () => (
  <Shell portal="bm" active="/bm" pageTitle="Today">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" id="bm-today-stats"></div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 class="font-semibold text-slate-800 mb-3"><i class="fa-solid fa-fire text-red-500 mr-1.5"></i>Urgent / High-Risk Defects</h2>
        <div id="bm-urgent"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-3"><i class="fa-solid fa-helmet-safety text-amber-600 mr-1.5"></i>Contractors On Site Today</h2>
        <div id="bm-contractors"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-3"><i class="fa-solid fa-truck-fast text-blue-600 mr-1.5"></i>Today's Resident Activity</h2>
        <div id="bm-activity"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-3"><i class="fa-solid fa-list-check text-slate-600 mr-1.5"></i>Scheduled Tasks</h2>
        <div id="bm-tasks-today"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function (me) {
        const props = await PMHub.api('/properties');
        const propertyId = me.propertyScope || (props[0] && props[0].id);
        const data = await PMHub.api('/dashboard/bm-today?propertyId=' + propertyId);
        document.getElementById('bm-today-stats').innerHTML = [
          ['Open Defects', data.outstanding.openDefects, 'fa-screwdriver-wrench', 'text-amber-600'],
          ['Quotes Awaiting Approval', data.outstanding.quotesAwaitingApproval, 'fa-file-invoice-dollar', 'text-purple-600'],
          ['Work Orders to Verify', data.outstanding.workOrdersAwaitingVerification, 'fa-clipboard-check', 'text-blue-600'],
          ['Overdue Tasks', data.overdueTaskCount, 'fa-triangle-exclamation', 'text-red-600'],
        ].map(([label, val, icon, color]) =>
          '<div class="card p-4"><i class="fa-solid ' + icon + ' ' + color + ' mb-2"></i><div class="text-2xl font-bold text-slate-800">' + val + '</div><div class="text-xs text-slate-500">' + label + '</div></div>'
        ).join('');

        document.getElementById('bm-urgent').innerHTML = data.urgent.length ? '<div class="card divide-y divide-slate-100">' + data.urgent.map(d =>
          '<a href="/bm/defects" class="p-4 flex items-center justify-between hover:bg-slate-50"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(d.category) + '</div><div class="text-xs text-slate-400 mt-0.5">' + PMHub.escapeHtml((d.description||'').slice(0,60)) + '</div></div>' + PMHub.statusChip(d.riskLevel) + '</a>'
        ).join('') + '</div>' : PMHub.emptyState('No urgent defects right now.', 'fa-check');

        document.getElementById('bm-contractors').innerHTML = data.todaysContractors.length ? '<div class="card divide-y divide-slate-100">' + data.todaysContractors.map(a =>
          '<div class="p-4 flex items-center justify-between"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(a.contractorName) + '</div><div class="text-xs text-slate-400">' + PMHub.fmtDateTime(a.signInAt) + '</div></div>' + PMHub.statusChip(a.status) + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No contractors on site today.', 'fa-helmet-safety');

        document.getElementById('bm-activity').innerHTML = data.residentActivity.length ? '<div class="card divide-y divide-slate-100">' + data.residentActivity.map(m =>
          '<div class="p-4 flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + (m.moveType||'').replace(/_/g,' ') + '</div>' + PMHub.statusChip(m.status) + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No moves or deliveries scheduled today.', 'fa-truck-fast');

        document.getElementById('bm-tasks-today').innerHTML = data.scheduledTasks.length ? '<div class="card divide-y divide-slate-100">' + data.scheduledTasks.map(t =>
          '<div class="p-4 flex items-center justify-between"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(t.title) + '</div><div class="text-xs text-slate-400">' + (t.dueAt ? PMHub.fmtDate(t.dueAt) : 'No due date') + '</div></div>' + (t.priority === 'urgent' ? PMHub.statusChip('urgent') : '') + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No tasks scheduled.', 'fa-list-check');
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
export const BmTasks: FC = () => (
  <Shell portal="bm" active="/bm/tasks" pageTitle="Tasks">
    <div class="flex gap-2 mb-4" id="task-filters">
      <button class="btn-secondary text-xs py-1.5 px-3" data-status="">All</button>
      <button class="btn-secondary text-xs py-1.5 px-3" data-status="open">Open</button>
      <button class="btn-secondary text-xs py-1.5 px-3" data-status="in_progress">In Progress</button>
      <button class="btn-secondary text-xs py-1.5 px-3" data-status="completed">Completed</button>
    </div>
    <div id="task-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(function () { load(''); });
      document.getElementById('task-filters').addEventListener('click', function (e) {
        if (e.target.dataset.status !== undefined) load(e.target.dataset.status);
      });
      async function load(status) {
        const list = await PMHub.api('/tasks' + (status ? '?status=' + status : ''));
        const host = document.getElementById('task-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(t =>
          '<div class="p-4 flex items-center justify-between" data-task="' + t.id + '"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(t.title) + '</div><div class="text-xs text-slate-400 mt-0.5">' + t.task_type.replace(/_/g,' ') + ' · ' + (t.due_at ? PMHub.fmtDate(t.due_at) : 'No due date') + '</div></div><div class="flex items-center gap-2">' + (t.priority === 'urgent' ? PMHub.statusChip('urgent') : '') + PMHub.statusChip(t.status) + (t.status !== 'completed' ? '<button class="btn-secondary text-xs py-1 px-2 complete-btn" data-id="' + t.id + '">Complete</button>' : '') + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No tasks found.', 'fa-list-check');
        host.querySelectorAll('.complete-btn').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            await PMHub.api('/tasks/' + btn.dataset.id + '/complete', { method: 'POST', body: {} });
            PMHub.toast('Task marked complete.', 'success');
            load('');
          });
        });
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------
export const BmInspections: FC = () => (
  <Shell portal="bm" active="/bm/inspections" pageTitle="Inspections">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div>
        <h2 class="font-semibold text-slate-800 mb-3">Templates</h2>
        <div id="insp-templates"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
      <div class="lg:col-span-2">
        <h2 class="font-semibold text-slate-800 mb-3">Active Inspection</h2>
        <div id="insp-active">
          <div class="card p-8 text-center text-slate-400 text-sm">Select a template to start an inspection route.</div>
        </div>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(load);
      async function load() {
        const templates = await PMHub.api('/inspection-templates');
        const host = document.getElementById('insp-templates');
        host.innerHTML = templates.length ? '<div class="card divide-y divide-slate-100">' + templates.map(t =>
          '<button class="w-full text-left p-4 hover:bg-slate-50 start-insp" data-id="' + t.id + '"><div class="font-medium text-sm text-slate-800">' + PMHub.escapeHtml(t.name) + '</div><div class="text-xs text-slate-400">' + (t.frequency||'ad hoc') + '</div></button>'
        ).join('') + '</div>' : PMHub.emptyState('No templates configured yet.', 'fa-clipboard-check');
        host.querySelectorAll('.start-insp').forEach(function (btn) {
          btn.addEventListener('click', function () { startInspection(btn.dataset.id); });
        });
      }
      async function startInspection(templateId) {
        const insp = await PMHub.api('/inspections', { method: 'POST', body: { templateId } });
        const checkpoints = await PMHub.api('/inspection-templates/' + templateId + '/checkpoints');
        renderActive(insp.id, checkpoints, 0, { pass: 0, fail: 0 });
      }
      function renderActive(inspId, checkpoints, idx, tally) {
        const host = document.getElementById('insp-active');
        if (idx >= checkpoints.length) {
          host.innerHTML = '<div class="card p-8 text-center"><i class="fa-solid fa-circle-check text-green-600 text-2xl mb-2"></i><div class="font-medium text-slate-800">Inspection complete</div><div class="text-sm text-slate-500 mt-1">' + tally.pass + ' passed, ' + tally.fail + ' failed</div></div>';
          PMHub.api('/inspections/' + inspId + '/finish', { method: 'POST' }).catch(function(){});
          return;
        }
        const cp = checkpoints[idx];
        host.innerHTML = '<div class="card p-6"><div class="text-xs text-slate-400 mb-1">Checkpoint ' + (idx+1) + ' of ' + checkpoints.length + '</div><div class="font-semibold text-slate-800 text-lg mb-4">' + PMHub.escapeHtml(cp.label) + '</div>' +
          '<textarea id="cp-obs" class="field-input mb-3" rows="2" placeholder="Observation notes (required if fail)"></textarea>' +
          '<div class="flex gap-2"><button class="btn-primary flex-1" id="cp-pass"><i class="fa-solid fa-check mr-1"></i>Pass</button><button class="btn-secondary flex-1 !text-red-600 !border-red-200" id="cp-fail"><i class="fa-solid fa-xmark mr-1"></i>Fail</button><button class="btn-secondary" id="cp-na">N/A</button></div></div>';
        function record(result) {
          const observation = document.getElementById('cp-obs').value;
          PMHub.api('/inspections/' + inspId + '/results', { method: 'POST', body: { checkpointId: cp.id, result, observation: observation || undefined } })
            .then(function (res) {
              if (result === 'fail') { PMHub.toast('Defect auto-created from failed checkpoint.', 'warning'); tally.fail++; } else if (result === 'pass') tally.pass++;
              renderActive(inspId, checkpoints, idx + 1, tally);
            });
        }
        document.getElementById('cp-pass').addEventListener('click', function(){ record('pass'); });
        document.getElementById('cp-fail').addEventListener('click', function(){ record('fail'); });
        document.getElementById('cp-na').addEventListener('click', function(){ record('not_applicable'); });
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Defects & Maintenance
// ---------------------------------------------------------------------------
export const BmDefects: FC = () => (
  <Shell portal="bm" active="/bm/defects" pageTitle="Defects & Maintenance">
    <div class="flex items-center justify-between mb-4">
      <div class="flex gap-2" id="defect-filters">
        <button class="btn-secondary text-xs py-1.5 px-3" data-status="">All</button>
        <button class="btn-secondary text-xs py-1.5 px-3" data-status="new">New</button>
        <button class="btn-secondary text-xs py-1.5 px-3" data-status="bm_assessment">Assessment</button>
        <button class="btn-secondary text-xs py-1.5 px-3" data-status="contractor_booked">Booked</button>
        <button class="btn-secondary text-xs py-1.5 px-3" data-status="completed">Completed</button>
      </div>
      <button class="btn-primary text-sm" id="new-defect-btn">+ New Defect</button>
    </div>
    <div id="defect-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <div id="defect-modal" class="hidden fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div class="card bg-white p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto" id="defect-modal-body"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(function(){ load(''); });
      document.getElementById('defect-filters').addEventListener('click', function (e) {
        if (e.target.dataset.status !== undefined) load(e.target.dataset.status);
      });
      async function load(status) {
        const list = await PMHub.api('/defects' + (status ? '?status=' + status : ''));
        const host = document.getElementById('defect-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(d =>
          '<button class="w-full text-left p-4 flex items-center justify-between hover:bg-slate-50 open-defect" data-id="' + d.id + '"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(d.category) + (d.unitNumber ? ' · Unit ' + d.unitNumber : '') + '</div><div class="text-xs text-slate-400 mt-0.5">' + PMHub.escapeHtml((d.description||'').slice(0,70)) + '</div></div><div class="flex items-center gap-2">' + PMHub.statusChip(d.risk_level) + PMHub.statusChip(d.status) + '</div></button>'
        ).join('') + '</div>' : PMHub.emptyState('No defects found.', 'fa-screwdriver-wrench');
        host.querySelectorAll('.open-defect').forEach(function (btn) { btn.addEventListener('click', function () { openDefect(btn.dataset.id); }); });
      }
      const TRANSITIONS = {
        new: ['bm_assessment'], bm_assessment: ['minor_repair','contractor_required'],
        minor_repair: ['awaiting_verification','completed'], contractor_required: ['awaiting_approval','approved','contractor_booked'],
        awaiting_approval: ['approved','bm_assessment'], approved: ['contractor_booked'], contractor_booked: ['in_progress'],
        in_progress: ['awaiting_verification'], awaiting_verification: ['completed','in_progress'], completed: ['closed'], closed: [],
      };
      async function openDefect(id) {
        const data = await PMHub.api('/defects/' + id);
        const d = data.defect;
        const modal = document.getElementById('defect-modal');
        const body = document.getElementById('defect-modal-body');
        const nextOptions = (TRANSITIONS[d.status] || []).map(function(s){ return '<option value="' + s + '">' + s.replace(/_/g,' ') + '</option>'; }).join('');
        body.innerHTML = '<div class="flex items-center justify-between mb-4"><h3 class="font-semibold text-lg text-slate-800">' + PMHub.escapeHtml(d.category) + '</h3><button id="close-modal" class="text-slate-400 hover:text-slate-700"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="flex gap-2 mb-3">' + PMHub.statusChip(d.risk_level) + PMHub.statusChip(d.status) + '</div>' +
          '<p class="text-sm text-slate-600 mb-4">' + PMHub.escapeHtml(d.description) + '</p>' +
          (nextOptions ? '<div class="mb-3"><label class="field-label">Move to status</label><select id="dm-status" class="field-input">' + nextOptions + '</select><button class="btn-primary mt-2 w-full" id="dm-transition">Update Status</button></div>' : '') +
          (d.status === 'completed' ? '<button class="btn-secondary w-full mb-2" id="dm-verify"><i class="fa-solid fa-check mr-1"></i>Verify Completion</button><button class="btn-primary w-full" id="dm-close">Close Defect</button>' : '') +
          '<div id="dm-error" class="hidden text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3"></div>';
        modal.classList.remove('hidden');
        document.getElementById('close-modal').addEventListener('click', function(){ modal.classList.add('hidden'); });
        const trBtn = document.getElementById('dm-transition');
        if (trBtn) trBtn.addEventListener('click', async function () {
          try {
            await PMHub.api('/defects/' + id + '/transition', { method: 'POST', body: { toStatus: document.getElementById('dm-status').value } });
            modal.classList.add('hidden'); PMHub.toast('Defect updated.', 'success'); load('');
          } catch (err) { document.getElementById('dm-error').textContent = err.message; document.getElementById('dm-error').classList.remove('hidden'); }
        });
        const vBtn = document.getElementById('dm-verify');
        if (vBtn) vBtn.addEventListener('click', async function () {
          await PMHub.api('/defects/' + id + '/verify', { method: 'POST' });
          PMHub.toast('Defect verified.', 'success'); modal.classList.add('hidden'); load('');
        });
        const cBtn = document.getElementById('dm-close');
        if (cBtn) cBtn.addEventListener('click', async function () {
          try {
            await PMHub.api('/defects/' + id + '/close', { method: 'POST' });
            modal.classList.add('hidden'); PMHub.toast('Defect closed.', 'success'); load('');
          } catch (err) { document.getElementById('dm-error').textContent = err.message; document.getElementById('dm-error').classList.remove('hidden'); }
        });
      }
      document.getElementById('new-defect-btn').addEventListener('click', async function () {
        const category = prompt('Category (e.g. water_leak, lighting, other):', 'other');
        if (!category) return;
        const description = prompt('Description:');
        if (!description) return;
        const riskLevel = confirm('Is this high-risk / urgent?') ? 'high' : 'normal';
        await PMHub.api('/defects', { method: 'POST', body: { category, description, riskLevel } });
        PMHub.toast('Defect created.', 'success');
        load('');
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Work Orders
// ---------------------------------------------------------------------------
export const BmWorkOrders: FC = () => (
  <Shell portal="bm" active="/bm/work-orders" pageTitle="Work Orders">
    <div id="wo-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(load);
      async function load() {
        const list = await PMHub.api('/work-orders');
        const host = document.getElementById('wo-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(w =>
          '<div class="p-4 flex items-center justify-between" data-id="' + w.id + '"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(w.scope) + '</div><div class="text-xs text-slate-400 mt-0.5">' + PMHub.escapeHtml(w.contractorName || 'Unassigned') + (w.scheduled_at ? ' · ' + PMHub.fmtDateTime(w.scheduled_at) : '') + '</div></div><div class="flex items-center gap-2">' + PMHub.statusChip(w.status) + (w.status === 'completed' ? '<button class="btn-secondary text-xs py-1 px-2 verify-btn" data-id="' + w.id + '">Verify</button>' : '') + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No work orders yet.', 'fa-file-invoice');
        host.querySelectorAll('.verify-btn').forEach(function(btn){
          btn.addEventListener('click', async function(){ await PMHub.api('/work-orders/' + btn.dataset.id + '/verify', { method: 'POST' }); PMHub.toast('Work order verified.', 'success'); load(); });
        });
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Contractors (incl. QR-driven attendance & keys)
// ---------------------------------------------------------------------------
export const BmContractors: FC = () => (
  <Shell portal="bm" active="/bm/contractors" pageTitle="Contractors">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 class="font-semibold text-slate-800 mb-3">Directory</h2>
        <div id="ctr-list"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
      <div>
        <h2 class="font-semibold text-slate-800 mb-3">Today's Attendance</h2>
        <div id="attendance-list"><div class="text-sm text-slate-400">Loading…</div></div>
        <h2 class="font-semibold text-slate-800 mb-3 mt-6">Key Register</h2>
        <div id="key-list"><div class="text-sm text-slate-400">Loading…</div></div>
      </div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(function(){ loadContractors(); loadAttendance(); loadKeys(); });
      async function loadContractors() {
        const list = await PMHub.api('/contractors');
        document.getElementById('ctr-list').innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(c =>
          '<div class="p-4"><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(c.company_name) + '</div><div class="text-xs text-slate-400">' + (c.trade_category||'').replace(/_/g,' ') + ' · ' + PMHub.escapeHtml(c.contact_phone||'—') + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No contractors registered.', 'fa-helmet-safety');
      }
      async function loadAttendance() {
        const list = await PMHub.api('/attendance');
        const host = document.getElementById('attendance-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(a =>
          '<div class="p-4" data-id="' + a.id + '"><div class="flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(a.contractorName) + '</div>' + PMHub.statusChip(a.status) + '</div><div class="text-xs text-slate-400 mt-0.5">In: ' + PMHub.fmtDateTime(a.sign_in_at) + '</div>' + (a.status === 'on_site' ? '<button class="btn-secondary text-xs py-1 px-2 mt-2 signout-btn" data-id="' + a.id + '">Sign Out</button>' : '') + (a.status === 'pending_key_return' ? '<button class="btn-secondary text-xs py-1 px-2 mt-2 verify-att-btn" data-id="' + a.id + '">Verify / Close</button>' : '') + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No attendance recorded.', 'fa-qrcode');
        host.querySelectorAll('.signout-btn').forEach(function(btn){ btn.addEventListener('click', async function(){
          try { await PMHub.api('/attendance/' + btn.dataset.id + '/sign-out', { method: 'POST', body: {} }); PMHub.toast('Signed out.', 'success'); loadAttendance(); }
          catch (err) {
            if (err.code === 'KEY_OUTSTANDING') {
              const reason = prompt('Key is outstanding. Enter override reason to sign out anyway (BM authorisation):');
              if (reason) { await PMHub.api('/attendance/' + btn.dataset.id + '/sign-out', { method: 'POST', body: { overrideReason: reason } }); PMHub.toast('Signed out with override.', 'warning'); loadAttendance(); }
            } else PMHub.toast(err.message, 'error');
          }
        }); });
        host.querySelectorAll('.verify-att-btn').forEach(function(btn){ btn.addEventListener('click', async function(){ await PMHub.api('/attendance/' + btn.dataset.id + '/verify', { method: 'POST' }); PMHub.toast('Attendance closed.', 'success'); loadAttendance(); }); });
      }
      async function loadKeys() {
        const list = await PMHub.api('/keys');
        const host = document.getElementById('key-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(k =>
          '<div class="p-4 flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(k.description) + '</div>' + PMHub.statusChip(k.custody_status) + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No keys registered.', 'fa-key');
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Moves & Deliveries
// ---------------------------------------------------------------------------
export const BmMoves: FC = () => (
  <Shell portal="bm" active="/bm/moves" pageTitle="Moves & Deliveries">
    <div id="moves-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(load);
      async function load() {
        const list = await PMHub.api('/moves');
        const host = document.getElementById('moves-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(m =>
          '<div class="p-4" data-id="' + m.id + '"><div class="flex items-center justify-between"><div><div class="text-sm font-medium text-slate-800">' + m.move_type.replace(/_/g,' ') + (m.unitNumber ? ' · Unit ' + m.unitNumber : '') + '</div><div class="text-xs text-slate-400">' + PMHub.fmtDateTime(m.requested_at) + '</div></div>' + PMHub.statusChip(m.status) + '</div>' +
          (m.status === 'pending_approval' ? '<div class="flex gap-2 mt-2"><button class="btn-primary text-xs py-1 px-2 approve-btn" data-id="' + m.id + '">Approve</button><button class="btn-secondary text-xs py-1 px-2 decline-btn" data-id="' + m.id + '">Decline</button></div>' : '') +
          (m.status === 'post_move_inspection' ? '<button class="btn-secondary text-xs py-1 px-2 mt-2 close-move-btn" data-id="' + m.id + '">Mark Keys Returned & Close</button>' : '') +
          '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No move bookings yet.', 'fa-truck-fast');
        host.querySelectorAll('.approve-btn').forEach(function(btn){ btn.addEventListener('click', async function(){ await PMHub.api('/moves/' + btn.dataset.id + '/decide', { method: 'POST', body: { decision: 'approved' } }); PMHub.toast('Move approved.', 'success'); load(); }); });
        host.querySelectorAll('.decline-btn').forEach(function(btn){ btn.addEventListener('click', async function(){ const reason = prompt('Decline reason:'); if (reason===null) return; await PMHub.api('/moves/' + btn.dataset.id + '/decide', { method: 'POST', body: { decision: 'declined', reason } }); PMHub.toast('Move declined.', 'info'); load(); }); });
        host.querySelectorAll('.close-move-btn').forEach(function(btn){ btn.addEventListener('click', async function(){
          try { await PMHub.api('/moves/' + btn.dataset.id + '/close', { method: 'POST', body: { keysReturned: true } }); PMHub.toast('Move closed.', 'success'); load(); }
          catch (err) { PMHub.toast(err.message, 'error'); }
        }); });
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Residents & Units
// ---------------------------------------------------------------------------
export const BmUnits: FC = () => (
  <Shell portal="bm" active="/bm/units" pageTitle="Residents & Units">
    <div id="units-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function (me) {
        const props = await PMHub.api('/properties');
        const propertyId = me.propertyScope || (props[0] && props[0].id);
        const units = await PMHub.api('/properties/' + propertyId + '/units');
        const host = document.getElementById('units-list');
        host.innerHTML = units.length ? '<div class="card divide-y divide-slate-100">' + units.map(u =>
          '<div class="p-4 flex items-center justify-between"><div class="text-sm font-medium text-slate-800">Unit ' + PMHub.escapeHtml(u.unit_number) + '</div><div class="text-xs text-slate-500 text-right"><div>Owner: ' + PMHub.escapeHtml(u.ownerName || '—') + '</div><div>Tenant: ' + PMHub.escapeHtml(u.tenantName || '—') + '</div></div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No units found.', 'fa-building-user');
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Access Devices & Keys
// ---------------------------------------------------------------------------
export const BmAccessDevices: FC = () => (
  <Shell portal="bm" active="/bm/access-devices" pageTitle="Access Devices & Keys">
    <h2 class="font-semibold text-slate-800 mb-3">Pending Requests</h2>
    <div id="adr-list" class="mb-8"><div class="text-sm text-slate-400">Loading…</div></div>
    <h2 class="font-semibold text-slate-800 mb-3">Issued Devices</h2>
    <div id="dev-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      const NEXT = { submitted: ['awaiting_authorisation','approved','declined'], awaiting_authorisation: ['approved','declined'], approved: ['programming'], programming: ['ready_for_collection'], ready_for_collection: ['issued'] };
      PMHub.initShell().then(function(){ loadRequests(); loadDevices(); });
      async function loadRequests() {
        const list = await PMHub.api('/access-device-requests');
        const host = document.getElementById('adr-list');
        const pending = list.filter(function(r){ return r.status !== 'issued' && r.status !== 'declined'; });
        host.innerHTML = pending.length ? '<div class="card divide-y divide-slate-100">' + pending.map(r => {
          const options = (NEXT[r.status]||[]).map(function(s){ return '<option value="' + s + '">' + s.replace(/_/g,' ') + '</option>'; }).join('');
          return '<div class="p-4"><div class="flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + r.request_type.replace(/_/g,' ') + (r.unitNumber ? ' · Unit ' + r.unitNumber : '') + '</div>' + PMHub.statusChip(r.status) + '</div>' +
            (options ? '<div class="flex gap-2 mt-2"><select class="field-input text-xs py-1" id="sel-' + r.id + '">' + options + '</select><button class="btn-secondary text-xs py-1 px-2 tr-btn" data-id="' + r.id + '">Update</button></div>' : '') +
            (r.status === 'ready_for_collection' ? '<button class="btn-primary text-xs py-1 px-2 mt-2 issue-btn" data-id="' + r.id + '">Record Issue</button>' : '') + '</div>';
        }).join('') + '</div>' : PMHub.emptyState('No pending access device requests.', 'fa-key');
        host.querySelectorAll('.tr-btn').forEach(function(btn){ btn.addEventListener('click', async function(){
          const toStatus = document.getElementById('sel-' + btn.dataset.id).value;
          await PMHub.api('/access-device-requests/' + btn.dataset.id + '/transition', { method: 'POST', body: { toStatus } });
          PMHub.toast('Request updated.', 'success'); loadRequests();
        }); });
        host.querySelectorAll('.issue-btn').forEach(function(btn){ btn.addEventListener('click', async function(){
          const serialNumber = prompt('Serial number:'); if (!serialNumber) return;
          const collectedBy = prompt('Collected by (name):'); if (!collectedBy) return;
          await PMHub.api('/access-device-requests/' + btn.dataset.id + '/issue', { method: 'POST', body: { serialNumber, deviceType: 'fob', collectedBy } });
          PMHub.toast('Device issued.', 'success'); loadRequests(); loadDevices();
        }); });
      }
      async function loadDevices() {
        const list = await PMHub.api('/access-devices');
        const host = document.getElementById('dev-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(d =>
          '<div class="p-4 flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + (d.device_type||'').replace(/_/g,' ') + ' · ' + PMHub.escapeHtml(d.serial_number||'—') + (d.unitNumber ? ' · Unit ' + d.unitNumber : '') + '</div>' + PMHub.statusChip(d.status) + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No devices issued yet.', 'fa-key');
      }
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Incidents & Security
// ---------------------------------------------------------------------------
export const BmIncidents: FC = () => (
  <Shell portal="bm" active="/bm/incidents" pageTitle="Incidents & Security">
    <div class="flex justify-end mb-4">
      <button class="btn-primary text-sm" id="new-incident-btn">+ Report Incident</button>
    </div>
    <div id="incident-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(load);
      async function load() {
        const list = await PMHub.api('/incidents');
        const host = document.getElementById('incident-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(i =>
          '<div class="p-4" data-id="' + i.id + '"><div class="flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + (i.category||'').replace(/_/g,' ') + '</div><div class="flex gap-2">' + PMHub.statusChip(i.severity) + PMHub.statusChip(i.status) + '</div></div><div class="text-xs text-slate-400 mt-1">' + PMHub.escapeHtml((i.description||'').slice(0,80)) + '</div>' + (i.status !== 'closed' ? '<button class="btn-secondary text-xs py-1 px-2 mt-2 close-btn" data-id="' + i.id + '">Close</button>' : '') + '</div>'
        ).join('') + '</div>' : PMHub.emptyState('No incidents recorded.', 'fa-shield-halved');
        host.querySelectorAll('.close-btn').forEach(function(btn){ btn.addEventListener('click', async function(){ await PMHub.api('/incidents/' + btn.dataset.id + '/close', { method: 'POST' }); PMHub.toast('Incident closed.', 'success'); load(); }); });
      }
      document.getElementById('new-incident-btn').addEventListener('click', async function () {
        const category = prompt('Category (e.g. water_leak, power_loss, fire_system_fault):'); if (!category) return;
        const description = prompt('Description:'); if (!description) return;
        const severity = confirm('High severity?') ? 'high' : 'normal';
        const temp = prompt('Temporary repair notes (leave blank if none — this auto-creates a permanent follow-up defect if filled):') || undefined;
        await PMHub.api('/incidents', { method: 'POST', body: { category, description, severity, temporaryRepairNotes: temp } });
        PMHub.toast('Incident recorded.', 'success'); load();
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// By-law Observations
// ---------------------------------------------------------------------------
export const BmBylaws: FC = () => (
  <Shell portal="bm" active="/bm/bylaws" pageTitle="By-law Observations">
    <div class="flex justify-end mb-4">
      <button class="btn-primary text-sm" id="new-bylaw-btn">+ Record Observation</button>
    </div>
    <div id="bylaw-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(load);
      async function load() {
        const list = await PMHub.api('/bylaw-observations');
        const host = document.getElementById('bylaw-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(o =>
          '<div class="p-4"><div class="flex items-center justify-between"><div class="text-sm font-medium text-slate-800">' + (o.category||'').replace(/_/g,' ') + '</div>' + PMHub.statusChip(o.strata_outcome) + '</div><div class="text-xs text-slate-400 mt-1">' + PMHub.escapeHtml(o.observation) + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No by-law observations recorded.', 'fa-gavel');
      }
      document.getElementById('new-bylaw-btn').addEventListener('click', async function () {
        const category = prompt('Category (e.g. storage_in_bays, parking_vehicle, obstruction):'); if (!category) return;
        const observation = prompt('Observation notes:'); if (!observation) return;
        await PMHub.api('/bylaw-observations', { method: 'POST', body: { category, observation } });
        PMHub.toast('Observation recorded and sent to Strata for decision.', 'success'); load();
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
export const BmCalendar: FC = () => (
  <Shell portal="bm" active="/bm/calendar" pageTitle="Calendar">
    <div id="cal-list"><div class="text-sm text-slate-400">Loading…</div></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function () {
        const list = await PMHub.api('/calendar');
        const host = document.getElementById('cal-list');
        host.innerHTML = list.length ? '<div class="card divide-y divide-slate-100">' + list.map(e =>
          '<div class="p-4 flex items-center justify-between"><div><div class="text-sm font-medium text-slate-800">' + PMHub.escapeHtml(e.title) + '</div><div class="text-xs text-slate-400">' + (e.event_type||'').replace(/_/g,' ') + '</div></div><div class="text-sm text-slate-600">' + PMHub.fmtDateTime(e.starts_at) + '</div></div>'
        ).join('') + '</div>' : PMHub.emptyState('No events scheduled.', 'fa-calendar-days');
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export const BmReports: FC = () => (
  <Shell portal="bm" active="/bm/reports" pageTitle="Reports">
    <div class="card p-6" id="report-body">
      <div class="text-sm text-slate-400">Loading…</div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell().then(async function (me) {
        const month = new Date().toISOString().slice(0,7);
        const props = await PMHub.api('/properties');
        const propertyId = me.propertyScope || (props[0] && props[0].id);
        const r = await PMHub.api('/reports/monthly?propertyId=' + propertyId + '&month=' + month);
        const s = r.sections;
        document.getElementById('report-body').innerHTML =
          '<h2 class="font-semibold text-lg text-slate-800 mb-4">Monthly Report — ' + r.month + '</h2>' +
          section('Maintenance & Defects', s.maintenanceDefects.length + ' logged this month') +
          section('Work Orders', s.workOrders.length + ' created this month') +
          section('Contractor Visits', s.contractors.length + ' recorded') +
          section('Resident Moves', s.residentMovesInductions.length + ' bookings') +
          section('Security Incidents', s.securityIncidents.length + ' reported') +
          section('By-law Observations', s.bylawObservations.length + ' recorded') +
          section('Approvals Awaiting Decision', (s.approvalsAwaitingDecision.count||0) + ' quotes, total $' + (s.approvalsAwaitingDecision.totalValue||0));
        function section(title, val) {
          return '<div class="flex items-center justify-between py-2.5 border-b border-slate-100"><span class="text-sm text-slate-600">' + title + '</span><span class="text-sm font-medium text-slate-800">' + val + '</span></div>';
        }
      });
    `,
      }}
    ></script>
  </Shell>
);

// ---------------------------------------------------------------------------
// Handover
// ---------------------------------------------------------------------------
export const BmHandover: FC = () => (
  <Shell portal="bm" active="/bm/handover" pageTitle="Handover">
    <div class="card p-6">
      <p class="text-sm text-slate-600 mb-4">Compile an open-items snapshot and start a time-limited handover to a relief Building Manager.</p>
      <form id="ho-form" class="space-y-4 max-w-md">
        <div>
          <label class="field-label">Incoming user (relief BM) ID</label>
          <input id="ho-user" class="field-input" placeholder="user_..." />
        </div>
        <div>
          <label class="field-label">Access expires at</label>
          <input id="ho-expires" type="datetime-local" class="field-input" />
        </div>
        <button type="submit" class="btn-primary">Create Handover</button>
      </form>
      <div id="ho-result" class="mt-6"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
      PMHub.initShell();
      document.getElementById('ho-form').addEventListener('submit', async function (e) {
        e.preventDefault();
        try {
          const res = await PMHub.api('/handovers', { method: 'POST', body: {
            incomingUserId: document.getElementById('ho-user').value,
            accessExpiresAt: new Date(document.getElementById('ho-expires').value).toISOString(),
          }});
          const s = res.snapshot;
          document.getElementById('ho-result').innerHTML = '<div class="card p-4 bg-green-50 border-green-200"><div class="font-medium text-green-800 mb-2">Handover created</div>' +
            '<div class="text-sm text-slate-600">Open defects: ' + s.openDefects.length + '</div>' +
            '<div class="text-sm text-slate-600">Overdue maintenance: ' + s.overdueMaintenance.length + '</div>' +
            '<div class="text-sm text-slate-600">Contractor bookings: ' + s.contractorBookings.length + '</div>' +
            '<div class="text-sm text-slate-600">Quotes pending: ' + s.quotesPending.length + '</div>' +
            '<div class="text-sm text-slate-600">Upcoming moves: ' + s.upcomingMoves.length + '</div>' +
            '<div class="text-sm text-slate-600">Open incidents: ' + s.openIncidents.length + '</div></div>';
          PMHub.toast('Handover created.', 'success');
        } catch (err) { PMHub.toast(err.message, 'error'); }
      });
    `,
      }}
    ></script>
  </Shell>
);
