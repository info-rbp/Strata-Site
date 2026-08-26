import type { FC } from 'hono/jsx';
import { Shell } from './layout';

export const ContractorPortal: FC = () => (
  <Shell portal="contractor" active="/contractor" pageTitle="Check-in / Out">
    <div id="contractor-page" data-page="attendance" class="max-w-5xl mx-auto">
      <div id="contractor-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading contractor access…
      </div>

      <div id="contractor-content" class="hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] gap-5">
        <div class="card mobile-full p-4 sm:p-6">
          <div class="mb-5">
            <div class="text-xs font-semibold uppercase tracking-wide text-[#17629d]">Contractor attendance</div>
            <h1 id="contractor-company" class="text-xl font-semibold text-slate-900 mt-1">Contractor</h1>
            <p class="text-sm text-slate-500 mt-1">Record arrival details, site access and sign-out before leaving.</p>
          </div>

          <div id="contractor-rules" class="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900 mb-5"></div>

          <form id="contractor-signin-form" class="grid gap-4" novalidate>
            <input type="hidden" name="clientSubmissionId" />
            <div class="form-grid two">
              <div>
                <label class="field-label field-required" for="ci-property">Property</label>
                <select id="ci-property" name="propertyId" class="field-input" required></select>
              </div>
              <div>
                <label class="field-label field-required" for="ci-purpose">Purpose of visit</label>
                <input id="ci-purpose" name="purpose" class="field-input" required placeholder="e.g. inspect pump fault" />
              </div>
              <div>
                <label class="field-label field-required" for="ci-name">Person attending</label>
                <input id="ci-name" name="visitorName" class="field-input" required autocomplete="name" />
              </div>
              <div>
                <label class="field-label" for="ci-mobile">Mobile</label>
                <input id="ci-mobile" name="visitorMobile" type="tel" class="field-input" autocomplete="tel" />
              </div>
              <div>
                <label class="field-label" for="ci-email">Email</label>
                <input id="ci-email" name="visitorEmail" type="email" class="field-input" autocomplete="email" />
              </div>
              <div>
                <label class="field-label" for="ci-duration">Expected duration (minutes)</label>
                <input id="ci-duration" name="expectedDurationMinutes" type="number" min="0" max="1440" class="field-input" placeholder="60" />
              </div>
              <div>
                <label class="field-label" for="ci-area">Area being accessed</label>
                <input id="ci-area" name="areaAccessed" class="field-input" placeholder="e.g. roof plant room" />
              </div>
              <div>
                <label class="field-label" for="ci-access-type">Access item</label>
                <select id="ci-access-type" name="accessItemType" class="field-input"></select>
              </div>
              <div>
                <label class="field-label" for="ci-access-id">Key / fob / remote identifier</label>
                <input id="ci-access-id" name="accessItemIdentifier" class="field-input" />
              </div>
              <div>
                <label class="field-label" for="ci-rego">Vehicle registration</label>
                <input id="ci-rego" name="vehicleRegistration" class="field-input" autocomplete="off" />
              </div>
              <div class="sm:col-span-2">
                <label class="field-label" for="ci-parking">Parking / loading location</label>
                <input id="ci-parking" name="parkingLocation" class="field-input" />
              </div>
            </div>

            <label class="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-800">
              <input name="siteRulesAcknowledged" type="checkbox" class="mt-1 rounded" required />
              <span>I have read the site access requirements and will return all keys or access items before leaving.</span>
            </label>

            <div id="contractor-error" class="hidden form-error"></div>
            <div class="form-actions">
              <button id="contractor-signin-submit" type="submit" class="btn-primary">
                <i class="fa-solid fa-right-to-bracket"></i>Sign in on site
              </button>
            </div>
          </form>
        </div>

        <div>
          <h2 class="font-semibold text-slate-900 mb-3">My recent attendance</h2>
          <div id="contractor-attendance-list" class="card p-4 text-sm text-slate-500">Loading…</div>
        </div>
      </div>

      <div id="contractor-signout-modal" class="hidden modal-backdrop no-print">
        <div class="modal-panel max-w-xl">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <div class="text-xs uppercase tracking-wide font-semibold text-slate-400">Sign out</div>
              <h2 id="signout-summary" class="font-semibold text-slate-900 mt-1"></h2>
            </div>
            <button id="signout-close" type="button" class="btn-quiet" aria-label="Close sign-out form">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form id="contractor-signout-form" class="grid gap-4" novalidate>
            <input type="hidden" name="attendanceId" />
            <input type="hidden" name="clientSubmissionId" />
            <label class="flex items-start gap-2 text-sm text-slate-800">
              <input name="workCompleted" type="checkbox" class="mt-1 rounded" />
              <span>Work was completed during this attendance</span>
            </label>
            <div>
              <label class="field-label" for="so-work">Work performed</label>
              <textarea id="so-work" name="workDescription" class="field-input" rows={4} placeholder="Briefly describe what was done"></textarea>
            </div>
            <div>
              <label class="field-label" for="so-defects">Additional defects / findings</label>
              <textarea id="so-defects" name="additionalDefects" class="field-input" rows={3}></textarea>
            </div>
            <div class="grid sm:grid-cols-2 gap-3">
              <label class="flex items-start gap-2 text-sm text-slate-800"><input name="furtherAttendanceRequired" type="checkbox" class="mt-1 rounded" /><span>Further attendance required</span></label>
              <label class="flex items-start gap-2 text-sm text-slate-800"><input name="quoteOrReportToFollow" type="checkbox" class="mt-1 rounded" /><span>Quote or report to follow</span></label>
              <label class="flex items-start gap-2 text-sm text-slate-800"><input name="areaLeftClean" type="checkbox" class="mt-1 rounded" checked /><span>Area left clean and secure</span></label>
            </div>
            <div>
              <label class="field-label" for="so-report-file">Service report / completion evidence</label>
              <input id="so-report-file" name="serviceReport" type="file" accept="image/*,application/pdf,text/plain" class="field-input" />
            </div>
            <div>
              <label class="field-label" for="so-notes">Sign-out notes</label>
              <textarea id="so-notes" name="signoutNotes" class="field-input" rows={3}></textarea>
            </div>
            <div id="signout-error" class="hidden form-error"></div>
            <div class="form-actions">
              <button id="signout-submit" type="submit" class="btn-primary"><i class="fa-solid fa-arrow-right-from-bracket"></i>Submit sign-out</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <script src="/static/contractor-portal.js"></script>
  </Shell>
);

