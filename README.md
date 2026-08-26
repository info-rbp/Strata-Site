# ProInspect Building Management

ProInspect Building Management is the operational building-management application for **Prima Apartments** and **Meridian Apartments** in North Fremantle, Western Australia. It is designed for practical day-to-day use by Building Management, Strata Management, residents and contractors, while keeping structured operational records that can feed monthly reporting and the wider ProInspect platform.

## Production environment

- **Live URL:** https://pmhub.pages.dev
- **Source:** https://github.com/info-rbp/Strata-Site
- **Platform:** Cloudflare Pages
- **Pages project:** `pmhub`
- **D1 database:** `pmhub-production`
- **D1 database ID:** `29d715f5-0a9e-467c-9e6f-f53b989b00a8`
- **R2 evidence bucket:** `pmhub-evidence`
- **Cloudflare account ID:** `8ca23ac6d2cc906d4dd13b8da5ea2b25`
- **Application timezone:** `Australia/Perth`

The Cloudflare resource names intentionally remain `pmhub*` for deployment continuity. They are infrastructure identifiers, not customer-facing product branding.

## Architecture

- **Runtime:** Hono + TypeScript on Cloudflare Pages Functions
- **Rendering:** server-rendered Hono JSX with a shared browser runtime
- **Database:** Cloudflare D1 / SQLite
- **Evidence:** Cloudflare R2
- **Authentication:** secure session cookies and PBKDF2-SHA256 password hashes
- **Authorization:** capability-based RBAC plus property scoping and workflow state machines
- **Mobile support:** installable PWA shell, local form drafts and idempotent submissions
- **Integration boundary:** immutable form-submission archive plus provider-neutral integration outbox for later Google Sheets synchronisation

## Portals

| Portal | Route | Primary users |
| --- | --- | --- |
| Building Management | `/bm` | Building Manager, Relief Building Manager |
| Strata / Administration | `/strata` | Strata Manager, Council, System Administrator |
| Resident | `/resident` | Owners and tenants |
| Contractor | `/contractor` | Approved contractor accounts |

## Field workflows

Building Management includes quick forms and structured workflows for:

- daily activity logging;
- common-property inspections;
- maintenance and defect recording;
- waste-management activity and exceptions;
- incidents and security events;
- by-law observations;
- resident induction;
- contractor sign-in, controlled-key handling and sign-out;
- resident move / large-item bookings;
- security device and key requests; and
- monthly Building Management reporting.

Monthly reports are generated from the operational database, retain editable Building Manager commentary before finalisation, and expose an AI-ready JSON package so report drafting does not require re-keying the month's work. Once a report is finalised, D1 triggers prevent both modification and deletion of that finalised snapshot.

## Database migrations

Migrations are applied in order from `migrations/`.

Current release additions:

- `0002_operational_forms_and_reporting.sql` - operational forms, monthly reporting and Google Sheets outbox foundation
- `0003_integration_outbox_reference.sql` - external integration reference tracking
- `0004_property_operating_settings.sql` - property-specific operating rules
- `0005_production_accounts_and_demo_lockdown.sql` - production account bootstrap, demo-account lockdown and removal of known illustrative units, contractors and keys
- `0006_finalised_report_immutability.sql` - irreversible lock for finalised monthly report snapshots

For a local database:

```bash
npm run db:migrate:local
npm run db:seed
```

For the production D1 database, the guarded release script takes the backup first and then applies remote migrations.

## Development

Use Node 22.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run dev
```

Build the Cloudflare bundle with:

```bash
npm run build
```

## Release validation

The GitHub Actions validation workflow performs:

1. dependency installation;
2. strict TypeScript checking;
3. the production Vite build;
4. application of all migrations to a fresh local D1 database;
5. loading of local development seed data;
6. a second production-style rehearsal that loads the Phase 1 seed first and then applies migrations 0002 onward;
7. assertions that demo accounts, sample issues, illustrative units, contractors and keys have been removed; and
8. a database-level test that finalised monthly reports cannot be changed.

Production deployment should not proceed unless this workflow passes.

## Production release sequence

The release is automated by `scripts/release-cloudflare.sh` and `.github/workflows/release-cloudflare.yml` in this order:

1. validate TypeScript and build the Cloudflare bundle;
2. export `pmhub-production` and store the pre-release backup privately in the existing R2 bucket;
3. apply remote D1 migrations;
4. verify named production account roles and property scopes;
5. verify all `@pmhub.demo` users/sessions and known seed records are removed or disabled;
6. deploy the Cloudflare Pages production build;
7. run public health/login/PWA checks; and
8. create temporary test users for every application role, run authenticated portal/API smoke tests, then delete the test users, sessions and test-only audit events.

The workflow can be run manually. A merge commit containing `[production-release]` also triggers the same guarded release automatically. A missing Cloudflare release token causes the workflow to fail **before** any production mutation.

## Production credentials

Plain-text production passwords are **never committed to GitHub**. Initial production users are created by migration using PBKDF2 hashes. The temporary credentials are provided separately to the system owner and can be rotated through `POST /api/change-password` after first login.

The publicly documented Phase 1 `@pmhub.demo` credentials are suspended by the production-hardening migration and all of their active sessions are invalidated.

## Evidence security

New evidence uploads are:

- authenticated;
- property scoped;
- restricted to approved content types;
- limited to 15 MB;
- stamped with uploader metadata; and
- recorded in the audit trail.

Residents and contractors may retrieve only evidence uploaded by their own account. Building Management and authorised management roles retain property-scoped operational access.

## Production data principle

D1 is the operational source of truth. Google Sheets is intended as a downstream integration/reporting destination and must not replace database workflow state, audit history or access-control enforcement.

Reference data such as verified locations, unit lists, contractor records and inspection routes should be maintained as building information is confirmed. `seed.sql` remains a local-development aid and must not be used to reactivate demonstration accounts in production.
