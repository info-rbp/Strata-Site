# PM Hub — Building Operations Platform

## Project Overview
- **Name**: PM Hub
- **Goal**: A building operations platform covering two properties (**Prima** and **Meridian Apartments**), extending the ProInspect Property Platform's capability-based RBAC, workflow-gate, and audit-trail patterns into day-to-day building/strata operations.
- **Phase**: Phase 1 MVP — 4 role-based portals (Strata Manager, Building Manager, Contractor, Resident), defects, contractor attendance/work orders, resident requests, move-in/out, access devices, incidents, inspections, dashboards, notifications, documents, quotes, reports, handover, and user management.

## URLs
- **Production (Cloudflare Pages)**: https://pmhub.pages.dev
- **Latest deployment**: https://eb4475ef.pmhub.pages.dev
- **GitHub**: https://github.com/info-rbp/Strata-Site
- **API base**: `/api/*` (see `src/routes/*.ts` for the full route list — auth, dashboard, defects, requests, workOrders, moves, accessDevices, incidents, inspections, notifications, documents, quotes, reports, handover, users, contractors, properties)

## Data Architecture
- **Storage**: Cloudflare D1 (SQLite) — database `pmhub-production`, 42+ table schema in `migrations/0001_initial_schema.sql` (properties, buildings, locations, units, people, users, occupancies, contractors, keys/access devices, inspection templates + checkpoints, resident requests, defects, work orders, incidents, notices, bylaws, audit log, etc.)
- **File storage**: Cloudflare R2 bucket `pmhub-evidence` (binding `EVIDENCE`) — for defect/inspection photo evidence and documents
- **Auth**: Session-cookie based (`pmhub_session`, `SameSite=None; Secure; HttpOnly` — required because previews render in a cross-site iframe), passwords hashed with PBKDF2-SHA256 via Web Crypto API (`src/lib/crypto.ts`)
- **Authorization**: Capability-based RBAC (`src/domain/security.ts`) + workflow state machines (`src/domain/workflow.ts`), mirroring ProInspect
- **Demo data**: `seed.sql` — Prima & Meridian properties, 8 locations, 6 units, 10 people/users (one per role), 3 occupancies, 4 contractors, 4 keys, 2 inspection templates, sample resident request + linked defect. **Loaded into both local dev and production D1.**

## Demo Accounts
All demo users share the password **`Passw0rd!`**:

| Role | Email |
|---|---|
| System Administrator | admin@pmhub.demo |
| Strata Manager | strata@pmhub.demo |
| Council Member | council@pmhub.demo |
| Building Manager (Prima) | bm.prima@pmhub.demo |
| Relief Building Manager | relief.bm@pmhub.demo |
| Building Manager (Meridian) | bm.meridian@pmhub.demo |
| Contractor | plumbing@pmhub.demo |
| Resident (Prima) | olivia.grant@pmhub.demo / liam.foster@pmhub.demo |
| Resident (Meridian) | emma.walsh@pmhub.demo |

## User Guide
1. Go to `/login` and sign in with one of the demo accounts above.
2. Each role is routed to its own portal: Strata Manager → `/strata`, Building Manager → `/bm`, Contractor → `/contractor`, Resident → `/resident`.
3. Dashboards, defects, approvals, contractor check-in/work orders, resident requests, moves, access devices, incidents, bylaws/notices, users, and audit trail are all live against seeded Prima/Meridian data.

## Deployment
- **Platform**: Cloudflare Pages (BYOK — deployed to the user's own Cloudflare account)
- **Status**: ✅ Active — live at https://pmhub.pages.dev
- **Cloudflare account**: info@remotebusinesspartner.com.au (Account ID `8ca23ac6d2cc906d4dd13b8da5ea2b25`)
- **Tech Stack**: Hono + TypeScript + Vite, TailwindCSS (CDN), Cloudflare D1 + R2
- **Resources**:
  - Pages project: `pmhub`
  - D1 database: `pmhub-production` (`29d715f5-0a9e-467c-9e6f-f53b989b00a8`)
  - R2 bucket: `pmhub-evidence`
- **Redeploy**:
  ```bash
  npm run build
  npx wrangler pages deploy dist --project-name pmhub
  ```
- **Local sandbox dev** (separate local SQLite D1, not connected to production):
  ```bash
  npm run build
  pm2 start ecosystem.config.cjs
  ```
- **Last Updated**: 2026-08-26

## Features Not Yet Implemented
- Phase 2+ items per the 31-section build guide beyond Phase 1 MVP scope (not yet scoped in detail in this session)
- Automated test suite (current verification is manual curl/Playwright checks)
- Custom domain binding (currently on default `*.pages.dev` domain)
- Production secrets management review (no third-party API secrets currently required)

## Recommended Next Steps
1. Review Phase 1 with the client against the 31-section build guide and prioritize Phase 2 scope.
2. Replace/rotate demo seed data before real client onboarding (`seed.sql` is illustrative only).
3. Consider a custom domain for the production deployment.
4. Add automated tests (unit + integration) for the RBAC/workflow-gate logic.
