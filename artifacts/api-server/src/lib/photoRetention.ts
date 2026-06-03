import { and, eq } from "drizzle-orm";
import { db, jobReportsTable } from "@workspace/db";
import { logger } from "./logger.js";
import {
  applyRetentionToPhotos,
  getActiveJobPhotoData,
  getJobPhotoEntries,
  isBase64JobPhoto,
  isDeletedPhotoPlaceholder,
  summarizePhotoRetention,
  type DeletedPhotoPlaceholder,
  type PhotoRetentionStatus,
  type PhotoRetentionSummary,
} from "./photoRetentionPolicy.js";

export {
  getActiveJobPhotoData,
  getJobPhotoEntries,
  isBase64JobPhoto,
  isDeletedPhotoPlaceholder,
};
export type {
  DeletedPhotoPlaceholder,
  PhotoRetentionStatus,
  PhotoRetentionSummary,
};

const DEFAULT_RETENTION_DAYS = 90;
const DAILY_CLEANUP_MS = 24 * 60 * 60 * 1000;
const STARTUP_CLEANUP_DELAY_MS = 10 * 60 * 1000;

export type PhotoRetentionCleanupResult = {
  retentionDays: number;
  dryRun: boolean;
  checkedReports: number;
  updatedReports: number;
  deletedPhotos: number;
  errors: Array<{ reportId: number; message: string }>;
};

export function getJobPhotoRetentionDays() {
  const raw = process.env.JOB_PHOTO_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    logger.warn(
      { value: raw, defaultRetentionDays: DEFAULT_RETENTION_DAYS },
      "invalid JOB_PHOTO_RETENTION_DAYS; using default",
    );
    return DEFAULT_RETENTION_DAYS;
  }

  return parsed;
}

export function getPhotoRetentionSummary(input: {
  photos: unknown;
  createdAt: Date | string | null | undefined;
  retentionDays?: number;
  now?: Date;
}): PhotoRetentionSummary {
  return summarizePhotoRetention({
    photos: input.photos,
    createdAt: input.createdAt,
    retentionDays: input.retentionDays ?? getJobPhotoRetentionDays(),
    now: input.now,
  });
}

export async function getPhotoRetentionCompanyStatus(companyId: number) {
  const reports = await db
    .select({
      id: jobReportsTable.id,
      createdAt: jobReportsTable.createdAt,
      photos: jobReportsTable.photos,
    })
    .from(jobReportsTable)
    .where(eq(jobReportsTable.companyId, companyId));

  const retentionDays = getJobPhotoRetentionDays();
  const counts: Record<PhotoRetentionStatus, number> = {
    active: 0,
    scheduled_for_deletion: 0,
    deleted_under_retention_policy: 0,
  };

  for (const report of reports) {
    counts[
      getPhotoRetentionSummary({
        photos: report.photos,
        createdAt: report.createdAt,
        retentionDays,
      }).status
    ] += 1;
  }

  return {
    retentionDays,
    checkedReports: reports.length,
    counts,
  };
}

export async function cleanupExpiredJobReportPhotos(
  options: {
    companyId?: number;
    dryRun?: boolean;
    now?: Date;
  } = {},
): Promise<PhotoRetentionCleanupResult> {
  const retentionDays = getJobPhotoRetentionDays();
  const now = options.now ?? new Date();
  const dryRun = Boolean(options.dryRun);
  const reports = options.companyId
    ? await db
        .select()
        .from(jobReportsTable)
        .where(eq(jobReportsTable.companyId, options.companyId))
    : await db.select().from(jobReportsTable);

  const result: PhotoRetentionCleanupResult = {
    retentionDays,
    dryRun,
    checkedReports: reports.length,
    updatedReports: 0,
    deletedPhotos: 0,
    errors: [],
  };

  for (const report of reports) {
    try {
      const { nextPhotos, deletedPhotos } = applyRetentionToPhotos({
        photos: report.photos,
        createdAt: report.createdAt,
        retentionDays,
        now,
      });

      if (deletedPhotos === 0) continue;

      result.updatedReports += 1;
      result.deletedPhotos += deletedPhotos;

      if (!dryRun) {
        const updateWhere =
          report.companyId == null
            ? eq(jobReportsTable.id, report.id)
            : and(
                eq(jobReportsTable.id, report.id),
                eq(jobReportsTable.companyId, report.companyId),
              );
        await db
          .update(jobReportsTable)
          .set({ photos: nextPhotos })
          .where(updateWhere);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push({ reportId: report.id, message });
      logger.error(
        { err: error, reportId: report.id },
        "job photo retention cleanup failed for report",
      );
    }
  }

  logger.info(
    {
      retentionDays,
      dryRun,
      checkedReports: result.checkedReports,
      updatedReports: result.updatedReports,
      deletedPhotos: result.deletedPhotos,
      errors: result.errors.length,
    },
    "job photo retention cleanup finished",
  );

  return result;
}

let retentionScheduleStarted = false;

export function startJobPhotoRetentionSchedule() {
  if (retentionScheduleStarted) return;
  retentionScheduleStarted = true;

  const runCleanup = () => {
    void cleanupExpiredJobReportPhotos().catch((err) => {
      logger.error({ err }, "scheduled job photo retention cleanup failed");
    });
  };

  const startupTimer = setTimeout(runCleanup, STARTUP_CLEANUP_DELAY_MS);
  const dailyTimer = setInterval(runCleanup, DAILY_CLEANUP_MS);
  startupTimer.unref?.();
  dailyTimer.unref?.();

  logger.info(
    { retentionDays: getJobPhotoRetentionDays() },
    "job photo retention schedule started",
  );
}
