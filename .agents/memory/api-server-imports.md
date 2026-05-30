---
name: API server import paths
description: Correct import paths for db, logger, and notification service inside api-server/src/
---

**Rule:** Never use relative `../db` — use the workspace package alias instead.

| What | From routes/ | From lib/ |
|---|---|---|
| DB client + tables | `import { db, someTable } from "@workspace/db"` | `import { db } from "@workspace/db"` |
| Logger | `import { logger } from "../lib/logger"` | `import { logger } from "./logger"` |
| Notification service | `import { createAndSendNotification } from "../lib/notificationService"` | n/a |

**Why:** esbuild resolves `@workspace/db` correctly via the pnpm workspace alias; `"../db"` does not resolve because there is no `db.ts` file adjacent to `src/` — the DB package is a separate workspace lib.

**How to apply:** When adding any new route or lib file, always use `@workspace/db` for the database, not relative paths.
