const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER_TYPE = "job_photo_retention_placeholder";

export type PhotoRetentionStatus =
  | "active"
  | "scheduled_for_deletion"
  | "deleted_under_retention_policy";

export type DeletedPhotoPlaceholder = {
  type: typeof PLACEHOLDER_TYPE;
  status: "deleted_under_retention_policy";
  message: string;
  deletedAt: string;
  retentionDays: number;
  originalIndex: number;
  originalStorage: "postgres_jsonb_base64";
  originalApproxBytes?: number;
};

export type PhotoRetentionSummary = {
  status: PhotoRetentionStatus;
  label: "Active" | "Scheduled for deletion" | "Deleted under retention policy";
  message: string;
  retentionDays: number;
  deleteAfter: string | null;
  activePhotoCount: number;
  deletedPhotoCount: number;
  totalPhotoCount: number;
};

function retentionMessage(retentionDays: number) {
  return `Photos deleted after ${retentionDays}-day retention period.`;
}

function reportCreatedAt(value: Date | string | null | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function deleteAfterDate(
  createdAt: Date | string | null | undefined,
  retentionDays: number,
) {
  const created = reportCreatedAt(createdAt);
  return created ? new Date(created.getTime() + retentionDays * DAY_MS) : null;
}

export function isBase64JobPhoto(photo: unknown): photo is string {
  return typeof photo === "string" && photo.startsWith("data:image");
}

export function isDeletedPhotoPlaceholder(
  photo: unknown,
): photo is DeletedPhotoPlaceholder {
  return (
    typeof photo === "object" &&
    photo !== null &&
    (photo as { type?: unknown }).type === PLACEHOLDER_TYPE &&
    (photo as { status?: unknown }).status === "deleted_under_retention_policy"
  );
}

export function getJobPhotoEntries(photos: unknown): unknown[] {
  return Array.isArray(photos) ? photos : [];
}

export function getActiveJobPhotoData(photos: unknown) {
  return getJobPhotoEntries(photos).filter(isBase64JobPhoto);
}

export function summarizePhotoRetention(input: {
  photos: unknown;
  createdAt: Date | string | null | undefined;
  retentionDays: number;
  now?: Date;
}): PhotoRetentionSummary {
  const now = input.now ?? new Date();
  const photos = getJobPhotoEntries(input.photos);
  const activePhotoCount = photos.filter(isBase64JobPhoto).length;
  const deletedPhotoCount = photos.filter(isDeletedPhotoPlaceholder).length;
  const deleteAfter = deleteAfterDate(input.createdAt, input.retentionDays);
  const isDue = Boolean(deleteAfter && deleteAfter.getTime() <= now.getTime());

  if (activePhotoCount === 0 && deletedPhotoCount > 0) {
    return {
      status: "deleted_under_retention_policy",
      label: "Deleted under retention policy",
      message: retentionMessage(input.retentionDays),
      retentionDays: input.retentionDays,
      deleteAfter: deleteAfter?.toISOString() ?? null,
      activePhotoCount,
      deletedPhotoCount,
      totalPhotoCount: photos.length,
    };
  }

  if (activePhotoCount > 0 && isDue) {
    return {
      status: "scheduled_for_deletion",
      label: "Scheduled for deletion",
      message: `Photos are past the ${input.retentionDays}-day retention period and will be deleted by the daily cleanup.`,
      retentionDays: input.retentionDays,
      deleteAfter: deleteAfter?.toISOString() ?? null,
      activePhotoCount,
      deletedPhotoCount,
      totalPhotoCount: photos.length,
    };
  }

  return {
    status: "active",
    label: "Active",
    message: `Photos are retained for ${input.retentionDays} days from report submission.`,
    retentionDays: input.retentionDays,
    deleteAfter: deleteAfter?.toISOString() ?? null,
    activePhotoCount,
    deletedPhotoCount,
    totalPhotoCount: photos.length,
  };
}

function approximateBase64Bytes(photo: string) {
  const base64 = photo.split(",", 2)[1] ?? photo;
  return Math.max(0, Math.round((base64.length * 3) / 4));
}

function placeholderForPhoto(
  photo: string,
  originalIndex: number,
  retentionDays: number,
  deletedAt: Date,
): DeletedPhotoPlaceholder {
  return {
    type: PLACEHOLDER_TYPE,
    status: "deleted_under_retention_policy",
    message: retentionMessage(retentionDays),
    deletedAt: deletedAt.toISOString(),
    retentionDays,
    originalIndex,
    originalStorage: "postgres_jsonb_base64",
    originalApproxBytes: approximateBase64Bytes(photo),
  };
}

export function applyRetentionToPhotos(input: {
  photos: unknown;
  createdAt: Date | string | null | undefined;
  retentionDays: number;
  now: Date;
}) {
  const photos = getJobPhotoEntries(input.photos);
  const deleteAfter = deleteAfterDate(input.createdAt, input.retentionDays);

  if (!deleteAfter || deleteAfter.getTime() > input.now.getTime()) {
    return { nextPhotos: photos, deletedPhotos: 0 };
  }

  let deletedPhotos = 0;
  const nextPhotos = photos.map((photo, index) => {
    if (!isBase64JobPhoto(photo)) return photo;
    deletedPhotos += 1;
    return placeholderForPhoto(photo, index, input.retentionDays, input.now);
  });

  return { nextPhotos, deletedPhotos };
}
