import type { FC } from 'hono/jsx';
import { Shell } from './layout';

// Contractor portal — 2 pages: QR-based sign-in/out check-in flow, and
// assigned work list. Same shared-runtime pattern as the other portals.

export const ContractorCheckIn: FC = () => (
  <Shell portal="contractor" active="/contractor" pageTitle="Check-in">
    <div id="ctr-info" class="bg-white rounded-xl border border-slate-200 p-4 mb-4"></div>

    <div id="signin-panel" class="bg-white rounded-xl border border-slate-200 p-4 mb-4 hidden">
      <h2 class="font-semibold mb-3">Sign In</h2>
      <form id="signin-form" class="grid gap-3 max-w-md">
        <input id="si-property" placeholder="Property ID" class="border rounded-lg px-3 py-2" />
        <input id="si-workorder" placeholder="Work Order ID (optional)" class="border rounded-lg px-3 py-2" />
        <input id="si-purpose" placeholder="Purpose of visit" class="border rounded-lg px-3 py-2" />
        <button class="bg-blue-700 text-white rounded-lg px-4 py-2 font-medium">Sign In On Site</button>
      </form>
    </div>

    <div id="active-panel" class="bg-white rounded-xl border border-slate-200 p-4 hidden">
      <h2 class="font-semibold mb-3">Currently On Site</h2>
      <div id="active-attendance"></div>
      <form id="signout-form" class="grid gap-3 max-w-md mt-4">
        <textarea id="so-report" placeholder="Service report notes" class="border rounded-lg px-3 py-2" rows={3}></textarea>
        <button class="bg-emerald-600 text-white rounded-lg px-4 py-2 font-medium">Sign Out</button>
      </form>
    </div>

    <script
      dangerouslySetInnerHTML={{
        __html: `
        let CONTRACTOR = null;
        let ACTIVE_ATTENDANCE_ID = null;

        PMHub.initShell().then(load);

        async function load() {
          CONTRACTOR = await PMHub.api('/my-contractor');
          const infoBox = document.getElementById('ctr-info');
          if (!CONTRACTOR) {
            infoBox.innerHTML = PMHub.emptyState('No contractor record is linked to your account yet. Contact the Building Manager.', 'fa-helmet-safety');
            return;
          }
          infoBox.innerHTML = \`
            <div class="font-medium">\${PMHub.escapeHtml(CONTRACTOR.company_name)}</div>
            <div class="text-sm text-slate-500">\${PMHub.escapeHtml(CONTRACTOR.trade_category)}</div>\`;

          const attendance = await PMHub.api('/attendance');
          const mine = attendance.filter(a => a.contractor_id === CONTRACTOR.id);
          const openRecord = mine.find(a => a.status === 'on_site' || a.status === 'pending_key_return');

          if (openRecord) {
            ACTIVE_ATTENDANCE_ID = openRecord.id;
            document.getElementById('signin-panel').classList.add('hidden');
            document.getElementById('active-panel').classList.remove('hidden');
            document.getElementById('active-attendance').innerHTML = \`
              <div class="text-sm">\${PMHub.statusChip(openRecord.status)} · Signed in \${PMHub.fmtDateTime(openRecord.sign_in_at)}</div>
              \${openRecord.key_issued ? '<div class="text-xs text-amber-600 mt-1"><i class="fa-solid fa-key"></i> A key is currently issued to you — return it to the Building Manager before signing out.</div>' : ''}\`;
          } else {
            document.getElementById('signin-panel').classList.remove('hidden');
            document.getElementById('active-panel').classList.add('hidden');
          }
        }

        document.getElementById('signin-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!CONTRACTOR) return;
          try {
            await PMHub.api('/attendance/sign-in', { method: 'POST', body: {
              propertyId: document.getElementById('si-property').value || undefined,
              contractorId: CONTRACTOR.id,
              workOrderId: document.getElementById('si-workorder').value || undefined,
              purpose: document.getElementById('si-purpose').value || undefined,
            }});
            PMHub.toast('Signed in on site.');
            load();
          } catch (err) { PMHub.toast(err.message, 'error'); }
        });

        document.getElementById('signout-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!ACTIVE_ATTENDANCE_ID) return;
          try {
            await attemptSignOut();
          } catch (err) {
            if (err.code === 'KEY_OUTSTANDING') {
              const reason = prompt('A key is outstanding. Enter an override reason to sign out anyway, or Cancel to return the key first:');
              if (reason) {
                try { await attemptSignOut(reason); } catch (e2) { PMHub.toast(e2.message, 'error'); }
              }
            } else {
              PMHub.toast(err.message, 'error');
            }
          }
        });

        async function attemptSignOut(overrideReason) {
          await PMHub.api('/attendance/' + ACTIVE_ATTENDANCE_ID + '/sign-out', { method: 'POST', body: {
            serviceReportR2Key: undefined,
            overrideReason: overrideReason || undefined,
          }});
          PMHub.toast('Signed out.');
          document.getElementById('so-report').value = '';
          load();
        }
      `,
      }}
    ></script>
  </Shell>
);

export const ContractorWork: FC = () => (
  <Shell portal="contractor" active="/contractor/work" pageTitle="Assigned Work">
    <div id="ctr-work-list"></div>
    <script
      dangerouslySetInnerHTML={{
        __html: `
        PMHub.initShell().then(load);
        async function load() {
          const contractor = await PMHub.api('/my-contractor');
          const list = document.getElementById('ctr-work-list');
          if (!contractor) {
            list.innerHTML = PMHub.emptyState('No contractor record is linked to your account yet.', 'fa-file-invoice');
            return;
          }
          const orders = await PMHub.api('/work-orders?contractorId=' + contractor.id);
          list.innerHTML = orders.length ? orders.map(o => \`
            <div class="border border-slate-200 rounded-lg p-3 mb-2 bg-white" data-id="\${o.id}">
              <div class="flex items-center justify-between">
                <div>
                  <div class="font-medium">\${PMHub.escapeHtml(o.title || o.description || 'Work order')}</div>
                  <div class="text-xs text-slate-500">\${PMHub.statusChip(o.status)} · \${PMHub.fmtDate(o.created_at)}</div>
                </div>
                \${o.status === 'in_progress' ? '<button class="btn-complete bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-sm">Mark Complete</button>' : ''}
              </div>
            </div>\`).join('') : PMHub.emptyState('No work orders assigned to you.', 'fa-file-invoice');
          list.querySelectorAll('.btn-complete').forEach(btn => btn.addEventListener('click', async () => {
            const id = btn.closest('[data-id]').dataset.id;
            try {
              await PMHub.api('/work-orders/' + id + '/complete', { method: 'POST', body: {} });
              PMHub.toast('Work order marked complete.');
              load();
            } catch (e) { PMHub.toast(e.message, 'error'); }
          }));
        }
      `,
      }}
    ></script>
  </Shell>
);
