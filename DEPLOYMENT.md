# Diamond Sealing Deployment

The app needs a hosted Node web service and a PostgreSQL database.

## Render

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from this repository.
3. Render reads `render.yaml`, creates:
   - `diamond-sealing-operations` web service
   - `diamond-sealing-db` PostgreSQL database
4. Deploy.
5. Add secret values in Render when you are ready to switch those features on:
   - `OPENAI_API_KEY` for AI photo auditing
   - `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` for stable push notifications
   - `XERO_REDIRECT_URI` after the live URL is known

The start command pushes the current Drizzle schema to the database, then starts the API server. The API server serves `/api/*` and the built React app from the same domain.

The first deployment uses Render free instance types so you can test the app live before adding billing details. Free web services can sleep after inactivity, and free Postgres databases are for short trial use rather than long-term business records.

## Required Environment

- `DATABASE_URL`
- `PORT`
- `NODE_ENV=production`
- `BASE_PATH=/`

Optional but recommended:

- `OPENAI_API_KEY`
- `OPENAI_AUDIT_MODEL=gpt-4o`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT=mailto:admin@diamondsealing.com.au`
- `XERO_REDIRECT_URI`
