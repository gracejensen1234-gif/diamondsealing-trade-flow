import { Router } from "express";
import { db } from "@workspace/db";
import { gpsTracksTable, workSessionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { PushGpsLocationBody } from "@workspace/api-zod";
import { companyId, requireSubcontractorAccess } from "../lib/auth.js";

const router = Router();

router.post("/gps/location", async (req, res) => {
  const parsed = PushGpsLocationBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (!requireSubcontractorAccess(req, res, parsed.data.subcontractorId)) return;

  const today = new Date().toISOString().split("T")[0];
  const [session] = await db.select().from(workSessionsTable).where(
    and(
      eq(workSessionsTable.companyId, companyId(req)),
      eq(workSessionsTable.subcontractorId, parsed.data.subcontractorId),
      eq(workSessionsTable.date, today),
    )
  );

  if (!session || session.status === "clocked_off") {
    return res.status(400).json({ error: "No active session — GPS tracking is off" });
  }
  if (session.gpsDisabledOnBreak && session.status === "on_break") {
    return res.status(400).json({ error: "GPS paused during break" });
  }

  const [track] = await db.insert(gpsTracksTable).values({
    companyId: companyId(req),
    subcontractorId: parsed.data.subcontractorId,
    workSessionId: parsed.data.workSessionId ?? session.id,
    latitude: String(parsed.data.latitude),
    longitude: String(parsed.data.longitude),
    accuracy: parsed.data.accuracy != null ? String(parsed.data.accuracy) : null,
  }).returning();

  return res.status(201).json({
    ...track,
    latitude: Number(track.latitude),
    longitude: Number(track.longitude),
    accuracy: track.accuracy ? Number(track.accuracy) : null,
  });
});

export default router;
