import type { FC } from 'hono/jsx';
import { Shell } from './layout';

const ReportWorkspace: FC<{ portal: 'bm' | 'strata'; active: string }> = ({ portal, active }) => (
  <Shell portal={portal} active={active} pageTitle="Monthly Building Management Report">
    <div class="max-w-7xl mx-auto">
      <div class="card p-4 mb-5 no-print">
        <div class="form-grid three items-end">
          <div>
            <label class="field-label" for="report-property">Property</label>
            <select id="report-property" class="field-input"></select>
          </div>
          <div>
            <label class="field-label" for="report-month">Report month</label>
            <input id="report-month" class="field-input" type="month" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="report-load" type="button" class="btn-primary"><i class="fa-solid fa-rotate"></i>Load report</button>
            <button id="report-print" type="button" class="btn-secondary"><i class="fa-solid fa-print"></i>Print / PDF</button>
          </div>
        </div>
      </div>

      <div id="report-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Preparing report data…
      </div>
      <div id="report-error" class="hidden form-error mb-4"></div>

      <div id="report-workspace" class="hidden">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
          <div>
            <div class="text-xs font-semibold uppercase tracking-wide text-[#17629d]">ProInspect Building Management</div>
            <h1 id="report-title" class="text-2xl font-semibold text-slate-900 mt-1"></h1>
            <p id="report-property-details" class="text-sm text-slate-500 mt-1"></p>
          </div>
          <div class="flex flex-wrap gap-2 no-print">
            <button id="report-generate" type="button" class="btn-secondary"><i class="fa-solid fa-wand-magic-sparkles"></i>Generate draft</button>
            <button id="report-save" type="button" class="btn-primary"><i class="fa-solid fa-floppy-disk"></i>Save commentary</button>
            <button id="report-finalise" type="button" class="btn-secondary"><i class="fa-solid fa-lock"></i>Finalise</button>
            <button id="report-copy" type="button" class="btn-secondary"><i class="fa-solid fa-copy"></i>Copy AI-ready JSON</button>
            <button id="report-download" type="button" class="btn-secondary"><i class="fa-solid fa-download"></i>Download JSON</button>
          </div>
        </div>

        <div id="report-status" class="mb-4"></div>
        <div id="report-metrics" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5"></div>
        <div id="report-sections" class="grid gap-4"></div>
      </div>
    </div>
    <script src="/static/monthly-reports.js"></script>
  </Shell>
);

export const BuildingManagerReports: FC = () => <ReportWorkspace portal="bm" active="/bm/reports" />;
export const StrataReports: FC = () => <ReportWorkspace portal="strata" active="/strata/reports" />;
