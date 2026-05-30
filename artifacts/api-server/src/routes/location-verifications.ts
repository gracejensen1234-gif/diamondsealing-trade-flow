import { Router } from "express";
import { db } from "@workspace/db";
import {
  locationVerificationsTable,
  subcontractorsTable,
  workSessionsTable,
  jobAssignmentsTable,
  jobsTable,
} from "@workspace/db";
import { eq, and, desc, or } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ─── Haversine distance (metres) ─────────────────────────────────────────────
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Nominatim geocoding (best-effort, no API key) ───────────────────────────
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=au`;
    const res = await fetch(url, {
      headers: { "User-Agent": "DiamondSealing/1.0 (ops-app)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat: string; lon: string }[];
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── POST /location-verifications ────────────────────────────────────────────
router.post("/location-verifications", async (req, res) => {
  const {
    subcontractorId,
    workSessionId,
    jobAssignmentId,
    eventType,
    reportedLat,
    reportedLng,
    reportedAccuracyMetres,
    workerConsented,
    status: clientStatus,
  } = req.body;

  if (!subcontractorId || !eventType) {
    return res.status(400).json({ error: "subcontractorId and eventType are required" });
  }

  const validEvents = ["clock_on", "clock_off", "job_arrived", "job_departed"];
  if (!validEvents.includes(eventType)) {
    return res.status(400).json({ error: "Invalid eventType" });
  }

  // Worker skipped or browser errored — just record the skip/error
  if (clientStatus === "skipped" || clientStatus === "location_error") {
    const [record] = await db
      .insert(locationVerificationsTable)
      .values({
        subcontractorId,
        workSessionId: workSessionId ?? null,
        jobAssignmentId: jobAssignmentId ?? null,
        eventType,
        status: clientStatus,
        workerConsented: workerConsented ?? false,
      })
      .returning();
    return res.status(201).json(record);
  }

  // Location was provided — try to resolve distance
  let jobAddress: string | null = null;
  let jobAddressLat: number | null = null;
  let jobAddressLng: number | null = null;
  let distanceMetres: number | null = null;
  let withinBounds: boolean | null = null;
  const ALLOWED_METRES = 500;
  let finalStatus: string = "captured";

  if (jobAssignmentId) {
    // Fetch the associated job address
    const [assignment] = await db
      .select({
        jobId: jobAssignmentsTable.jobId,
        address: jobsTable.address,
        addressLat: jobsTable.addressLat,
        addressLng: jobsTable.addressLng,
      })
      .from(jobAssignmentsTable)
      .leftJoin(jobsTable, eq(jobAssignmentsTable.jobId, jobsTable.id))
      .where(eq(jobAssignmentsTable.id, jobAssignmentId));

    if (assignment?.address) {
      jobAddress = assignment.address;

      let lat = assignment.addressLat ? Number(assignment.addressLat) : null;
      let lng = assignment.addressLng ? Number(assignment.addressLng) : null;

      // Geocode if not already cached on the job
      if (lat === null || lng === null) {
        const geocoded = await geocodeAddress(assignment.address);
        if (geocoded) {
          lat = geocoded.lat;
          lng = geocoded.lng;
          // Cache on the job row for next time
          if (assignment.jobId) {
            await db
              .update(jobsTable)
              .set({ addressLat: String(lat), addressLng: String(lng) })
              .where(eq(jobsTable.id, assignment.jobId));
          }
        }
      }

      if (lat !== null && lng !== null) {
        jobAddressLat = lat;
        jobAddressLng = lng;

        if (reportedLat != null && reportedLng != null) {
          distanceMetres = Math.round(
            haversineMetres(reportedLat, reportedLng, lat, lng)
          );
          withinBounds = distanceMetres <= ALLOWED_METRES;
          finalStatus = withinBounds ? "verified" : "outside_range";
        }
      } else {
        finalStatus = "geocode_failed";
      }
    } else {
      finalStatus = "no_job_address";
    }
  } else {
    // Clock-on / clock-off without a specific job — just capture location
    finalStatus = "captured";
  }

  const [record] = await db
    .insert(locationVerificationsTable)
    .values({
      subcontractorId,
      workSessionId: workSessionId ?? null,
      jobAssignmentId: jobAssignmentId ?? null,
      eventType,
      reportedLat: reportedLat != null ? String(reportedLat) : null,
      reportedLng: reportedLng != null ? String(reportedLng) : null,
      reportedAccuracyMetres:
        reportedAccuracyMetres != null ? String(reportedAccuracyMetres) : null,
      jobAddress,
      jobAddressLat: jobAddressLat != null ? String(jobAddressLat) : null,
      jobAddressLng: jobAddressLng != null ? String(jobAddressLng) : null,
      distanceMetres: distanceMetres != null ? String(distanceMetres) : null,
      allowedDistanceMetres: ALLOWED_METRES,
      withinBounds,
      status: finalStatus as any,
      workerConsented: workerConsented ?? false,
    })
    .returning();

  logger.info({ event: eventType, subcontractorId, status: finalStatus, distanceMetres }, "location verification recorded");
  return res.status(201).json({
    ...record,
    reportedLat: record.reportedLat ? Number(record.reportedLat) : null,
    reportedLng: record.reportedLng ? Number(record.reportedLng) : null,
    distanceMetres: record.distanceMetres ? Number(record.distanceMetres) : null,
    withinBounds: record.withinBounds,
  });
});

// ─── GET /location-verifications ─────────────────────────────────────────────
router.get("/location-verifications", async (req, res) => {
  const subcontractorId = req.query.subcontractorId ? Number(req.query.subcontractorId) : undefined;
  const date = req.query.date as string | undefined;
  const flagsOnly = req.query.flagsOnly === "true";

  const conditions = [];
  if (subcontractorId) {
    conditions.push(eq(locationVerificationsTable.subcontractorId, subcontractorId));
  }
  if (flagsOnly) {
    conditions.push(
      or(
        eq(locationVerificationsTable.status, "outside_range"),
        eq(locationVerificationsTable.status, "skipped"),
        eq(locationVerificationsTable.status, "location_error"),
        eq(locationVerificationsTable.status, "geocode_failed"),
      )!
    );
  }

  let rows = await db
    .select({
      lv: locationVerificationsTable,
      subName: subcontractorsTable.name,
    })
    .from(locationVerificationsTable)
    .leftJoin(subcontractorsTable, eq(locationVerificationsTable.subcontractorId, subcontractorsTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(locationVerificationsTable.createdAt))
    .limit(200);

  if (date) {
    rows = rows.filter((r) => r.lv.createdAt.toISOString().startsWith(date));
  }

  return res.json(
    rows.map(({ lv, subName }) => ({
      ...lv,
      subcontractorName: subName ?? null,
      reportedLat: lv.reportedLat ? Number(lv.reportedLat) : null,
      reportedLng: lv.reportedLng ? Number(lv.reportedLng) : null,
      distanceMetres: lv.distanceMetres ? Number(lv.distanceMetres) : null,
    }))
  );
});

// ─── PATCH /location-verifications/:id/review ────────────────────────────────
router.patch("/location-verifications/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });

  const { adminNotes } = req.body;
  const [updated] = await db
    .update(locationVerificationsTable)
    .set({ adminReviewed: true, adminNotes: adminNotes ?? null })
    .where(eq(locationVerificationsTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ error: "Not found" });
  return res.json(updated);
});

export default router;
