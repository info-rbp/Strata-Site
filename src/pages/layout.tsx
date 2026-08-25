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
    { href: '/bm/reports', label: 'Reports', icon: 'fa-chart-line' },
    { href: '/bm/handover', label: 'Handover', icon: 'fa-right-left' },
  ],
  strata: [
    { href: '/strata', label: 'Dashboard', icon: 'fa-gauge-high' },
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
    { href: '/contractor', label: 'Check-in', icon: 'fa-qrcode' },
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
      <aside class="w-full md:w-64 shrink-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 md:min-h-screen">
        <div class="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <div class="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center text-white font-bold text-sm">
            PM
          </div>
          <div>
            <div class="font-semibold text-sm leading-tight">PM Hub</div>
            <div class="text-xs text-slate-500 leading-tight">{PORTAL_TITLE[portal]}</div>
          </div>
        </div>
        <nav class="p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible" id="main-nav">
          {nav.map((item) => (
            <a href={item.href} class={`nav-link ${active === item.href ? 'active' : ''}`}>
              <i class={`fa-solid ${item.icon} w-4 text-center`}></i>
              <span class="whitespace-nowrap">{item.label}</span>
            </a>
          ))}
        </nav>
        <div class="p-3 border-t border-slate-100 mt-2 hidden md:block">
          <div id="property-badge" class="text-xs text-slate-500 px-2 mb-2"></div>
          <button id="logout-btn" class="nav-link w-full text-left text-red-600">
            <i class="fa-solid fa-arrow-right-from-bracket w-4 text-center"></i>
            <span>Log out</span>
          </button>
        </div>
      </aside>
      <main class="flex-1 min-w-0 relative">
        <header class="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between">
          <div id="page-title" class="font-semibold text-lg">{pageTitle}</div>
          <div class="flex items-center gap-3">
            <button id="notif-btn" class="relative text-slate-500 hover:text-slate-800">
              <i class="fa-solid fa-bell"></i>
              <span
                id="notif-dot"
                class="hidden absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500"
              ></span>
            </button>
            <div id="user-badge" class="text-sm text-slate-600"></div>
          </div>
        </header>
        <div class="p-4 md:p-6" id="page-content">
          {children}
        </div>
      </main>
    </div>
  );
};
