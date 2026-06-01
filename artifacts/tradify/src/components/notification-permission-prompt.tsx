import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  currentPushPermission,
  hasBrowserPushSubscription,
  pushNotificationsSupported,
  registerServiceWorker,
  subscribeToPush,
  type PushPermissionState,
} from "@/lib/push-notifications";

export function NotificationPermissionPrompt({ subcontractorId }: { subcontractorId?: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<PushPermissionState>("unknown");
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);
  const [enabledThisDevice, setEnabledThisDevice] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const promptDismissKey = useMemo(
    () => `sealflow_notifications_prompt_dismissed_${user?.id ?? "guest"}_${subcontractorId ?? "none"}`,
    [subcontractorId, user?.id],
  );

  const { data: serverStatus } = useQuery<{ enabled: boolean; subscriptionCount: number }>({
    queryKey: ["push-subscription-status", subcontractorId],
    queryFn: async () => {
      if (!subcontractorId) return { enabled: false, subscriptionCount: 0 };
      const response = await fetch(`/api/push-subscriptions/status?subcontractorId=${subcontractorId}`);
      if (!response.ok) return { enabled: false, subscriptionCount: 0 };
      return response.json();
    },
    enabled: Boolean(subcontractorId),
    refetchInterval: 60000,
  });

  const pushEnabled = enabledThisDevice || (browserSubscribed && serverStatus?.enabled === true);

  useEffect(() => {
    if (!subcontractorId) return;

    if (!pushNotificationsSupported()) {
      setPermission("unsupported");
      return;
    }

    const initialPermission = currentPushPermission();
    setPermission(initialPermission);

    void registerServiceWorker();
    void hasBrowserPushSubscription().then(setBrowserSubscribed);

    fetch("/api/push-subscriptions/vapid-public-key")
      .then((response) => response.json())
      .then((data) => {
        setVapidKey(data.publicKey ?? null);
      })
      .catch(() => undefined);
  }, [subcontractorId]);

  useEffect(() => {
    if (!subcontractorId || pushEnabled || permission !== "default") return;
    if (sessionStorage.getItem(promptDismissKey) === "1") return;
    setOpen(true);
  }, [permission, promptDismissKey, pushEnabled, subcontractorId]);

  const closeForSession = useCallback(() => {
    sessionStorage.setItem(promptDismissKey, "1");
    setOpen(false);
  }, [promptDismissKey]);

  const handleEnable = useCallback(async () => {
    if (!subcontractorId || !vapidKey) return;

    setBusy(true);
    const result = await subscribeToPush(subcontractorId, vapidKey);
    setBusy(false);
    setPermission(result.permission);

    if (result.ok) {
      sessionStorage.removeItem(promptDismissKey);
      setBrowserSubscribed(true);
      setEnabledThisDevice(true);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["push-subscription-status", subcontractorId] });
      toast({
        title: "Notifications enabled",
        description: "You'll get job alerts, reminders and urgent updates on this device.",
      });
      return;
    }

    if (result.permission === "denied") {
      closeForSession();
      toast({
        title: "Notifications blocked",
        description: "Open this browser's site settings to allow notifications for SealFlow.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Notifications not enabled",
      description: "Tap Enable notifications again when you're ready to allow alerts.",
      variant: "destructive",
    });
  }, [closeForSession, promptDismissKey, queryClient, subcontractorId, toast, vapidKey]);

  if (!subcontractorId || serverStatus === undefined || pushEnabled || permission === "unsupported" || permission === "granted" || permission === "denied") return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setOpen(true);
        else closeForSession();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md bg-orange-500 text-white">
            <Bell className="h-5 w-5" />
          </div>
          <DialogTitle>Enable SealFlow notifications?</DialogTitle>
          <DialogDescription>
            Get alerts for new jobs, changed jobs, missing photos, stock pickups and urgent admin messages. Tap enable, then choose Allow.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={closeForSession} disabled={busy}>
            Not now
          </Button>
          <Button onClick={handleEnable} disabled={busy || !vapidKey}>
            {busy ? "Enabling..." : "Enable notifications"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
