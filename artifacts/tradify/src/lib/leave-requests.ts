export type LeaveRequestStatus = "pending" | "approved" | "declined" | "cancelled";

export type LeaveRequest = {
  id: number;
  subcontractorId: number;
  subcontractorName?: string;
  dayOffDate: string;
  reason?: string | null;
  status: LeaveRequestStatus;
  adminNote?: string | null;
  decidedAt?: string | null;
  createdAt: string;
};

export function todayDateInputValue() {
  return dateInputValue(new Date());
}

export function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function dateFromInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day);
}

export function formatDayOffDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function leaveStatusLabel(status: LeaveRequestStatus) {
  const labels: Record<LeaveRequestStatus, string> = {
    pending: "Pending",
    approved: "Approved",
    declined: "Declined",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

export function leaveStatusBadgeVariant(status: LeaveRequestStatus) {
  if (status === "approved") return "default";
  if (status === "declined") return "destructive";
  if (status === "cancelled") return "outline";
  return "secondary";
}
