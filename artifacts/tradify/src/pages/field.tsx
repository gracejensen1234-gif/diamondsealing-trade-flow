import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "wouter";
import {
  useListSubcontractors,
  useGetTodaySession,
  useClockOn,
  useClockOff,
  useStartBreak,
  useEndBreak,
  useListDispatch,
  useMarkArrived,
  useMarkDeparted,
  useUpdateJobAssignment,
  getGetTodaySessionQueryKey,
  getListDispatchQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { PhoneSetupCard } from "@/components/phone-setup-card";
import {
  MapPin, Clock, RotateCcw, AlertTriangle, Play, Square, Pause,
  Bell, BellOff, X, ChevronRight, Navigation, CheckCircle2, XCircle,
} from "lucide-react";

// ─── Push notification helpers ───────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    const reg = await navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` });
    return reg;
  } catch {
    return null;
  }
}

async function subscribeToPush(subcontractorId: number, vapidPublicKey: string) {
  const reg = await registerServiceWorker();
  if (!reg) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

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
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Location verification ────────────────────────────────────────────────────

type LocationPrompt = {
  eventLabel: string;
  jobAddress?: string;
  onAllow: () => void;
  onSkip: () => void;
};

async function getBrowserLocation(): Promise<GeolocationCoordinates | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => resolve(null),
      { timeout: 10000, enableHighAccuracy: true },
    )
  );
}

