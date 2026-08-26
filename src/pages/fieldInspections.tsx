import type { FC } from 'hono/jsx';
import { Shell } from './layout';

export const BuildingManagerInspections: FC = () => (
  <Shell portal="bm" active="/bm/inspections" pageTitle="Building Inspections">
    <div class="max-w-5xl mx-auto">
      <div id="inspection-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading inspections…
      </div>

      <section id="inspection-home" class="hidden">
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
          <div class="card p-5">
            <h1 class="text-lg font-semibold text-slate-900">Start an inspection</h1>
            <p class="text-sm text-slate-500 mt-1 mb-4">Select the route. Only defects require extra typing.</p>
            <form id="start-inspection-form" class="grid gap-3">
              <div id="inspection-property-row" class="hidden">
                <label class="field-label" for="inspection-property">Property</label>
                <select id="inspection-property" class="field-input"></select>
              </div>
              <div>
                <label class="field-label field-required" for="inspection-template">Inspection template</label>
                <select id="inspection-template" class="field-input" required></select>
              </div>
              <div>
                <label class="field-label field-required" for="inspection-type">Inspection type</label>
                <select id="inspection-type" class="field-input" required></select>
              </div>
              <div class="form-grid two">
                <div>
                  <label class="field-label" for="inspection-location">Location</label>
                  <select id="inspection-location" class="field-input"></select>
                </div>
                <div>
                  <label class="field-label" for="inspection-building">Building / core</label>
                  <select id="inspection-building" class="field-input"></select>
                </div>
              </div>
              <div class="form-grid two">
                <div>
                  <label class="field-label" for="inspection-level">Level</label>
                  <input id="inspection-level" class="field-input" placeholder="Optional" />
                </div>
                <div>
                  <label class="field-label" for="inspection-specific-location">Specific location</label>
                  <input id="inspection-specific-location" class="field-input" placeholder="Optional" />
                </div>
              </div>
              <div id="start-inspection-error" class="hidden form-error"></div>
              <button id="start-inspection-button" class="btn-primary w-full" type="submit">
                <i class="fa-solid fa-play"></i>Start inspection
              </button>
            </form>
          </div>
          <div>
            <div class="flex items-center justify-between gap-3 mb-3">
              <h2 class="font-semibold text-slate-900">Recent inspections</h2>
              <button id="refresh-inspections" type="button" class="btn-quiet text-xs"><i class="fa-solid fa-rotate"></i>Refresh</button>
            </div>
            <div id="inspection-list" class="card p-4 text-sm text-slate-500">Loading…</div>
          </div>
        </div>
      </section>

      <section id="inspection-runner" class="hidden">
        <div class="flex items-center justify-between gap-3 mb-3 no-print">
          <button id="inspection-exit" type="button" class="btn-secondary"><i class="fa-solid fa-arrow-left"></i>Inspection list</button>
          <span id="inspection-save-state" class="text-xs text-slate-400"></span>
        </div>
        <div class="card mobile-full overflow-hidden">
          <div class="px-4 sm:px-6 py-4 border-b border-slate-200 bg-slate-50">
            <div class="flex items-start justify-between gap-4">
              <div>
                <h1 id="runner-title" class="font-semibold text-slate-900"></h1>
                <p id="runner-subtitle" class="text-xs text-slate-500 mt-1"></p>
              </div>
              <span id="runner-progress-label" class="status-chip status-routine"></span>
            </div>
            <div class="h-2 bg-slate-200 rounded-full mt-3 overflow-hidden">
              <div id="runner-progress" class="h-full bg-[#17629d] transition-all" style="width:0%"></div>
            </div>
          </div>
          <div id="checkpoint-host" class="p-4 sm:p-6"></div>
        </div>
      </section>
    </div>
    <script src="/static/inspections.js"></script>
  </Shell>
);
