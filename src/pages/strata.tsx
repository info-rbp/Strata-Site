import type { FC } from 'hono/jsx';
import { Shell } from './layout';

// Strata / Administration portal — 11 pages. Same pattern as resident.tsx /
// bm.tsx: server-rendered Shell + inline client script driven by the shared
// window.PMHub runtime (public/static/app.js). No client bundler/build step.

export const StrataDashboard: FC = () => (
  <Shell portal="strata" active="/strata" pageTitle="Dashboard">
    <div id="strata-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>
    <div class="grid md:grid-cols-2 gap-4">
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Defects &amp; Maintenance</h2>
        <div id="strata-defects-summary" class="text-sm text-slate-600"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Approvals</h2>
        <div id="strata-approvals-summary" class="text-sm text-slate-600"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Contractors</h2>
        <div id="strata-contractors-summary" class="text-sm text-slate-600"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Residents &amp; Moves</h2>
        <div id="strata-residents-summary" class="text-sm text-slate-600"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Security &amp; Incidents</h2>
        <div id="strata-security-summary" class="text-sm text-slate-600"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Operations</h2>
        <div id="strata-operations-summary" class="text-sm text-slate-600"></div>
      </section>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(async () => {
          const d = await PMHub.api('/dashboard/strata');
          const stats = [
            ['Open Defects', d.defects?.open ?? 0, 'fa-screwdriver-wrench', 'text-amber-600'],
            ['High Risk', d.defects?.highRisk ?? 0, 'fa-triangle-exclamation', 'text-red-600'],
            ['Awaiting Decision', d.approvals?.awaitingDecision ?? 0, 'fa-stamp', 'text-blue-600'],
            ['Open Incidents', d.security?.openIncidents ?? 0, 'fa-shield-halved', 'text-red-600'],
          ];
          document.getElementById('strata-stats').innerHTML = stats.map(([label, val, icon, color]) => \`
            <div class="bg-white rounded-xl border border-slate-200 p-4">
              <div class="flex items-center justify-between">
                <div class="text-2xl font-bold \${color}">\${val}</div>
                <i class="fa-solid \${icon} \${color} opacity-60"></i>
              </div>
              <div class="text-xs text-slate-500 mt-1">\${label}</div>
            </div>\`).join('');
          document.getElementById('strata-defects-summary').innerHTML =
            \`Open: <b>\${d.defects?.open ?? 0}</b> · High risk: <b>\${d.defects?.highRisk ?? 0}</b> · Overdue: <b>\${d.defects?.overdue ?? 0}</b>\`;
          document.getElementById('strata-approvals-summary').innerHTML =
            \`Awaiting decision: <b>\${d.approvals?.awaitingDecision ?? 0}</b> · Total value: <b>$\${(d.approvals?.totalValue ?? 0).toLocaleString()}</b>\`;
          document.getElementById('strata-contractors-summary').innerHTML =
            \`On site: <b>\${d.contractors?.openAttendance ?? 0}</b> · Missing reports: <b>\${d.contractors?.missingReports ?? 0}</b>\`;
          document.getElementById('strata-residents-summary').innerHTML =
            \`Moves this month: <b>\${d.residents?.movesThisMonth ?? 0}</b> · Pending approval: <b>\${d.residents?.pendingApproval ?? 0}</b>\`;
          document.getElementById('strata-security-summary').innerHTML =
            \`Open incidents: <b>\${d.security?.openIncidents ?? 0}</b> · Lost devices: <b>\${d.security?.lostDevices ?? 0}</b>\`;
          document.getElementById('strata-operations-summary').innerHTML =
            \`Waste exceptions: <b>\${d.waste?.exceptions ?? 0}</b> · Overdue tasks: <b>\${d.operations?.overdueTasks ?? 0}</b>\`;
        });
      `,
      }}
    ></script>
  </Shell>
);

export const StrataApprovals: FC = () => (
  <Shell portal="strata" active="/strata/approvals" pageTitle="Approvals">
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <h2 class="font-semibold mb-3">Quotes awaiting decision</h2>
      <div id="appr-list"></div>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 p-4 mt-4">
      <h2 class="font-semibold mb-3">Decision history</h2>
      <div id="appr-history"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const [quotes, history] = await Promise.all([
            PMHub.api('/quotes?status=submitted'),
            PMHub.api('/quotes?status=recommended'),
          ]);
          const pending = [...quotes, ...history];
          const list = document.getElementById('appr-list');
          if (!pending.length) { list.innerHTML = PMHub.emptyState('No quotes awaiting a decision.', 'fa-stamp'); }
          else {
            list.innerHTML = pending.map(q => \`
              <div class="border border-slate-200 rounded-lg p-3 mb-2" data-id="\${q.id}">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="font-medium">\${PMHub.escapeHtml(q.contractorName || 'Contractor quote')} — $\${Number(q.amount).toLocaleString()}</div>
                    <div class="text-xs text-slate-500">\${PMHub.statusChip(q.status)} · Submitted \${PMHub.fmtDate(q.created_at)}</div>
                    \${q.bm_recommendation ? \`<div class="text-sm text-slate-600 mt-1">BM recommendation: \${PMHub.escapeHtml(q.bm_recommendation)}</div>\` : ''}
                  </div>
                  <div class="flex gap-2">
                    <button class="btn-decide bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm" data-decision="approved">Approve</button>
                    <button class="btn-decide bg-amber-500 text-white px-3 py-1.5 rounded-lg text-sm" data-decision="more_information">More Info</button>
                    <button class="btn-decide bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm" data-decision="declined">Decline</button>
                  </div>
                </div>
              </div>\`).join('');
            list.querySelectorAll('.btn-decide').forEach(btn => btn.addEventListener('click', async () => {
              const card = btn.closest('[data-id]');
              const id = card.dataset.id;
              const decision = btn.dataset.decision;
              let comments = '';
              if (decision !== 'approved') comments = prompt('Comments for this decision:') || '';
              try {
                await PMHub.api('/quotes/' + id + '/decide', { method: 'POST', body: { decision, comments } });
                PMHub.toast('Decision recorded.');
                load();
              } catch (e) { PMHub.toast(e.message, 'error'); }
            }));
          }
          const { results: approvals } = { results: await PMHub.api('/approvals') };
          document.getElementById('appr-history').innerHTML = approvals.length
            ? approvals.map(a => \`<div class="border-b border-slate-100 py-2 text-sm flex justify-between">
                <span>$\${Number(a.amount).toLocaleString()} — \${PMHub.statusChip(a.decision)}</span>
                <span class="text-slate-500">\${PMHub.fmtDate(a.decided_at)}</span></div>\`).join('')
            : PMHub.emptyState('No decisions recorded yet.', 'fa-clipboard-list');
        }
      `,
      }}
    ></script>
  </Shell>
);

export const StrataDefects: FC = () => (
  <Shell portal="strata" active="/strata/defects" pageTitle="Maintenance">
    <div class="flex gap-2 mb-4" id="sdefect-filters">
      <button class="filter-btn active" data-status="">All</button>
      <button class="filter-btn" data-status="awaiting_approval">Awaiting Approval</button>
      <button class="filter-btn" data-status="in_progress">In Progress</button>
      <button class="filter-btn" data-status="completed">Completed</button>
      <button class="filter-btn" data-status="closed">Closed</button>
    </div>
    <div id="sdefect-list"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(() => load(''));
        document.getElementById('sdefect-filters').addEventListener('click', (e) => {
          const btn = e.target.closest('.filter-btn'); if (!btn) return;
          document.querySelectorAll('#sdefect-filters .filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          load(btn.dataset.status);
        });
        async function load(status) {
          const qs = status ? '?status=' + status : '';
          const defects = await PMHub.api('/defects' + qs);
          const list = document.getElementById('sdefect-list');
          list.innerHTML = defects.length ? defects.map(d => \`
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-white">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium">\${PMHub.escapeHtml(d.category)} — \${PMHub.escapeHtml((d.description||'').slice(0,80))}</div>
                  <div class="text-xs text-slate-500">\${PMHub.statusChip(d.status)} · Risk: \${d.risk_level} · \${PMHub.fmtDate(d.created_at)}</div>
                </div>
              </div>
            </div>\`).join('') : PMHub.emptyState('No defects for this filter.', 'fa-screwdriver-wrench');
        }
      `,
      }}
    ></script>
  </Shell>
);

export const StrataContractors: FC = () => (
  <Shell portal="strata" active="/strata/contractors" pageTitle="Contractors">
    <div class="grid md:grid-cols-2 gap-4">
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Contractor Directory</h2>
        <div id="sctr-list"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Recent Attendance</h2>
        <div id="sctr-attendance"></div>
      </section>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(async () => {
          const [contractors, attendance] = await Promise.all([PMHub.api('/contractors'), PMHub.api('/attendance')]);
          document.getElementById('sctr-list').innerHTML = contractors.length ? contractors.map(c => \`
            <div class="border-b border-slate-100 py-2">
              <div class="font-medium">\${PMHub.escapeHtml(c.company_name)}</div>
              <div class="text-xs text-slate-500">\${PMHub.escapeHtml(c.trade_category)} · \${PMHub.escapeHtml(c.contact_name || '')} \${PMHub.escapeHtml(c.contact_phone || '')}</div>
            </div>\`).join('') : PMHub.emptyState('No contractors registered.', 'fa-helmet-safety');
          document.getElementById('sctr-attendance').innerHTML = attendance.length ? attendance.map(a => \`
            <div class="border-b border-slate-100 py-2 flex justify-between text-sm">
              <span>\${PMHub.escapeHtml(a.contractorName || '')}</span>
              <span>\${PMHub.statusChip(a.status)} · \${PMHub.fmtDate(a.sign_in_at)}</span>
            </div>\`).join('') : PMHub.emptyState('No attendance records yet.', 'fa-clipboard-list');
        });
      `,
      }}
    ></script>
  </Shell>
);

export const StrataMoves: FC = () => (
  <Shell portal="strata" active="/strata/moves" pageTitle="Residents & Moves">
    <div id="smoves-list"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const moves = await PMHub.api('/moves');
          const list = document.getElementById('smoves-list');
          list.innerHTML = moves.length ? moves.map(m => \`
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-white" data-id="\${m.id}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium">\${PMHub.escapeHtml(m.moveType || m.move_type)} — Unit \${PMHub.escapeHtml(m.unitNumber || '')}</div>
                  <div class="text-xs text-slate-500">\${PMHub.statusChip(m.status)} · \${PMHub.fmtDate(m.requested_at)}</div>
                </div>
                \${m.status === 'pending_approval' ? \`
                  <div class="flex gap-2">
                    <button class="btn-approve bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm">Approve</button>
                    <button class="btn-decline bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm">Decline</button>
                  </div>\` : ''}
              </div>
            </div>\`).join('') : PMHub.emptyState('No move or delivery bookings.', 'fa-truck-fast');
          list.querySelectorAll('.btn-approve, .btn-decline').forEach(btn => btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]').dataset.id;
            const approve = btn.classList.contains('btn-approve');
            try {
              await PMHub.api('/moves/' + id + '/decide', { method: 'POST', body: { approved: approve } });
              PMHub.toast(approve ? 'Move approved.' : 'Move declined.');
              load();
            } catch (e) { PMHub.toast(e.message, 'error'); }
          }));
        }
      `,
      }}
    ></script>
  </Shell>
);

export const StrataAccessDevices: FC = () => (
  <Shell portal="strata" active="/strata/access-devices" pageTitle="Access Devices">
    <div class="grid md:grid-cols-2 gap-4">
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Requests</h2>
        <div id="sadr-list"></div>
      </section>
      <section class="bg-white rounded-xl border border-slate-200 p-4">
        <h2 class="font-semibold mb-3">Issued Devices Register</h2>
        <div id="sdev-list"></div>
      </section>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(async () => {
          const [reqs, devices] = await Promise.all([PMHub.api('/access-device-requests'), PMHub.api('/access-devices')]);
          document.getElementById('sadr-list').innerHTML = reqs.length ? reqs.map(r => \`
            <div class="border-b border-slate-100 py-2 text-sm flex justify-between">
              <span>Unit \${PMHub.escapeHtml(r.unitNumber || '')} — \${PMHub.escapeHtml(r.request_type)}</span>
              <span>\${PMHub.statusChip(r.status)}</span>
            </div>\`).join('') : PMHub.emptyState('No access device requests.', 'fa-key');
          document.getElementById('sdev-list').innerHTML = devices.length ? devices.map(d => \`
            <div class="border-b border-slate-100 py-2 text-sm flex justify-between">
              <span>\${PMHub.escapeHtml(d.serial_number || d.id)}</span>
              <span>\${PMHub.statusChip(d.status)}</span>
            </div>\`).join('') : PMHub.emptyState('No devices issued yet.', 'fa-shield-halved');
        });
      `,
      }}
    ></script>
  </Shell>
);

export const StrataIncidents: FC = () => (
  <Shell portal="strata" active="/strata/incidents" pageTitle="Incidents">
    <div id="sinc-list"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const incidents = await PMHub.api('/incidents');
          const list = document.getElementById('sinc-list');
          list.innerHTML = incidents.length ? incidents.map(i => \`
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-white" data-id="\${i.id}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium">\${PMHub.escapeHtml(i.category)} \${i.severity === 'high' ? '<span class=\\'text-red-600 text-xs font-semibold ml-1\\'>HIGH</span>' : ''}</div>
                  <div class="text-sm text-slate-600">\${PMHub.escapeHtml(i.description || '')}</div>
                  <div class="text-xs text-slate-500">\${PMHub.statusChip(i.status)} · \${PMHub.fmtDate(i.created_at)}</div>
                </div>
                \${i.status !== 'closed' ? '<button class="btn-close bg-slate-700 text-white px-3 py-1.5 rounded-lg text-sm">Close</button>' : ''}
              </div>
            </div>\`).join('') : PMHub.emptyState('No incidents recorded.', 'fa-shield-halved');
          list.querySelectorAll('.btn-close').forEach(btn => btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]').dataset.id;
            try { await PMHub.api('/incidents/' + id + '/close', { method: 'POST' }); PMHub.toast('Incident closed.'); load(); }
            catch (e) { PMHub.toast(e.message, 'error'); }
          }));
        }
      `,
      }}
    ></script>
  </Shell>
);

export const StrataBylaws: FC = () => (
  <Shell portal="strata" active="/strata/bylaws" pageTitle="By-law Observations">
    <div id="sbylaw-list"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        const OUTCOMES = ['information_only','resident_contact','formal_breach_action','no_action','monitor'];
        PMHub.initShell().then(load);
        async function load() {
          const rows = await PMHub.api('/bylaw-observations');
          const list = document.getElementById('sbylaw-list');
          list.innerHTML = rows.length ? rows.map(o => \`
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-white" data-id="\${o.id}">
              <div class="font-medium">\${PMHub.escapeHtml(o.category)}</div>
              <div class="text-sm text-slate-600">\${PMHub.escapeHtml(o.observation)}</div>
              <div class="text-xs text-slate-500 mb-2">\${PMHub.fmtDate(o.created_at)} \${o.strata_outcome ? '· Outcome: ' + PMHub.escapeHtml(o.strata_outcome) : ''}</div>
              \${!o.strata_outcome ? \`
                <select class="outcome-select border rounded px-2 py-1 text-sm mr-2">
                  \${OUTCOMES.map(x => '<option value="' + x + '">' + x.replace(/_/g,' ') + '</option>').join('')}
                </select>
                <button class="btn-decide bg-blue-700 text-white px-3 py-1 rounded-lg text-sm">Record Outcome</button>\` : ''}
            </div>\`).join('') : PMHub.emptyState('No by-law observations recorded.', 'fa-gavel');
          list.querySelectorAll('.btn-decide').forEach(btn => btn.addEventListener('click', async () => {
            const card = btn.closest('[data-id]');
            const outcome = card.querySelector('.outcome-select').value;
            try {
              await PMHub.api('/bylaw-observations/' + card.dataset.id + '/decide', { method: 'POST', body: { outcome } });
              PMHub.toast('Outcome recorded.'); load();
            } catch (e) { PMHub.toast(e.message, 'error'); }
          }));
        }
      `,
      }}
    ></script>
  </Shell>
);

export const StrataNotices: FC = () => (
  <Shell portal="strata" active="/strata/notices" pageTitle="Notices">
    <div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
      <h2 class="font-semibold mb-3">Publish a Notice</h2>
      <form id="notice-form" class="grid gap-3 max-w-lg">
        <input id="nf-title" required placeholder="Title" class="border rounded-lg px-3 py-2" />
        <textarea id="nf-body" required placeholder="Notice content" class="border rounded-lg px-3 py-2" rows={4}></textarea>
        <select id="nf-audience" class="border rounded-lg px-3 py-2">
          <option value="all">All residents</option>
          <option value="owners">Owners only</option>
          <option value="tenants">Tenants only</option>
        </select>
        <button class="bg-blue-700 text-white rounded-lg px-4 py-2 font-medium">Publish</button>
      </form>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <h2 class="font-semibold mb-3">Published Notices</h2>
      <div id="notice-list"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const notices = await PMHub.api('/notices');
          document.getElementById('notice-list').innerHTML = notices.length ? notices.map(n => \`
            <div class="border-b border-slate-100 py-2">
              <div class="font-medium">\${PMHub.escapeHtml(n.title)}</div>
              <div class="text-sm text-slate-600">\${PMHub.escapeHtml(n.body)}</div>
              <div class="text-xs text-slate-500">\${PMHub.fmtDate(n.published_at)}</div>
            </div>\`).join('') : PMHub.emptyState('No notices published yet.', 'fa-bullhorn');
        }
        document.getElementById('notice-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await PMHub.api('/notices', { method: 'POST', body: {
              title: document.getElementById('nf-title').value,
              body: document.getElementById('nf-body').value,
              audience: document.getElementById('nf-audience').value,
            }});
            e.target.reset();
            PMHub.toast('Notice published.');
            load();
          } catch (err) { PMHub.toast(err.message, 'error'); }
        });
      `,
      }}
    ></script>
  </Shell>
);

export const StrataUsers: FC = () => (
  <Shell portal="strata" active="/strata/users" pageTitle="Users & Permissions">
    <div class="bg-white rounded-xl border border-slate-200 p-4 mb-4">
      <h2 class="font-semibold mb-3">Invite User</h2>
      <form id="user-form" class="grid md:grid-cols-2 gap-3 max-w-2xl">
        <input id="uf-email" required type="email" placeholder="Email" class="border rounded-lg px-3 py-2" />
        <input id="uf-name" required placeholder="Full name" class="border rounded-lg px-3 py-2" />
        <select id="uf-role" class="border rounded-lg px-3 py-2">
          <option value="building_manager">Building Manager</option>
          <option value="relief_building_manager">Relief Building Manager</option>
          <option value="strata_manager">Strata Manager</option>
          <option value="council_member">Council Member</option>
          <option value="system_administrator">System Administrator</option>
          <option value="contractor">Contractor</option>
          <option value="resident">Resident</option>
        </select>
        <input id="uf-temp-password" required placeholder="Temporary password" class="border rounded-lg px-3 py-2" />
        <button class="bg-blue-700 text-white rounded-lg px-4 py-2 font-medium md:col-span-2">Send Invite</button>
      </form>
    </div>
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <h2 class="font-semibold mb-3">All Users</h2>
      <div id="user-list"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const users = await PMHub.api('/users');
          document.getElementById('user-list').innerHTML = users.length ? users.map(u => \`
            <div class="border-b border-slate-100 py-2 flex items-center justify-between" data-id="\${u.id}">
              <div>
                <div class="font-medium">\${PMHub.escapeHtml(u.fullName || u.email)}</div>
                <div class="text-xs text-slate-500">\${PMHub.escapeHtml(u.email)} · \${PMHub.escapeHtml(u.role)} · \${PMHub.statusChip(u.status)}</div>
              </div>
              <div class="flex gap-2">
                \${u.status === 'active'
                  ? '<button class="btn-suspend bg-red-100 text-red-700 px-3 py-1 rounded-lg text-sm">Suspend</button>'
                  : '<button class="btn-reactivate bg-emerald-100 text-emerald-700 px-3 py-1 rounded-lg text-sm">Reactivate</button>'}
              </div>
            </div>\`).join('') : PMHub.emptyState('No users found.', 'fa-users-gear');
          list_bind();
        }
        function list_bind() {
          document.querySelectorAll('.btn-suspend').forEach(btn => btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]').dataset.id;
            await PMHub.api('/users/' + id + '/suspend', { method: 'POST' }); PMHub.toast('User suspended.'); load();
          }));
          document.querySelectorAll('.btn-reactivate').forEach(btn => btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]').dataset.id;
            await PMHub.api('/users/' + id + '/reactivate', { method: 'POST' }); PMHub.toast('User reactivated.'); load();
          }));
        }
        document.getElementById('user-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await PMHub.api('/users/invite', { method: 'POST', body: {
              email: document.getElementById('uf-email').value,
              fullName: document.getElementById('uf-name').value,
              role: document.getElementById('uf-role').value,
              temporaryPassword: document.getElementById('uf-temp-password').value,
            }});
            e.target.reset();
            PMHub.toast('Invite sent.');
            load();
          } catch (err) { PMHub.toast(err.message, 'error'); }
        });
      `,
      }}
    ></script>
  </Shell>
);

export const StrataAudit: FC = () => (
  <Shell portal="strata" active="/strata/audit" pageTitle="Audit Log">
    <div class="bg-white rounded-xl border border-slate-200 p-4">
      <div id="audit-list"></div>
    </div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(async () => {
          const events = await PMHub.api('/audit');
          document.getElementById('audit-list').innerHTML = events.length ? events.map(a => \`
            <div class="border-b border-slate-100 py-2 text-sm flex justify-between">
              <span><b>\${PMHub.escapeHtml(a.action)}</b> \${PMHub.escapeHtml(a.entity_type)} by \${PMHub.escapeHtml(a.actor_role || '')}</span>
              <span class="text-slate-500">\${PMHub.fmtDateTime(a.occurred_at)}</span>
            </div>\`).join('') : PMHub.emptyState('No audit events recorded yet.', 'fa-clipboard-list');
        });
      `,
      }}
    ></script>
  </Shell>
);
