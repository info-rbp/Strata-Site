import type { FC } from 'hono/jsx';
import { Shell } from './layout';

export const ResidentMoveBooking: FC = () => (
  <Shell portal="resident" active="/resident/moves" pageTitle="Move / Large Item Booking">
    <div id="resident-operation-page" data-page="moves" class="max-w-5xl mx-auto">
      <div id="resident-operation-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading booking form…
      </div>
      <div id="resident-operation-content" class="hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-5">
        <div class="card mobile-full p-4 sm:p-6">
          <div class="mb-5">
            <h1 class="text-xl font-semibold text-slate-900">Request a move or large-item booking</h1>
            <p class="text-sm text-slate-500 mt-1">Bookings are reviewed by the Building Manager before access is confirmed.</p>
          </div>
          <div id="move-operating-rules" class="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-900 mb-5"></div>
          <form id="resident-move-form" class="grid gap-4" novalidate>
            <input type="hidden" name="clientSubmissionId" />
            <div class="form-grid two">
              <div>
                <label class="field-label field-required" for="rm-unit">Unit</label>
                <select id="rm-unit" name="unitId" class="field-input" required></select>
              </div>
              <div>
                <label class="field-label field-required" for="rm-type">Booking type</label>
                <select id="rm-type" name="moveType" class="field-input" required></select>
              </div>
              <div>
                <label class="field-label field-required" for="rm-datetime">Requested date and time</label>
                <input id="rm-datetime" name="requestedAt" type="datetime-local" class="field-input" required />
              </div>
              <div>
                <label class="field-label" for="rm-duration">Estimated duration (minutes)</label>
                <input id="rm-duration" name="estimatedDurationMinutes" type="number" min="15" max="1440" class="field-input" placeholder="120" />
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Applicant</h2>
              <div class="form-grid two">
                <div>
                  <label class="field-label field-required" for="rm-name">Name</label>
                  <input id="rm-name" name="applicantName" class="field-input" required autocomplete="name" />
                </div>
                <div>
                  <label class="field-label field-required" for="rm-role">Applicant type</label>
                  <select id="rm-role" name="applicantRole" class="field-input" required>
                    <option value="owner">Owner</option>
                    <option value="tenant">Tenant</option>
                    <option value="authorised_agent">Authorised agent</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="rm-phone">Phone</label>
                  <input id="rm-phone" name="applicantPhone" type="tel" class="field-input" autocomplete="tel" />
                </div>
                <div>
                  <label class="field-label" for="rm-email">Email</label>
                  <input id="rm-email" name="applicantEmail" type="email" class="field-input" autocomplete="email" />
                </div>
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Removalist and vehicle</h2>
              <div class="form-grid two">
                <div>
                  <label class="field-label" for="rm-removalist">Removalist / company</label>
                  <input id="rm-removalist" name="removalistName" class="field-input" />
                </div>
                <div>
                  <label class="field-label" for="rm-removalist-contact">Removalist contact</label>
                  <input id="rm-removalist-contact" name="removalistContact" class="field-input" />
                </div>
                <div>
                  <label class="field-label" for="rm-vehicle-type">Vehicle type</label>
                  <input id="rm-vehicle-type" name="vehicleType" class="field-input" placeholder="e.g. van, 4.5 tonne truck" />
                </div>
                <div>
                  <label class="field-label" for="rm-height">Vehicle height (mm)</label>
                  <input id="rm-height" name="vehicleHeightMm" type="number" min="0" max="10000" class="field-input" />
                </div>
                <div class="sm:col-span-2">
                  <label class="field-label" for="rm-vehicle-details">Registration / vehicle details</label>
                  <input id="rm-vehicle-details" name="vehicleDetails" class="field-input" />
                </div>
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Building requirements</h2>
              <div class="grid sm:grid-cols-2 gap-3">
                <label class="flex items-start gap-2 text-sm text-slate-700"><input name="liftRequired" type="checkbox" class="mt-1 rounded" checked /><span>Lift access required</span></label>
                <label class="flex items-start gap-2 text-sm text-slate-700"><input name="liftProtectionRequired" type="checkbox" class="mt-1 rounded" checked /><span>Lift protection required</span></label>
                <label class="flex items-start gap-2 text-sm text-slate-700"><input name="loadingAreaRequired" type="checkbox" class="mt-1 rounded" checked /><span>Loading area required</span></label>
                <label class="flex items-start gap-2 text-sm text-slate-700"><input name="liftKeyRequired" type="checkbox" class="mt-1 rounded" /><span>Lift key requested</span></label>
              </div>
              <div class="mt-4">
                <label class="field-label" for="rm-special">Special requirements</label>
                <textarea id="rm-special" name="specialRequirements" class="field-input" rows={3}></textarea>
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Acknowledgements</h2>
              <div id="move-acknowledgements" class="grid gap-2"></div>
              <label class="flex items-start gap-2 text-sm text-slate-800 mt-4 rounded-xl bg-slate-50 p-3">
                <input id="rm-rules" name="rulesAcknowledged" type="checkbox" class="mt-1 rounded" required />
                <span>I agree to comply with the property moving requirements and Building Manager directions.</span>
              </label>
            </div>
            <div id="resident-operation-error" class="hidden form-error"></div>
            <div class="form-actions">
              <button id="resident-operation-submit" type="submit" class="btn-primary"><i class="fa-solid fa-paper-plane"></i>Submit booking</button>
            </div>
          </form>
        </div>
        <div>
          <h2 class="font-semibold text-slate-900 mb-3">My bookings</h2>
          <div id="resident-operation-list" class="card p-4 text-sm text-slate-500">Loading…</div>
        </div>
      </div>
    </div>
    <script src="/static/resident-operations.js"></script>
  </Shell>
);

