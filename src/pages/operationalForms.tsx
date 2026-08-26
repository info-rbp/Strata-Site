import type { FC } from 'hono/jsx';
import { Shell } from './layout';

export const BuildingManagerForms: FC = () => (
  <Shell portal="bm" active="/bm/forms" pageTitle="Quick Forms">
    <div class="max-w-5xl mx-auto">
      <div id="forms-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading field forms…
      </div>

      <section id="forms-hub" class="hidden">
        <div class="mb-5">
          <h1 class="text-xl font-semibold text-slate-900">Record what happened while it is still fresh</h1>
          <p class="text-sm text-slate-500 mt-1">
            Short field forms feed the operational registers and monthly Building Management Report.
          </p>
        </div>
        <div id="forms-property-row" class="hidden card p-4 mb-4">
          <label class="field-label" for="forms-property">Property</label>
          <select id="forms-property" class="field-input max-w-md"></select>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" id="quick-form-grid">
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="daily_activity">
            <span class="icon-wrap bg-blue-50 text-blue-700"><i class="fa-solid fa-pen-to-square"></i></span>
            <span class="font-semibold text-sm text-slate-900">Daily Activity</span>
            <span class="text-xs text-slate-500">Task, communication or follow-up</span>
            <span class="text-[11px] text-slate-400">About 45 seconds</span>
          </button>
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="maintenance_defect">
            <span class="icon-wrap bg-amber-50 text-amber-700"><i class="fa-solid fa-screwdriver-wrench"></i></span>
            <span class="font-semibold text-sm text-slate-900">Maintenance / Defect</span>
            <span class="text-xs text-slate-500">Issue, risk, evidence and action</span>
            <span class="text-[11px] text-slate-400">About 75 seconds</span>
          </button>
          <a href="/bm/inspections" class="quick-form-card card p-4 text-left transition-all">
            <span class="icon-wrap bg-emerald-50 text-emerald-700"><i class="fa-solid fa-clipboard-check"></i></span>
            <span class="font-semibold text-sm text-slate-900">Building Inspection</span>
            <span class="text-xs text-slate-500">Structured route and exceptions</span>
            <span class="text-[11px] text-slate-400">Mobile checklist</span>
          </a>
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="waste_activity">
            <span class="icon-wrap bg-lime-50 text-lime-700"><i class="fa-solid fa-recycle"></i></span>
            <span class="font-semibold text-sm text-slate-900">Waste Log</span>
            <span class="text-xs text-slate-500">Routine task or waste exception</span>
            <span class="text-[11px] text-slate-400">About 35 seconds</span>
          </button>
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="incident">
            <span class="icon-wrap bg-red-50 text-red-700"><i class="fa-solid fa-shield-halved"></i></span>
            <span class="font-semibold text-sm text-slate-900">Incident / Security</span>
            <span class="text-xs text-slate-500">Incident, CCTV and escalation</span>
            <span class="text-[11px] text-slate-400">About 90 seconds</span>
          </button>
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="bylaw_observation">
            <span class="icon-wrap bg-purple-50 text-purple-700"><i class="fa-solid fa-gavel"></i></span>
            <span class="font-semibold text-sm text-slate-900">By-law Observation</span>
            <span class="text-xs text-slate-500">Objective record for Strata</span>
            <span class="text-[11px] text-slate-400">About 45 seconds</span>
          </button>
          <button type="button" class="quick-form-card card p-4 text-left transition-all" data-form="resident_induction">
            <span class="icon-wrap bg-cyan-50 text-cyan-700"><i class="fa-solid fa-person-circle-check"></i></span>
            <span class="font-semibold text-sm text-slate-900">Resident Induction</span>
            <span class="text-xs text-slate-500">Briefing, tour and acknowledgement</span>
            <span class="text-[11px] text-slate-400">About 90 seconds</span>
          </button>
          <a href="/bm/reports" class="quick-form-card card p-4 text-left transition-all">
            <span class="icon-wrap bg-slate-100 text-slate-700"><i class="fa-solid fa-chart-line"></i></span>
            <span class="font-semibold text-sm text-slate-900">Monthly Report</span>
            <span class="text-xs text-slate-500">Review captured content by section</span>
            <span class="text-[11px] text-slate-400">Generated from registers</span>
          </a>
        </div>
        <div class="card p-4 mt-5">
          <div class="flex items-center justify-between gap-3 mb-2">
            <h2 class="font-semibold text-sm text-slate-900">Recent field submissions</h2>
            <button id="refresh-submissions" type="button" class="btn-quiet text-xs"><i class="fa-solid fa-rotate"></i>Refresh</button>
          </div>
          <div id="recent-submissions" class="text-sm text-slate-500">Loading…</div>
        </div>
      </section>

      <section id="form-workspace" class="hidden">
        <div class="flex items-center justify-between gap-3 mb-4 no-print">
          <button id="forms-back" type="button" class="btn-secondary"><i class="fa-solid fa-arrow-left"></i>All forms</button>
          <div id="draft-indicator" class="text-xs text-slate-400"></div>
        </div>
        <div class="card mobile-full p-4 sm:p-6">
          <div class="mb-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h1 id="active-form-title" class="text-xl font-semibold text-slate-900"></h1>
                <p id="active-form-description" class="text-sm text-slate-500 mt-1"></p>
              </div>
              <span id="active-form-duration" class="status-chip status-routine shrink-0"></span>
            </div>
          </div>
          <div id="active-form-host"></div>
        </div>
      </section>
    </div>
    <script src="/static/operations-forms.js"></script>
  </Shell>
);
