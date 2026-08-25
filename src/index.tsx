import { Hono } from 'hono';
import { renderer } from './renderer';
import { attachSession, pageGuard } from './middleware/auth';
import type { AppBindings, AppVariables } from './middleware/auth';
import { HttpError } from './middleware/auth';

import { authRoutes } from './routes/auth';
import { propertyRoutes } from './routes/properties';
import { requestRoutes } from './routes/requests';
import { defectRoutes } from './routes/defects';
import { workOrderRoutes } from './routes/workOrders';
import { contractorRoutes } from './routes/contractors';
import { moveRoutes } from './routes/moves';
import { accessDeviceRoutes } from './routes/accessDevices';
import { incidentRoutes } from './routes/incidents';
import { inspectionRoutes } from './routes/inspections';
import { dashboardRoutes } from './routes/dashboard';
import { notificationRoutes } from './routes/notifications';
import { documentRoutes } from './routes/documents';
import { quoteRoutes } from './routes/quotes';
import { reportRoutes } from './routes/reports';
import { handoverRoutes } from './routes/handover';
import { userRoutes } from './routes/users';

import { LoginPage } from './pages/login';
import { ResidentHome, ResidentReport, ResidentMoves, ResidentAccessDevices, ResidentRequests, ResidentNotices } from './pages/resident';
import {
  BmToday, BmTasks, BmInspections, BmDefects, BmWorkOrders, BmContractors,
  BmMoves, BmUnits, BmAccessDevices, BmIncidents, BmBylaws, BmCalendar, BmReports, BmHandover,
} from './pages/bm';
import {
  StrataDashboard, StrataApprovals, StrataDefects, StrataContractors, StrataMoves,
  StrataAccessDevices, StrataIncidents, StrataBylaws, StrataNotices, StrataUsers, StrataAudit,
} from './pages/strata';
import { ContractorCheckIn, ContractorWork } from './pages/contractor';

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use(renderer);
app.use('*', attachSession);

// ---------------------------------------------------------------------------
// API — every module is mounted flat under /api, each route file owns its
// own full path (e.g. /api/defects, /api/defects/:id/transition).
// ---------------------------------------------------------------------------
const api = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
api.route('/', authRoutes);
api.route('/', propertyRoutes);
api.route('/', requestRoutes);
api.route('/', defectRoutes);
api.route('/', workOrderRoutes);
api.route('/', contractorRoutes);
api.route('/', moveRoutes);
api.route('/', accessDeviceRoutes);
api.route('/', incidentRoutes);
api.route('/', inspectionRoutes);
api.route('/', dashboardRoutes);
api.route('/', notificationRoutes);
api.route('/', documentRoutes);
api.route('/', quoteRoutes);
api.route('/', reportRoutes);
api.route('/', handoverRoutes);
api.route('/', userRoutes);

api.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status as any);
  }
  console.error(err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }, 500);
});

app.route('/api', api);

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

app.get('/', (c) => {
  const user = c.get('user');
  if (user) {
    const home: Record<string, string> = {
      resident: '/resident', building_manager: '/bm', relief_building_manager: '/bm',
      strata_manager: '/strata', council_member: '/strata', system_administrator: '/strata',
      contractor: '/contractor',
    };
    return c.redirect(home[user.role] ?? '/login');
  }
  return c.redirect('/login');
});

app.get('/login', (c) => {
  const user = c.get('user');
  if (user) return c.redirect('/');
  return c.render(<LoginPage next={c.req.query('next')} />, { title: 'Log in' });
});

// --- Resident portal -------------------------------------------------------
const residentRoles = ['resident'] as const;
app.get('/resident', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentHome />, { title: 'Home' });
});
app.get('/resident/report', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentReport />, { title: 'Report a Problem' });
});
app.get('/resident/moves', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentMoves />, { title: 'Move / Delivery Booking' });
});
app.get('/resident/access-devices', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentAccessDevices />, { title: 'Access Device Request' });
});
app.get('/resident/requests', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentRequests />, { title: 'My Requests' });
});
app.get('/resident/notices', (c) => {
  const g = pageGuard(c, [...residentRoles]);
  if (g instanceof Response) return g;
  return c.render(<ResidentNotices />, { title: 'Building Notices' });
});

// --- Building Manager portal -----------------------------------------------
const bmRoles = ['building_manager', 'relief_building_manager'] as const;
app.get('/bm', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmToday />, { title: 'Today' });
});
app.get('/bm/tasks', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmTasks />, { title: 'Tasks' });
});
app.get('/bm/inspections', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmInspections />, { title: 'Inspections' });
});
app.get('/bm/defects', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmDefects />, { title: 'Defects & Maintenance' });
});
app.get('/bm/work-orders', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmWorkOrders />, { title: 'Work Orders' });
});
app.get('/bm/contractors', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmContractors />, { title: 'Contractors' });
});
app.get('/bm/moves', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmMoves />, { title: 'Moves & Deliveries' });
});
app.get('/bm/units', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmUnits />, { title: 'Residents & Units' });
});
app.get('/bm/access-devices', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmAccessDevices />, { title: 'Access Devices & Keys' });
});
app.get('/bm/incidents', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmIncidents />, { title: 'Incidents & Security' });
});
app.get('/bm/bylaws', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmBylaws />, { title: 'By-law Observations' });
});
app.get('/bm/calendar', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmCalendar />, { title: 'Calendar' });
});
app.get('/bm/reports', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmReports />, { title: 'Reports' });
});
app.get('/bm/handover', (c) => {
  const g = pageGuard(c, [...bmRoles]);
  if (g instanceof Response) return g;
  return c.render(<BmHandover />, { title: 'Handover' });
});

// --- Strata / Administration portal ----------------------------------------
const strataRoles = ['strata_manager', 'council_member', 'system_administrator'] as const;
app.get('/strata', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataDashboard />, { title: 'Dashboard' });
});
app.get('/strata/approvals', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataApprovals />, { title: 'Approvals' });
});
app.get('/strata/defects', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataDefects />, { title: 'Maintenance' });
});
app.get('/strata/contractors', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataContractors />, { title: 'Contractors' });
});
app.get('/strata/moves', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataMoves />, { title: 'Residents & Moves' });
});
app.get('/strata/access-devices', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataAccessDevices />, { title: 'Access Devices' });
});
app.get('/strata/incidents', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataIncidents />, { title: 'Incidents' });
});
app.get('/strata/bylaws', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataBylaws />, { title: 'By-law Observations' });
});
app.get('/strata/notices', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataNotices />, { title: 'Notices' });
});
app.get('/strata/users', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataUsers />, { title: 'Users & Permissions' });
});
app.get('/strata/audit', (c) => {
  const g = pageGuard(c, [...strataRoles]);
  if (g instanceof Response) return g;
  return c.render(<StrataAudit />, { title: 'Audit Log' });
});

// --- Contractor portal -------------------------------------------------------
const contractorRoles = ['contractor'] as const;
app.get('/contractor', (c) => {
  const g = pageGuard(c, [...contractorRoles]);
  if (g instanceof Response) return g;
  return c.render(<ContractorCheckIn />, { title: 'Check-in' });
});
app.get('/contractor/work', (c) => {
  const g = pageGuard(c, [...contractorRoles]);
  if (g instanceof Response) return g;
  return c.render(<ContractorWork />, { title: 'Assigned Work' });
});

export default app;
