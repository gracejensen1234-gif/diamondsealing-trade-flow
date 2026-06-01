export type PushPermissionState = NotificationPermission | "unsupported" | "unknown";

export function pushNotificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

export function currentPushPermission(): PushPermissionState {
  if (!pushNotificationsSupported()) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!pushNotificationsSupported()) return null;
  try {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    return await navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` });
  } catch {
    return null;
  }
}

export async function hasBrowserPushSubscription() {
  if (!pushNotificationsSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function subscribeToPush(subcontractorId: number, vapidPublicKey: string) {
  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, permission: currentPushPermission() };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, permission };

  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    });

    const json = sub.toJSON();
    const response = await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subcontractorId,
        endpoint: json.endpoint,
        p256dh: (json.keys as any).p256dh,
        auth: (json.keys as any).auth,
        userAgent: navigator.userAgent,
      }),
    });

    return { ok: response.ok, permission };
  } catch {
    return { ok: false, permission: currentPushPermission() };
  }
}
