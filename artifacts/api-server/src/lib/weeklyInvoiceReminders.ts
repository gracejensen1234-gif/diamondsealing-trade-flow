import { and, eq, gte, lte } from "drizzle-orm";
import {
  db,
  jobReportsTable,
  notificationsTable,
  subcontractorsTable,
  weeklyInvoicesTable,
} from "@workspace/db";
import { createAndSendNotification } from "./notificationService.js";
import { logger } from "./logger.js";

const DEFAULT_TIME_ZONE = "Australia/Brisbane";
const DEFAULT_REMINDER_DAY = 4; // Thursday, using JavaScript getDay numbering.
const DEFAULT_REMINDER_HOUR = 18; // 6pm.
const REMINDER_CHECK_MS = 15 * 60 * 1000;

type WeeklyInvoiceLineItem = {
  reportId?: number | null;
};

type ReminderResult = {
  weekStart: string;
  weekEnd: string;
  checkedWorkers: number;
  sent: number;
  skippedNoWork: number;
  skippedAlreadySubmitted: number;
  skippedDuplicate: number;
  errors: number;
};

function configuredInteger(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    logger.warn({ name, value: raw, fallback }, "invalid invoice reminder setting");
    return fallback;
  }

  return parsed;
}

function localDateParts(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const minute = Number(parts.minute);
  const localMidday = new Date(Date.UTC(year, month - 1, day, 12));

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: localMidday.getUTCDay(),
  };
}

function dateOnly(date: Date) {
  return date.toISOString().split("T")[0];
}

function weekRangeForLocalDate(parts: ReturnType<typeof localDateParts>) {
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const day = localDate.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(localDate);
  monday.setUTCDate(localDate.getUTCDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: dateOnly(monday),
    weekEnd: dateOnly(sunday),
  };
}

function submittedReportIds(invoices: Array<typeof weeklyInvoicesTable.$inferSelect>) {
  const ids = new Set<number>();
  for (const invoice of invoices) {
    if (
      invoice.status !== "submitted" &&
      invoice.status !== "paid" &&
      !invoice.workerAcknowledgedAt
    ) {
      continue;
    }

    const items = Array.isArray(invoice.lineItems)
      ? (invoice.lineItems as WeeklyInvoiceLineItem[])
      : [];
    for (const item of items) {
      if (item.reportId) ids.add(item.reportId);
    }
  }

  return ids;
}

function hasInvoiceSubmittedOrAcknowledged(
  invoices: Array<typeof weeklyInvoicesTable.$inferSelect>,
) {
  return invoices.some(
    (invoice) =>
      invoice.status === "submitted" ||
      invoice.status === "paid" ||
      Boolean(invoice.workerAcknowledgedAt),
  );
}

function shouldRunReminder(now = new Date()) {
  const timeZone = process.env.INVOICE_REMINDER_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE;
  const reminderDay = configuredInteger(
    "INVOICE_REMINDER_DAY",
    DEFAULT_REMINDER_DAY,
    0,
    6,
  );
  const reminderHour = configuredInteger(
    "INVOICE_REMINDER_HOUR",
    DEFAULT_REMINDER_HOUR,
    0,
    23,
  );
  const parts = localDateParts(now, timeZone);

  return {
    shouldRun: parts.weekday === reminderDay && parts.hour >= reminderHour,
    timeZone,
    parts,
    ...weekRangeForLocalDate(parts),
  };
}