export const ResidentAccessDeviceRequest: FC = () => (
  <Shell portal="resident" active="/resident/access-devices" pageTitle="Security Device / Key Request">
    <div id="resident-operation-page" data-page="access" class="max-w-5xl mx-auto">
      <div id="resident-operation-loading" class="card p-6 text-sm text-slate-500">
        <i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading request form…
      </div>
      <div id="resident-operation-content" class="hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] gap-5">
        <div class="card mobile-full p-4 sm:p-6">
          <div class="mb-5">
            <h1 class="text-xl font-semibold text-slate-900">Request an access device or key</h1>
            <p class="text-sm text-slate-500 mt-1">Tenant requests require written owner authority before approval.</p>
          </div>
          <form id="resident-access-form" class="grid gap-4" novalidate>
            <input type="hidden" name="clientSubmissionId" />
            <div class="form-grid two">
              <div>
                <label class="field-label field-required" for="ra-unit">Unit</label>
                <select id="ra-unit" name="unitId" class="field-input" required></select>
              </div>
              <div>
                <label class="field-label field-required" for="ra-request-type">Request type</label>
                <select id="ra-request-type" name="requestType" class="field-input" required>
                  <option value="replacement_fob">Replacement fob</option>
                  <option value="additional_fob">Additional fob</option>
                  <option value="remote">Garage remote</option>
                  <option value="swipe">Swipe card</option>
                  <option value="physical_key">Physical / restricted key</option>
                  <option value="lost_stolen">Lost or stolen device</option>
                </select>
              </div>
              <div>
                <label class="field-label field-required" for="ra-device-type">Device requested</label>
                <select id="ra-device-type" name="deviceTypeRequested" class="field-input" required>
                  <option value="fob">Fob</option>
                  <option value="swipe">Swipe card</option>
                  <option value="remote">Remote</option>
                  <option value="key">Physical key</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label class="field-label field-required" for="ra-quantity">Quantity</label>
                <input id="ra-quantity" name="quantityRequested" type="number" min="1" max="10" value="1" class="field-input" required />
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Applicant</h2>
              <div class="form-grid two">
                <div>
                  <label class="field-label field-required" for="ra-name">Applicant name</label>
                  <input id="ra-name" name="applicantName" class="field-input" required autocomplete="name" />
                </div>
                <div>
                  <label class="field-label field-required" for="ra-role">Applicant type</label>
                  <select id="ra-role" name="requesterRole" class="field-input" required>
                    <option value="owner">Owner</option>
                    <option value="tenant">Tenant</option>
                    <option value="authorised_agent">Authorised agent</option>
                  </select>
                </div>
                <div>
                  <label class="field-label" for="ra-agent">Managing agent</label>
                  <input id="ra-agent" name="managingAgentName" class="field-input" />
                </div>
                <div>
                  <label class="field-label" for="ra-phone">Phone</label>
                  <input id="ra-phone" name="contactPhone" type="tel" class="field-input" autocomplete="tel" />
                </div>
                <div class="sm:col-span-2">
                  <label class="field-label" for="ra-email">Email</label>
                  <input id="ra-email" name="contactEmail" type="email" class="field-input" autocomplete="email" />
                </div>
              </div>
            </div>
            <div class="form-section">
              <h2 class="form-section-title">Reason and authority</h2>
              <div class="grid gap-3">
                <div>
                  <label class="field-label" for="ra-reason">Reason for request</label>
                  <textarea id="ra-reason" name="requestReason" class="field-input" rows={3}></textarea>
                </div>
                <div id="owner-authority-row" class="hidden">
                  <label class="field-label field-required" for="ra-authority">Written owner authority</label>
                  <input id="ra-authority" name="ownerAuthority" type="file" accept="image/*,application/pdf" class="field-input" />
                  <span class="field-hint">Required for tenant requests.</span>
                </div>
                <div>
                  <label class="field-label" for="ra-collection-date">Preferred collection date</label>
                  <input id="ra-collection-date" name="requestedCollectionDate" type="date" class="field-input" />
                </div>
              </div>
            </div>
            <div id="resident-operation-error" class="hidden form-error"></div>
            <div class="form-actions">
              <button id="resident-operation-submit" type="submit" class="btn-primary"><i class="fa-solid fa-paper-plane"></i>Submit request</button>
            </div>
          </form>
        </div>
        <div>
          <h2 class="font-semibold text-slate-900 mb-3">My requests</h2>
          <div id="resident-operation-list" class="card p-4 text-sm text-slate-500">Loading…</div>
        </div>
      </div>
    </div>
    <script src="/static/resident-operations.js"></script>
  </Shell>
);