// Compatibility export for legacy route imports while the product is upgraded.
export const ContractorCheckIn = ContractorPortal;

export const ContractorWork: FC = () => (
  <Shell portal="contractor" active="/contractor/work" pageTitle="Assigned Work">
    <div id="contractor-page" data-page="work" class="max-w-5xl mx-auto">
      <div id="contractor-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading assigned work…
      </div>
      <div id="contractor-work-list" class="hidden grid gap-4"></div>

      <div id="work-complete-modal" class="hidden modal-backdrop no-print">
        <div class="modal-panel max-w-xl">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <div class="text-xs uppercase tracking-wide font-semibold text-slate-400">Work completion</div>
              <h2 id="work-complete-summary" class="font-semibold text-slate-900 mt-1"></h2>
            </div>
            <button id="work-complete-close" type="button" class="btn-quiet" aria-label="Close completion form">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <form id="work-complete-form" class="grid gap-4" novalidate>
            <input type="hidden" name="workOrderId" />
            <div>
              <label class="field-label" for="wc-findings">Findings</label>
              <textarea id="wc-findings" name="findings" class="field-input" rows={3}></textarea>
            </div>
            <div>
              <label class="field-label field-required" for="wc-performed">Work performed</label>
              <textarea id="wc-performed" name="workPerformed" class="field-input" rows={4} required></textarea>
            </div>
            <div>
              <label class="field-label" for="wc-recommendations">Recommendations / further work</label>
              <textarea id="wc-recommendations" name="recommendations" class="field-input" rows={3}></textarea>
            </div>
            <div>
              <label class="field-label" for="wc-report">Service report / evidence</label>
              <input id="wc-report" name="serviceReport" type="file" accept="image/*,application/pdf,text/plain" class="field-input" />
            </div>
            <div id="work-complete-error" class="hidden form-error"></div>
            <div class="form-actions">
              <button id="work-complete-submit" type="submit" class="btn-primary"><i class="fa-solid fa-circle-check"></i>Submit completion</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <script src="/static/contractor-portal.js"></script>
  </Shell>
);
