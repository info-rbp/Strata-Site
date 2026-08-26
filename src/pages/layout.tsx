import type { FC } from 'hono/jsx';

export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV_BY_PORTAL: Record<string, NavItem[]> = {
  resident: [
    { href: '/resident', label: 'Home', icon: 'fa-house' },
    { href: '/resident/report', label: 'Report a Problem', icon: 'fa-triangle-exclamation' },
    { href: '/resident/moves', label: 'Move / Delivery Booking', icon: 'fa-truck-fast' },
    { href: '/resident/access-devices', label: 'Access Device Request', icon: 'fa-key' },
    { href: '/resident/requests', label: 'My Requests', icon: 'fa-list-check' },
    { href: '/resident/notices', label: 'Building Notices', icon: 'fa-bullhorn' },
  ],
  bm: [
    { href: '/bm', label: 'Today', icon: 'fa-gauge-high' },
    { href: '/bm/forms', label: 'Quick Forms', icon: 'fa-circle-plus' },
    { href: '/bm/tasks', label: 'Tasks', icon: 'fa-list-check' },
    { href: '/bm/inspections', label: 'Inspections', icon: 'fa-clipboard-check' },
    { href: '/bm/defects', label: 'Defects & Maintenance', icon: 'fa-screwdriver-wrench' },
    { href: '/bm/work-orders', label: 'Work Orders', icon: 'fa-file-invoice' },
    { href: '/bm/contractors', label: 'Contractors', icon: 'fa-helmet-safety' },
    { href: '/bm/moves', label: 'Moves & Deliveries', icon: 'fa-truck-fast' },
    { href: '/bm/units', label: 'Residents & Units', icon: 'fa-building-user' },
    { href: '/bm/access-devices', label: 'Access Devices & Keys', icon: 'fa-key' },
    { href: '/bm/incidents', label: 'Incidents & Security', icon: 'fa-shield-halved' },
    { href: '/bm/bylaws', label: 'By-law Observations', icon: 'fa-gavel' },
    { href: '/bm/calendar', label: 'Calendar', icon: 'fa-calendar-days' },
    { href: '/bm/reports', label: 'Monthly Reports', icon: 'fa-chart-line' },
    { href: '/bm/handover', label: 'Handover', icon: 'fa-right-left' },
  ],
  strata: [
    { href: '/strata', label: 'Dashboard', icon: 'fa-gauge-high' },
    { href: '/strata/reports', label: 'Monthly Reports', icon: 'fa-chart-line' },
    { href: '/strata/approvals', label: 'Approvals', icon: 'fa-stamp' },
    { href: '/strata/defects', label: 'Maintenance', icon: 'fa-screwdriver-wrench' },
    { href: '/strata/contractors', label: 'Contractors', icon: 'fa-helmet-safety' },
    { href: '/strata/moves', label: 'Residents & Moves', icon: 'fa-truck-fast' },
    { href: '/strata/access-devices', label: 'Access Devices', icon: 'fa-key' },
    { href: '/strata/incidents', label: 'Incidents', icon: 'fa-shield-halved' },
    { href: '/strata/bylaws', label: 'By-law Observations', icon: 'fa-gavel' },
    { href: '/strata/notices', label: 'Notices', icon: 'fa-bullhorn' },
    { href: '/strata/users', label: 'Users & Permissions', icon: 'fa-users-gear' },
    { href: '/strata/audit', label: 'Audit Log', icon: 'fa-clipboard-list' },
  ],
  contractor: [
    { href: '/contractor', label: 'Check-in / Out', icon: 'fa-qrcode' },
    { href: '/contractor/work', label: 'Assigned Work', icon: 'fa-file-invoice' },
  ],
};

const PORTAL_TITLE: Record<string, string> = {
  resident: 'Resident Portal',
  bm: 'Building Management',
  strata: 'Strata / Administration',
  contractor: 'Contractor Portal',
};

export const Shell: FC<{ portal: string; active: string; pageTitle?: string; children: any }> = ({
  portal,
  active,
  pageTitle,
  children,
}) => {
  const nav = NAV_BY_PORTAL[portal] ?? [];
  return (
    <div class="min-h-screen flex flex-col md:flex-row" id="app-shell" data-portal={portal}>
      <aside class="w-full md:w-72 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 md:min-h-screen md:max-h-screen md:sticky md:top-0 md:overflow-y-auto">
        <div class="flex items-center gap-3 px-4 py-4 border-b border-slate-100">
          <div class="w-10 h-10 rounded-xl bg-[#17629d] flex items-center justify-center text-white font-bold text-sm shadow-sm">
            PI
          </div>
          <div class="min-w-0">
            <div class="font-semibold text-sm leading-tight text-slate-900 truncate">ProInspect</div>
            <div class="text-xs text-slate-500 leading-tight truncate">Building Management</div>
            <div class="text-[10px] text-slate-400 leading-tight mt-0.5 truncate">{PORTAL_TITLE[portal]}</div>
          </div>
        </div>
        <nav class="p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible" id="main-nav" aria-label={`${PORTAL_TITLE[portal]} navigation`}>
          {nav.map((item) => (
            <a href={item.href} class={`nav-link ${active === item.href ? 'active' : ''}`} aria-current={active === item.href ? 'page' : undefined}>
              <i class={`fa-solid ${item.icon} w-4 text-center`} aria-hidden="true"></i>
              <span class="whitespace-nowrap">{item.label}</span>
            </a>
          ))}
        </nav>
        <div class="p-3 border-t border-slate-100 mt-2 hidden md:block">
          <div id="property-badge" class="text-xs text-slate-500 px-2 mb-2"></div>
          <button id="logout-btn" class="nav-link w-full text-left text-red-600" type="button">
            <i class="fa-solid fa-arrow-right-from-bracket w-4 text-center" aria-hidden="true"></i>
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <main class="flex-1 min-w-0 relative">
        <header class="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <div id="page-title" class="font-semibold text-lg truncate pr-3">{pageTitle}</div>
          <div class="flex items-center gap-3 shrink-0">
            <button id="notif-btn" class="relative text-slate-500 hover:text-slate-800 w-9 h-9 rounded-lg hover:bg-slate-100" type="button" aria-label="Notifications">
              <i class="fa-solid fa-bell" aria-hidden="true"></i>
              <span id="notif-dot" class="hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500"></span>
            </button>
            <div id="user-badge" class="text-sm text-slate-600 hidden sm:block"></div>
          </div>
        </header>
        <div class="p-4 md:p-6" id="page-content">
          {children}
        </div>
        {portal === 'bm' && active !== '/bm/forms' ? (
          <a href="/bm/forms" class="mobile-quick-add md:hidden no-print" aria-label="Open quick forms">
            <i class="fa-solid fa-plus" aria-hidden="true"></i>
          </a>
        ) : null}
      </main>
    </div>
  );
};