export async function sendWeeklyInvoiceReminders(now = new Date()): Promise<ReminderResult | null> {
  const run = shouldRunReminder(now);
  if (!run.shouldRun) return null;

  const reminderKey = `weekly_invoice_reminder:${run.weekStart}`;
  const workers = await db
    .select()
    .from(subcontractorsTable)
    .where(eq(subcontractorsTable.active, true));

  const result: ReminderResult = {
    weekStart: run.weekStart,
    weekEnd: run.weekEnd,
    checkedWorkers: workers.length,
    sent: 0,
    skippedNoWork: 0,
    skippedAlreadySubmitted: 0,
    skippedDuplicate: 0,
    errors: 0,
  };

  for (const worker of workers) {
    if (!worker.companyId) continue;

    try {
      const [reports, invoices, existingReminder] = await Promise.all([
        db
          .select()
          .from(jobReportsTable)
          .where(
            and(
              eq(jobReportsTable.companyId, worker.companyId),
              eq(jobReportsTable.subcontractorId, worker.id),
              gte(jobReportsTable.dispatchDate, run.weekStart),
              lte(jobReportsTable.dispatchDate, run.weekEnd),
            ),
          ),
        db
          .select()
          .from(weeklyInvoicesTable)
          .where(
            and(
              eq(weeklyInvoicesTable.companyId, worker.companyId),
              eq(weeklyInvoicesTable.subcontractorId, worker.id),
              eq(weeklyInvoicesTable.weekStartDate, run.weekStart),
            ),
          ),
        db
          .select({ id: notificationsTable.id })
          .from(notificationsTable)
          .where(
            and(
              eq(notificationsTable.companyId, worker.companyId),
              eq(notificationsTable.subcontractorId, worker.id),
              eq(notificationsTable.type, "general"),
              eq(notificationsTable.linkedEntityType, reminderKey),
            ),
          )
          .limit(1),
      ]);

      if (existingReminder.length > 0) {
        result.skippedDuplicate += 1;
        continue;
      }

      if (hasInvoiceSubmittedOrAcknowledged(invoices)) {
        result.skippedAlreadySubmitted += 1;
        continue;
      }

      const alreadySubmittedReports = submittedReportIds(invoices);
      const uninvoicedReports = reports.filter((report) => !alreadySubmittedReports.has(report.id));
      if (uninvoicedReports.length === 0) {
        result.skippedNoWork += 1;
        continue;
      }

      await createAndSendNotification({
        subcontractorId: worker.id,
        type: "general",
        title: "Weekly invoice reminder",
        body: "Please review and submit this week's invoice before the end of tonight.",
        priority: "normal",
        actionUrl: "/field/pay",
        linkedEntityType: reminderKey,
      });

      result.sent += 1;
    } catch (err) {
      result.errors += 1;
      logger.warn(
        { err, subcontractorId: worker.id, weekStart: run.weekStart },
        "weekly invoice reminder failed for worker",
      );
    }
  }

  logger.info(
    {
      ...result,
      timeZone: run.timeZone,
      reminderLocalHour: run.parts.hour,
      reminderLocalMinute: run.parts.minute,
    },
    "weekly invoice reminder check finished",
  );

  return result;
}

let weeklyInvoiceReminderScheduleStarted = false;

export function startWeeklyInvoiceReminderSchedule() {
  if (weeklyInvoiceReminderScheduleStarted) return;
  weeklyInvoiceReminderScheduleStarted = true;

  const runReminder = () => {
    void sendWeeklyInvoiceReminders().catch((err) => {
      logger.error({ err }, "scheduled weekly invoice reminder failed");
    });
  };

  const startupTimer = setTimeout(runReminder, 60_000);
  const intervalTimer = setInterval(runReminder, REMINDER_CHECK_MS);
  startupTimer.unref?.();
  intervalTimer.unref?.();

  logger.info(
    {
      timeZone: process.env.INVOICE_REMINDER_TIME_ZONE?.trim() || DEFAULT_TIME_ZONE,
      reminderDay: configuredInteger("INVOICE_REMINDER_DAY", DEFAULT_REMINDER_DAY, 0, 6),
      reminderHour: configuredInteger("INVOICE_REMINDER_HOUR", DEFAULT_REMINDER_HOUR, 0, 23),
    },
    "weekly invoice reminder schedule started",
  );
}
