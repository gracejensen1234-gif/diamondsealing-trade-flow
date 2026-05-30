---
name: AI Audit integration
description: OpenAI GPT-4o vision used server-side for job quality auditing — key, design, and security notes
---

**Rule:** The OpenAI API key (`OPENAI_API_KEY`) is a user-supplied Replit Secret. Access it only from `artifacts/api-server/src/lib/openai-client.ts`. Never import the openai package or key in any frontend package.

**Model used:** `gpt-4o` with `response_format: { type: "json_object" }` and `max_tokens: 1500`. Uses vision (image inputs) for completion photos.

**Two separate endpoints:**
- `POST /audit/run` — rule-based flags only (`aiGenerated: false`)
- `POST /audit/ai-run` — GPT vision analysis (`aiGenerated: true`)

Both write to the same `audit_flags` table. The `aiGenerated` boolean column distinguishes them. Flags are for admin review only — no automatic penalties.

**What AI analyses per job report:**
- Metres completed, stock used (names + quantities), issue type + description, general notes
- Up to 4 completion photos as base64 `image_url` items (`detail: "low"`)
- Location verification events (eventType, status, distance)

**Photo format:** Photos stored as base64 data URLs (`data:image/...;base64,...`) in `job_reports.photos` (jsonb). Passed directly to GPT vision. Limited to 4 per report.

**Output format:** GPT returns `{ flags: [...] }` JSON. Each flag: flagType (from enum), severity, title, description, suggestedAction. `suggestedAction` stored in `evidence.suggestedAction` on the DB row.

**Security:** `openai` npm package installed only in `@workspace/api-server` (dependencies). Key never touches the frontend or any client-side bundle. If `OPENAI_API_KEY` is missing at startup, the server throws immediately with a clear message.

**Why:** User explicitly added their own API key to Replit Secrets — do not replace with Replit AI Integrations proxy.
