export function phoneHref(phone?: string | null) {
  const trimmed = phone?.trim();
  if (!trimmed) return null;

  let dialable = trimmed.replace(/[^\d+]/g, "");
  if (dialable.startsWith("+")) {
    dialable = `+${dialable.slice(1).replace(/\+/g, "")}`;
  } else {
    dialable = dialable.replace(/\+/g, "");
  }

  return dialable ? `tel:${dialable}` : null;
}
