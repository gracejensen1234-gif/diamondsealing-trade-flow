import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bell, BellOff, Check, CheckCheck, Trash2, ExternalLink, ArrowLeft } from "lucide-react";

type NotificationType =
  | "new_job" | "job_changed" | "forgotten_action" | "missing_photos"
  | "missing_metres" | "missing_stock" | "stock_pickup_ready" | "upcoming_job"
  | "clock_on_reminder" | "break_reminder" | "weekly_performance" | "bonus_update"
  | "safety_reminder" | "audit_fix_request" | "general";

interface SubNotification {
  id: number;
  subcontractorId: number;
  type: NotificationType;
  title: string;
  body: string;
  priority: "urgent" | "high" | "normal" | "low";
  isRead: boolean;
  actionUrl: string | null;
  linkedEntityType: string | null;
  linkedEntityId: number | null;
  createdAt: string;
  readAt: string | null;
}

const PRIORITY_COLOURS: Record<string, string> = {
  urgent: "bg-red-100 border-red-300 dark:bg-red-950/40",
  high: "bg-orange-50 border-orange-200 dark:bg-orange-950/30",
  normal: "",
  low: "opacity-75",
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "destructive",
  high: "default",
  normal: "secondary",
  low: "outline",
};

const TYPE_LABELS: Record<NotificationType, string> = {
  new_job: "New Job",
  job_changed: "Job Changed",
  forgotten_action: "Action Required",
  missing_photos: "Missing Photos",
  missing_metres: "Missing Metres",
  missing_stock: "Missing Stock",
  stock_pickup_ready: "Stock Ready",
  upcoming_job: "Upcoming Job",
  clock_on_reminder: "Clock-On",
  break_reminder: "Break",
  weekly_performance: "Performance",
  bonus_update: "Bonus",
  safety_reminder: "Safety",
  audit_fix_request: "Audit",
  general: "General",
};

export default function NotificationCentre() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [subId, setSubId] = useState<number | undefined>(() => {
    const s = localStorage.getItem("ds_selected_subcontractor_id");
    return s ? parseInt(s) : undefined;
  });
  const [filter, setFilter] = useState<"all" | "unread" | NotificationType>("all");

  const { data: subs } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["subcontractors"],
    queryFn: () => fetch("/api/subcontractors").then((r) => r.json()),
  });

  const { data: notifications, isLoading } = useQuery<SubNotification[]>({
    queryKey: ["notifications", subId, filter],
    queryFn: () => {
      if (!subId) return Promise.resolve([]);
      const params = new URLSearchParams({ subcontractorId: String(subId) });
      if (filter === "unread") params.set("unreadOnly", "true");
      return fetch(`/api/notifications?${params}`).then((r) => r.json());
    },
    enabled: !!subId,
    refetchInterval: 15000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => fetch(`/api/notifications/${id}/read`, { method: "PATCH" }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subcontractorId: subId }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-count"] });
      toast({ title: "All notifications marked as read" });
    },
  });

  const deleteNotification = useMutation({
    mutationFn: (id: number) => fetch(`/api/notifications/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const displayed = notifications?.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.isRead;
    return n.type === filter;
  }) ?? [];

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/field")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Bell className="h-6 w-6" />
            Notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1 text-xs px-1.5 py-0 min-w-[1.3rem] text-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </h1>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending || !subId}>
            <CheckCheck className="h-4 w-4 mr-1" /> Mark all read
          </Button>
        )}
      </div>

      {/* Who are you selector */}
      <Card>
        <CardContent className="p-4">
          <Select
            value={subId?.toString() ?? ""}
            onValueChange={(v) => {
              const id = parseInt(v);
              setSubId(id);
              localStorage.setItem("ds_selected_subcontractor_id", v);
            }}
          >
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
        </CardContent>
      </Card>

      {subId && (
        <>
          {/* Filter bar */}
          <div className="flex gap-2 flex-wrap">
            {(["all", "unread", "new_job", "job_changed", "forgotten_action", "missing_photos", "stock_pickup_ready", "audit_fix_request", "bonus_update", "weekly_performance"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
                className="text-xs h-7"
              >
                {f === "all" ? "All" : f === "unread" ? `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}` : TYPE_LABELS[f as NotificationType]}
              </Button>
            ))}
          </div>

          {/* Notification list */}
          {isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : displayed.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center text-muted-foreground">
                <BellOff className="h-8 w-8 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No notifications</p>
                <p className="text-sm mt-1">
                  {filter === "unread" ? "You're all caught up!" : "Nothing here yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {displayed.map((n) => (
                <Card
                  key={n.id}
                  className={`transition-all border ${PRIORITY_COLOURS[n.priority]} ${!n.isRead ? "shadow-sm" : ""}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      {/* Unread dot */}
                      <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${!n.isRead ? "bg-orange-500" : "bg-transparent"}`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-semibold text-sm">{n.title}</span>
                          <Badge variant={PRIORITY_BADGE[n.priority] as any} className="text-[10px] px-1.5 py-0 h-4">
                            {n.priority === "urgent" ? "URGENT" : TYPE_LABELS[n.type]}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground leading-snug">{n.body}</p>
                        <p className="text-xs text-muted-foreground/60 mt-1.5">
                          {new Date(n.createdAt).toLocaleString("en-AU", {
                            weekday: "short", month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-start gap-1 flex-shrink-0 ml-1">
                        {n.actionUrl && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            title="Open"
                            onClick={() => {
                              if (!n.isRead) markRead.mutate(n.id);
                              setLocation(n.actionUrl!);
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!n.isRead && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Mark read"
                            onClick={() => markRead.mutate(n.id)}
                            disabled={markRead.isPending}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete"
                          onClick={() => deleteNotification.mutate(n.id)}
                          disabled={deleteNotification.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!subId && (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Select your name above</p>
            <p className="text-sm mt-1">Your notifications will appear here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
