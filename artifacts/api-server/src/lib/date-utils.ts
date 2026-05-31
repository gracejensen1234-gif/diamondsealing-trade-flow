export function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return value.split("T")[0];
}

export function dateOnlyOrToday(value: Date | string | null | undefined): string {
  return dateOnly(value) ?? new Date().toISOString().split("T")[0];
}

export function workSessionMinutes(session: {
  clockedOnAt: Date | null;
  clockedOffAt: Date | null;
  totalBreakMinutes: number;
}): number {
  if (!session.clockedOnAt || !session.clockedOffAt) return 0;
  const totalMs = new Date(session.clockedOffAt).getTime() - new Date(session.clockedOnAt).getTime();
  return Math.max(0, Math.round(totalMs / 60000) - session.totalBreakMinutes);
}
