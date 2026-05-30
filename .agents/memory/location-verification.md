---
name: Location verification design
description: Point-in-time GPS verification at clock-on/off and job arrived/departed — not continuous tracking
---

**Rule:** Never use continuous GPS tracking. Location is checked once per event and immediately discarded after verification.

**Four events that trigger a verification:** `clock_on`, `clock_off`, `job_arrived`, `job_departed`.

**Flow:**
1. Worker taps action button → `requestLocationVerification()` shows a consent card in the UI
2. Consent card text: "Your location will activate briefly to confirm you are at the job address. This is not continuous tracking."
3. Worker taps Allow → browser `getCurrentPosition()` → POST to `/api/location-verifications` with coordinates
4. Worker taps Skip → POST with `status: "skipped"` — action still proceeds
5. Result shown as toast: "✓ Location confirmed (Xm away)" or "⚠ Far from job — admin flagged"

**Geocoding:** Server calls Nominatim (OpenStreetMap) for the job address. Result cached on `jobs.addressLat` / `jobs.addressLng` for future checks. Nominatim has `countrycodes=au` and a 5-second timeout. If it fails, status = `geocode_failed`.

**Distance:** Haversine formula server-side. Threshold = 500m. Status = `verified` if within, `outside_range` if not.

**Statuses:** `verified`, `outside_range`, `skipped`, `location_error`, `no_job_address`, `geocode_failed`, `captured` (clock-on/off without a reference address).

**Admin review:** Failed/skipped verifications appear as flagged cards at the top of Admin Live page. Click "Reviewed" to dismiss.

**Why:** Continuous GPS is invasive, drains battery, and was replaced by the user's explicit direction to use point-in-time checks only.