async function postLocationVerification(payload: Record<string, unknown>) {
  try {
    const res = await fetch("/api/location-verifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as { status: string; distanceMetres?: number | null; withinBounds?: boolean | null };
  } catch {}
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function FieldView() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const isWorker = user?.role === "worker";

  const [subId, setSubId] = useState<number | undefined>(() => {
    if (user?.role === "worker") return user.subcontractorId ?? undefined;
    const saved = localStorage.getItem("ds_selected_subcontractor_id");
    return saved ? parseInt(saved) : undefined;
  });

  const [dismissedBanner, setDismissedBanner] = useState<number[]>([]);
  const [locationPrompt, setLocationPrompt] = useState<LocationPrompt | null>(null);

  // Push notification state
  const [pushStatus, setPushStatus] = useState<"unknown" | "granted" | "denied" | "unsupported" | "default">("unknown");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);

  useEffect(() => {
    if (isWorker) {
      setSubId(user?.subcontractorId ?? undefined);
    }
  }, [isWorker, user?.subcontractorId]);

  useEffect(() => {
    if (isWorker) return;
    if (subId) {
      localStorage.setItem("ds_selected_subcontractor_id", subId.toString());
    } else {
      localStorage.removeItem("ds_selected_subcontractor_id");
    }
  }, [isWorker, subId]);

  // Check push status on mount
  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushStatus("unsupported");
      return;
    }
    const perm = Notification.permission;
    setPushStatus(perm as "granted" | "denied" | "unknown");

    fetch("/api/push-subscriptions/vapid-public-key")
      .then((r) => r.json())
      .then((d) => {
        setVapidKey(d.publicKey);
        if (perm === "default") setShowPushPrompt(true);
      })
      .catch(() => {});

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setPushSubscribed(!!sub))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (subId && pushStatus === "default") setShowPushPrompt(true);
  }, [subId, pushStatus]);

  const handleEnablePush = useCallback(async () => {
    if (!subId || !vapidKey) return;
    const ok = await subscribeToPush(subId, vapidKey);
    if (ok) {
      setPushSubscribed(true);
      setPushStatus("granted");
      setShowPushPrompt(false);
      queryClient.invalidateQueries({ queryKey: ["push-subscription-status", subId] });
      toast({ title: "Notifications enabled", description: "You'll get alerts for new jobs, reminders, and updates." });
    } else {
      setPushStatus("denied");
      setShowPushPrompt(false);
      toast({ title: "Notifications blocked", description: "You can enable them in your browser settings.", variant: "destructive" });
    }
  }, [subId, vapidKey, queryClient, toast]);

  // ─── Location verification helper ────────────────────────────────────────
  const requestLocationVerification = useCallback(
    (
      eventType: string,
      eventLabel: string,
      opts: { jobAssignmentId?: number; jobAddress?: string; workSessionId?: number },
    ) =>
      new Promise<void>((resolve) => {
        setLocationPrompt({
          eventLabel,
          jobAddress: opts.jobAddress,
          onSkip: async () => {
            setLocationPrompt(null);
            await postLocationVerification({
              subcontractorId: subId,
              eventType,
              jobAssignmentId: opts.jobAssignmentId ?? null,
              workSessionId: opts.workSessionId ?? null,
              status: "skipped",
              workerConsented: false,
            });
            resolve();
          },
          onAllow: async () => {
            setLocationPrompt(null);
            const coords = await getBrowserLocation();
            if (!coords) {
              await postLocationVerification({
                subcontractorId: subId,
                eventType,
                jobAssignmentId: opts.jobAssignmentId ?? null,
                workSessionId: opts.workSessionId ?? null,
                status: "location_error",
                workerConsented: true,
              });
              toast({ title: "Location unavailable", description: "Could not get your location. Event recorded.", variant: "destructive" });
              resolve();
              return;
            }
            const result = await postLocationVerification({
              subcontractorId: subId,
              eventType,
              jobAssignmentId: opts.jobAssignmentId ?? null,
              workSessionId: opts.workSessionId ?? null,
              reportedLat: coords.latitude,
              reportedLng: coords.longitude,
              reportedAccuracyMetres: coords.accuracy,
              workerConsented: true,
            });
            if (result?.status === "verified") {
              toast({ title: "✓ Location confirmed", description: `You are at the job address (${result.distanceMetres ?? 0}m away).` });
            } else if (result?.status === "outside_range") {
              toast({
                title: "⚠ Location check — far from job",
                description: `You appear to be ${result.distanceMetres ?? "?"}m from the job address. Admin has been flagged.`,
                variant: "destructive",
              });
            }
            resolve();
          },
        });
      }),
    [subId, toast],
  );

  const { data: subs, isLoading: loadingSubs } = useListSubcontractors();

  const { data: session, isLoading: loadingSession } = useGetTodaySession(
    { subcontractorId: subId! },
    { query: { enabled: !!subId, queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId! }) } }
  );

  const { data: dispatchList, isLoading: loadingDispatch, refetch: refetchDispatch } = useListDispatch(
    { subcontractorId: subId, date: new Date().toISOString().split("T")[0] },
    { query: { enabled: !!subId, queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split("T")[0] }) } }
  );

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["unread-count", subId],
    queryFn: () => {
      if (!subId) return Promise.resolve({ count: 0 });
      return fetch(`/api/notifications/unread-count?subcontractorId=${subId}`).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 20000,
  });

  const { data: pushServerStatus } = useQuery<{ enabled: boolean; subscriptionCount: number }>({
    queryKey: ["push-subscription-status", subId],
    queryFn: async () => {
      if (!subId) return { enabled: false, subscriptionCount: 0 };
      const response = await fetch(`/api/push-subscriptions/status?subcontractorId=${subId}`);
      if (!response.ok) return { enabled: false, subscriptionCount: 0 };
      return response.json();
    },
    enabled: !!subId,
    refetchInterval: 60000,
  });

  const { data: urgentNotifications } = useQuery<any[]>({
    queryKey: ["urgent-notifications", subId],
    queryFn: () => {
      if (!subId) return Promise.resolve([]);
      return fetch(`/api/notifications?subcontractorId=${subId}&unreadOnly=true`).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 20000,
    select: (data) => data.filter((n) => (n.priority === "urgent" || n.priority === "high") && !dismissedBanner.includes(n.id)),
  });

  const markRead = useMutation({
    mutationFn: (id: number) => fetch(`/api/notifications/${id}/read`, { method: "PATCH" }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unread-count", subId] });
      queryClient.invalidateQueries({ queryKey: ["urgent-notifications", subId] });
    },
  });

  const clockOn = useClockOn({
    mutation: {
      onSuccess: () => {
        toast({ title: "Clocked on — have a great day!" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      },
    },
  });

  const clockOff = useClockOff({
    mutation: {
      onSuccess: () => {
        toast({ title: "Good work — clocked off" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      },
    },
  });

  const startBreak = useStartBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Break started" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      },
    },
  });

  const endBreak = useEndBreak({
    mutation: {
      onSuccess: () => {
        toast({ title: "Welcome back!" });
        if (subId) queryClient.invalidateQueries({ queryKey: getGetTodaySessionQueryKey({ subcontractorId: subId }) });
      },
    },
  });

  const markArrived = useMarkArrived({
    mutation: {
      onSuccess: () => {
        toast({ title: "Marked as arrived" });
        if (subId) queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split("T")[0] }) });
      },
    },
  });

  const markDeparted = useMarkDeparted({
    mutation: {
      onSuccess: () => {
        toast({ title: "Marked as departed" });
        if (subId) queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split("T")[0] }) });
      },
    },
  });

  const startWork = useUpdateJobAssignment({
    mutation: {
      onSuccess: () => {
        toast({ title: "Work started" });
        if (subId) queryClient.invalidateQueries({ queryKey: getListDispatchQueryKey({ subcontractorId: subId, date: new Date().toISOString().split("T")[0] }) });
      },
    },
  });

  // ─── Action handlers with location verification ───────────────────────────
  const handleClockOn = useCallback(async () => {
    if (!subId) return;
    await requestLocationVerification("clock_on", "clock-on", {});
    clockOn.mutate({ data: { subcontractorId: subId } });
  }, [subId, requestLocationVerification, clockOn]);

  const handleClockOff = useCallback(async () => {
    if (!subId) return;
    await requestLocationVerification("clock_off", "clock-off", {
      workSessionId: session?.id,
    });
    clockOff.mutate({ data: { subcontractorId: subId } });
  }, [subId, session?.id, requestLocationVerification, clockOff]);

  const handleMarkArrived = useCallback(async (assignmentId: number, jobAddress?: string) => {
    await requestLocationVerification("job_arrived", "marking arrived", {
      jobAssignmentId: assignmentId,
      jobAddress,
      workSessionId: session?.id,
    });
    markArrived.mutate({ id: assignmentId });
  }, [requestLocationVerification, session?.id, markArrived]);

  const handleMarkDeparted = useCallback(async (assignmentId: number, jobAddress?: string) => {
    await requestLocationVerification("job_departed", "marking departed", {
      jobAssignmentId: assignmentId,
      jobAddress,
      workSessionId: session?.id,
    });
    markDeparted.mutate({ id: assignmentId });
  }, [requestLocationVerification, session?.id, markDeparted]);

  const today = new Date().toISOString().split("T")[0];
  const isClockedOn = session?.status === "active" || session?.status === "on_break";
  const isOnBreak = session?.status === "on_break";
  const unreadCount = unreadData?.count ?? 0;
  const pushEnabled = pushSubscribed || Boolean(pushServerStatus?.enabled);

  return (
    <div className="max-w-md mx-auto space-y-4 pb-20">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Field View</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => refetchDispatch()}>
            <RotateCcw className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            onClick={() => setLocation("/notifications")}
            title="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[1rem] h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {!pushEnabled && (
        <PhoneSetupCard compact />
      )}

      <Dialog
        open={showPushPrompt && !!subId && !pushEnabled && pushStatus !== "granted" && pushStatus !== "unsupported"}
        onOpenChange={(open) => {
          if (!open) setShowPushPrompt(false);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md bg-orange-500 text-white">
              <Bell className="h-5 w-5" />
            </div>
            <DialogTitle>Turn on job notifications?</DialogTitle>
            <DialogDescription>
              SealFlow can alert you about new jobs, job changes, missing photos, stock pickups and urgent admin messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setShowPushPrompt(false)}>
              Not now
            </Button>
            <Button onClick={handleEnablePush}>
              Allow notifications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location consent prompt */}
      {locationPrompt && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/40 dark:border-orange-700 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Navigation className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-semibold text-sm text-orange-950 dark:text-orange-100">
                  Location check — {locationPrompt.eventLabel}
                </p>
                <p className="text-xs text-orange-800 dark:text-orange-300 mt-1">
                  Your location will activate briefly to confirm you are at the job address.
                  {locationPrompt.jobAddress && (
                    <span className="block mt-0.5 font-medium">{locationPrompt.jobAddress}</span>
                  )}
                  <span className="block mt-1 opacity-80">This is not continuous tracking.</span>
                </p>
                <div className="flex gap-2 mt-3">
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={locationPrompt.onAllow}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Allow
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs gap-1.5"
                    onClick={locationPrompt.onSkip}
                  >
                    <XCircle className="h-3.5 w-3.5" /> Skip
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Push notification permission prompt */}
      {showPushPrompt && subId && !pushEnabled && pushStatus !== "granted" && pushStatus !== "unsupported" && (
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Bell className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-orange-950 dark:text-orange-100">Enable push notifications</p>
                <p className="text-xs text-orange-800 dark:text-orange-300 mt-0.5">
                  Get instant alerts for new jobs, clock-on reminders, stock pickups, and more — even when the app is closed.
                </p>
                <div className="flex gap-2 mt-3">
                  <Button size="sm" className="h-7 text-xs" onClick={handleEnablePush}>
                    Enable notifications
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowPushPrompt(false)}>
                    Not now
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Push denied reminder */}
      {pushStatus === "denied" && subId && !pushEnabled && (
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
          <BellOff className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Notifications are blocked — enable them in browser settings to receive job alerts.</span>
        </div>
      )}

      {/* Push enabled status */}
      {pushEnabled && subId && pushStatus !== "unsupported" && (
        <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
          <Bell className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Push notifications are enabled for this employee/subcontractor.</span>
        </div>
      )}

      {/* Urgent / high-priority notification banners */}
      {urgentNotifications && urgentNotifications.length > 0 && (
        <div className="space-y-2">
          {urgentNotifications.slice(0, 3).map((n) => (
            <Card
              key={n.id}
              className={`border-l-4 ${n.priority === "urgent" ? "border-l-red-500 bg-red-50 dark:bg-red-950/30" : "border-l-orange-400 bg-orange-50 dark:bg-orange-950/30"}`}
            >
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${n.priority === "urgent" ? "text-red-500" : "text-orange-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{n.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                    {n.actionUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-6 text-xs px-2"
                        onClick={() => {
                          markRead.mutate(n.id);
                          setLocation(n.actionUrl);
                        }}
                      >
                        Take Action <ChevronRight className="h-3 w-3 ml-0.5" />
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 flex-shrink-0"
                    onClick={() => {
                      setDismissedBanner((prev) => [...prev, n.id]);
                      markRead.mutate(n.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Identity + clock card */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>{isWorker ? "Signed in as" : "Who are you?"}</Label>
            {isWorker ? (
              <div className="rounded-md border bg-muted px-3 py-2 text-sm font-medium">
                {user?.name ?? "Employee/Subcontractor"}
              </div>
            ) : loadingSubs ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select value={subId?.toString() || ""} onValueChange={(v) => setSubId(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select subcontractor..." />
                </SelectTrigger>
                <SelectContent>
                  {subs?.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {subId && (
            <div className="space-y-4 pt-4 border-t">
              {!isClockedOn ? (
                <Button
                  className="w-full h-16 text-lg"
                  size="lg"
                  onClick={handleClockOn}
                  disabled={clockOn.isPending || !!locationPrompt}
                >
                  <Play className="mr-2 h-6 w-6" /> CLOCK ON
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {isOnBreak ? (
                    <Button
                      variant="outline"
                      className="h-14"
                      onClick={() => endBreak.mutate({ data: { subcontractorId: subId } })}
                      disabled={endBreak.isPending}
                    >
                      <Play className="mr-2 h-5 w-5" /> END BREAK
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="h-14"
                      onClick={() => startBreak.mutate({ data: { subcontractorId: subId } })}
                      disabled={startBreak.isPending}
                    >
                      <Pause className="mr-2 h-5 w-5" /> START BREAK
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    className="h-14"
                    onClick={handleClockOff}
                    disabled={clockOff.isPending || !!locationPrompt}
                  >
                    <Square className="mr-2 h-5 w-5" /> CLOCK OFF
                  </Button>
                </div>
              )}

              {session && (
                <div className="bg-muted p-3 rounded-md text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-medium uppercase">{session.status.replace("_", " ")}</span>
                  </div>
                  {session.clockedOnAt && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Clocked on:</span>
                      <span className="font-medium">
                        {new Date(session.clockedOnAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Break time:</span>
                    <span className="font-medium">{session.totalBreakMinutes || 0} min</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Today's jobs */}
      {subId && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight">Today's Jobs</h2>
          {loadingDispatch ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : dispatchList?.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                <BriefcaseIcon className="h-8 w-8 mx-auto mb-2 opacity-20" />
                <p>No jobs assigned for today.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {dispatchList?.map((assignment) => (
                <Card key={assignment.id} className={assignment.status === "completed" ? "opacity-70" : ""}>
                  <CardHeader className="p-4 pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-base">{assignment.jobTitle}</CardTitle>
                      <Badge
                        variant={
                          assignment.status === "completed"
                            ? "secondary"
                            : assignment.status === "in_progress" || assignment.status === "arrived"
                            ? "default"
                            : "outline"
                        }
                      >
                        {assignment.status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 space-y-2 text-sm">
                    {assignment.jobAddress && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{assignment.jobAddress}</span>
                      </div>
                    )}
                    {assignment.builderContactName && (
                      <div className="flex items-start gap-2 text-muted-foreground">
                        <UsersIcon className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          {assignment.builderContactName}{" "}
                          {assignment.builderContactPhone && `(${assignment.builderContactPhone})`}
                        </span>
                      </div>
                    )}
                    {assignment.requiredColours && assignment.requiredColours.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {assignment.requiredColours.map((c) => (
                          <Badge key={c} variant="secondary" className="text-xs bg-muted">
                            {c}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="p-4 pt-0 flex gap-2">
                    {assignment.status === "pending" && (
                      <Button
                        className="w-full"
                        onClick={() => handleMarkArrived(assignment.id, assignment.jobAddress ?? undefined)}
                        disabled={markArrived.isPending || !!locationPrompt}
                      >
                        Mark Arrived
                      </Button>
                    )}
                    {(assignment.status === "arrived" || assignment.status === "in_progress") && (
                      <div className="flex w-full gap-2">
                        {assignment.status === "arrived" && (
                          <Button
                            variant="secondary"
                            className="flex-1"
                            onClick={() => startWork.mutate({ id: assignment.id, data: { status: "in_progress" } })}
                            disabled={startWork.isPending}
                          >
                            Start Work
                          </Button>
                        )}
                        <Button
                          className="flex-1"
                          onClick={() => handleMarkDeparted(assignment.id, assignment.jobAddress ?? undefined)}
                          disabled={markDeparted.isPending || !!locationPrompt}
                        >
                          Mark Departed
                        </Button>
                      </div>
                    )}
                    {assignment.status === "completed" && (
                      <Button asChild variant="outline" className="w-full">
                        <Link href={`/field/jobs/${assignment.id}`}>Submit Job Report</Link>
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BriefcaseIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="7" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
