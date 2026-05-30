---
name: Backend route paths
description: Actual API paths for the new wave-2 routes; several differ from intuitive names
---

Always grep `router.get|router.post|router.patch` in the route file before writing frontend fetch URLs. Known non-obvious mappings:

| Feature | Frontend expects | Actual backend path |
|---|---|---|
| AI audit flags | `/api/audit-flags` | `/api/audit/flags` |
| AI audit scores | `/api/audit-scores` | `/api/audit/scores` |
| AI audit run | `/api/audit-flags/run/:id` | `POST /api/audit/run` |
| Suppliers | `/api/suppliers` | `/api/supplier-profiles` |
| Inventory transactions | `/api/sub-inventory/transactions` | `/api/inventory-transactions` |
| Restock requests | `/api/sub-inventory/restock-requests` | `/api/restock-requests` |
| Weekly planner approve/reject | `POST .../approve` | `PATCH /api/weekly-planner/:id` with `{ status: "approved"|"rejected" }` |

**Why:** Route files were written before pages; naming conventions drifted between the two.

**How to apply:** Before writing `fetch("/api/...")` in any new page, run `grep "router\." artifacts/api-server/src/routes/<file>.ts` to confirm the registered path.
