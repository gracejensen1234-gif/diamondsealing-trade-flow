# Diamond Sealing

A sealing/silicone subcontractor operations management platform for managing field crews, job dispatch, timesheets, and weekly invoicing.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, path prefix `/api`)
- Frontend: React + Vite + shadcn/ui + TanStack Query + wouter routing
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contracts)
- `lib/db/src/schema/` — Drizzle schema files (one per domain)
- `lib/api-zod/src/generated/api.ts` — Generated Zod validators (from codegen)
- `lib/api-client-react/src/generated/api.ts` — Generated React Query hooks (from codegen)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/tradify/src/pages/` — React page components
- `artifacts/tradify/src/components/layout.tsx` — App shell + sidebar nav

## Architecture decisions

- Contract-first: OpenAPI spec drives all codegen (Zod + React Query hooks). Always update spec first, then run codegen.
- Generated hook names follow Orval conventions (operationId → camelCase with `use` prefix). If a hook doesn't exist, use `useMutation` with direct fetch.
- `markArrived` / `markDeparted` mutation variables expect `{ id: number }` not `{ data: { assignmentId } }`.
- Stock item CRUD and job assignment delete use direct fetch mutations (not generated hooks) because those operationIds weren't picked up by Orval.
- GPS tracking: enabled/disabled per session; auto-pauses on break if `gpsDisabledOnBreak` is true.
- Weekly invoices auto-generate on Thursdays; Xero integration is placeholder-ready.

## Product

- **Field View** (`/field`): Mobile-first subcontractor screen — select who you are, clock on/off, start/end lunch break, view today's dispatch with colours and builder contacts, mark arrived/departed, submit job completion reports with photos.
- **Dispatch** (`/dispatch`): Admin daily dispatch — assign jobs to subcontractors with required silicone colours, builder contact details, and scheduled order.
- **Admin Live** (`/admin/live`): Real-time subcontractor status board with auto-refresh.
- **Timesheets** (`/admin/timesheets`): Weekly timesheet review with editable clock times.
- **Weekly Invoices** (`/weekly-invoices`): Auto-prep invoice drafts per subcontractor (Thursday trigger), submit to Xero.
- **Stock** (`/stock`): Silicone tube and materials inventory with low-stock alerts.
- **Job Reports** (`/admin/reports`): View completed job reports including photos, metres, stock used, and issues.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run codegen after changing `openapi.yaml`: `pnpm --filter @workspace/api-spec run codegen`
- Always push schema after changing Drizzle files: `pnpm --filter @workspace/db run push`
- Zod schema names in `api-zod` may differ from route handler expectations — check `lib/api-zod/src/generated/api.ts` for actual exported names.
- The `today` variable in `field.tsx` is declared after the mutation hooks — don't hoist it above them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
