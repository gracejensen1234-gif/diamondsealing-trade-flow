---
name: Photo policy — no before photos
description: Before photos are explicitly removed from the workflow; only completion photos are required
---

**Rule:** Never add before-photo requirements to any part of the job workflow.

**What is required:** Completion photos (labeled "Completion Photos" in the UI). At least 1 must be submitted with a job report. These are used for AI quality auditing.

**What is NOT required:** Before photos. They were explicitly removed by the user.

**AI auditing scope:** Completion photos, job records, stock usage, metres, notes, location verification events, and issue reports. Not before-photo compliance.

**Docket schema:** `photosBefore` field exists in the Docket OpenAPI schema (for builder sign-off sheets) but is optional and not enforced in any workflow.

**Why:** User's explicit instruction — "No we won't do before photos."
